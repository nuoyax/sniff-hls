// DownloadEngine: orchestrates playlist fetch → segment pool → decrypt →
// transmux/assemble. Runs in the host (DOM) context.
//
// Supports:
// - Classic MPEG-TS HLS → mux.js → fMP4 (with .ts fallback)
// - CMAF/fMP4 HLS (#EXT-X-MAP): concat init + media (no mux.js)
// - Demuxed audio (#EXT-X-MEDIA + STREAM-INF AUDIO=): download + remux via mp4box
import { fetchText, fetchBytes } from './fetcher';
import { parsePlaylist, pickBestVariant, pickAudioRendition } from './m3u8Parser';
import { SegmentPool, makeDecryptor } from './segmentPool';
import { TsTransmuxer } from './transmuxer';
import { assembleMp4, assembleTs, extFor } from './blobAssembler';
import { playlistLooksFmp4, isMpegTs, isIsoBmff } from './containerDetect';
import { mergeFmp4Tracks, type Fmp4TrackBytes } from './fmp4Merge';
import { getResumeState, saveResumeState, clearResumeState } from '../state/resumeStore';
import { getSettings } from '../state/settingsStore';
import { ExtensionError } from '../errors';
import log from '../log';
import type {
  DownloadJob,
  DownloadProgress,
  OutputFormat,
  ParsedPlaylist,
  InitSegment,
} from '../types';

export interface EngineCallbacks {
  onProgress: (p: DownloadProgress) => void;
  onComplete: (result: { blob: Blob; format: OutputFormat; filename: string }) => void;
  onError: (e: ExtensionError) => void;
}

interface ResolvedTracks {
  video: ParsedPlaylist;
  audio?: ParsedPlaylist;
}

export class DownloadEngine {
  private aborted = false;
  private paused = false;
  private pools = new Set<import('./segmentPool').SegmentPool>();
  private transmuxer: TsTransmuxer | null = null;
  private mp4Failed = false;
  /** Raw decrypted segment bytes (TS path fallback). */
  private tsBuffer: Uint8Array[] = [];
  /** Transmuxed fMP4 data chunks + init (TS→MP4 path). */
  private dataChunks: Uint8Array[] = [];
  private initSeg: Uint8Array | null = null;
  private bytesLoaded = 0;

  constructor(
    private job: DownloadJob,
    private cb: EngineCallbacks,
  ) {}

  cancel(): void {
    this.aborted = true;
  }

  async run(): Promise<void> {
    const { job } = this;
    try {
      this.emit({ status: 'fetching' });

      const { video, audio } = await this.resolveTracks(job.url, job.variantUrl);
      if (this.aborted) throw new ExtensionError('CANCELED');

      if (!video.segments.length) throw new ExtensionError('PARSE', 'No segments in playlist');

      log.info('engine: playlist resolved', {
        videoSegments: video.segments.length,
        audioSegments: audio?.segments.length ?? 0,
        keyMethod: video.key?.method,
        fmp4Hint: playlistLooksFmp4(video),
        endList: video.endList,
      });

      // Resume: for finished (VOD) playlists, look up which segments were
      // already fetched in a previous attempt of this media playlist.
      let resumeSettings;
      try {
        resumeSettings = await getSettings();
      } catch {
        resumeSettings = null;
      }
      let skipIndices: Set<number> | undefined;
      let onSegmentDone: ((seq: number) => void) | undefined;
      // Resume keys off the requested URL; segment sequences are per-playlist.
      const resumeUrl = job.variantUrl || job.url;
      const resumable = resumeSettings?.resumeEnabled !== false && video.endList;
      if (resumable && !audio?.segments.length) {
        const doneSet = await getResumeState(resumeUrl);
        if (doneSet.size > 0 && doneSet.size < video.segments.length) {
          log.info('engine: resuming — skipping fetched segments', {
            done: doneSet.size,
            total: video.segments.length,
          });
          skipIndices = doneSet;
        } else if (doneSet.size >= video.segments.length && video.segments.length > 0) {
          // Prior run reached 100% but never finalized — refetch from scratch
          // is safest (assembly state was lost with the host page).
          await clearResumeState(resumeUrl);
        }
      }
      // Persist progress checkpoints as segments complete (VOD only).
      if (resumable && !audio?.segments.length) {
        const fetched = new Set<number>(skipIndices ?? []);
        onSegmentDone = (seq: number) => {
          fetched.add(seq);
          void saveResumeState(resumeUrl, fetched).catch(() => {});
        };
      }

      const decryptor = await makeDecryptor(video.key);
      const canDecrypt = !video.key || video.key.method === 'NONE' || decryptor;
      if (!canDecrypt) {
        throw new ExtensionError('DECRYPT', `Unsupported encryption: ${video.key?.method}`);
      }

      const wantMp4 = job.format !== 'ts';

      // CMAF / fMP4 path (Twitter amplify, many modern CDNs).
      if (playlistLooksFmp4(video)) {
        await this.runFmp4Path(video, audio, wantMp4);
        return;
      }

      // Classic MPEG-TS path (may still discover fMP4 on first segment).
      await this.runTsPath(video, audio, wantMp4, decryptor, skipIndices, onSegmentDone);
    } catch (e) {
      if (e instanceof ExtensionError) this.cb.onError(e);
      else this.cb.onError(new ExtensionError('UNKNOWN', (e as Error)?.message, e));
    }
  }

  /** Download init + media for fMP4; remux linked audio when present. */
  private async runFmp4Path(
    video: ParsedPlaylist,
    audio: ParsedPlaylist | undefined,
    wantMp4: boolean,
  ): Promise<void> {
    const totalSegs = video.segments.length + (audio?.segments.length ?? 0);
    const videoTrack = await this.downloadFmp4Track(video);
    if (this.aborted) throw new ExtensionError('CANCELED');

    let audioTrack: Fmp4TrackBytes | undefined;
    if (audio?.segments.length) {
      audioTrack = await this.downloadFmp4Track(audio);
      if (this.aborted) throw new ExtensionError('CANCELED');
    }

    this.emit({
      status: 'assembling',
      done: totalSegs,
      total: totalSegs,
      bytesLoaded: this.bytesLoaded,
    });

    let blob: Blob;
    let format: OutputFormat = 'mp4';

    if (!wantMp4) {
      // Source is not MPEG-TS — still emit a playable MP4 container.
      log.warn('fMP4 source cannot become MPEG-TS; emitting mp4');
    }

    if (audioTrack) {
      try {
        const merged = await mergeFmp4Tracks(videoTrack, audioTrack);
        blob = new Blob([merged as BlobPart], { type: 'video/mp4' });
      } catch (e) {
        log.warn('A/V remux failed; falling back to video-only fMP4', e);
        blob = assembleMp4(videoTrack.init, videoTrack.media).blob;
      }
    } else {
      blob = assembleMp4(videoTrack.init, videoTrack.media).blob;
    }

    const filename = `${this.job.baseFilename}.${extFor(format)}`;
    this.emit({
      status: 'downloading',
      done: totalSegs,
      total: totalSegs,
      bytesLoaded: blob.size,
      bytesTotal: blob.size,
      outputFormat: format,
      filename,
    });
    this.cb.onComplete({ blob, format, filename });
  }

  private async downloadFmp4Track(playlist: ParsedPlaylist): Promise<Fmp4TrackBytes> {
    const decryptor = await makeDecryptor(playlist.key);
    let init: Uint8Array | null = null;

    if (playlist.initSegment) {
      init = await this.fetchInit(playlist.initSegment);
      this.bytesLoaded += init.length;
    }

    const media: Uint8Array[] = [];
    for await (const res of this.poolFor(playlist)) {
      if (this.aborted) throw new ExtensionError('CANCELED');
      media.push(res.bytes);
    }    for (const m of media) this.bytesLoaded += m.length;

    return { init, media };
  }

  private async fetchInit(init: InitSegment): Promise<Uint8Array> {
    return fetchBytes(init.uri, {
      byterange: init.byterange,
      timeoutMs: 60_000,
      retries: 3,
    });
  }

  /** Run a segment pool over a playlist, honoring retries + resume skips. */
  private async *poolFor(
    playlist: ParsedPlaylist,
    skipIndices?: Set<number>,
    onSegmentDone?: (seq: number) => void,
  ): AsyncIterable<import('./segmentPool').SegmentResult> {
    let retries = 3;
    try {
      const s = await getSettings();
      retries = s.segmentRetries;
    } catch {
      /* default */
    }
    const pool = new SegmentPool({
      concurrency: this.job.concurrency,
      decryptor: undefined,
      retries,
      skipIndices,
      onSegmentDone,
      onProgress: (done, _total, bytes) => {
        this.emit({
          status: this.paused ? 'paused' : 'fetching',
          done,
          total: playlist.segments.length,
          bytesLoaded: bytes,
        });
      },
    });
    this.pools.add(pool);
    try {
      yield* pool.run(playlist.segments);
    } finally {
      this.pools.delete(pool);
    }
  }

  /** Pause all running segment pools (in-flight requests finish).
   * No progress emit here — the SW broadcasts 'paused' the instant the user
   * clicks, and a host-side emit would race it (and previously reset the
   * counters with done:0/total:0). */
  pause(): void {
    this.paused = true;
    for (const p of this.pools) p.pause();
  }

  /** Resume previously paused segment pools. */
  resume(): void {
    this.paused = false;
    for (const p of this.pools) p.resume();
  }

  /** Classic TS segments → mux.js → MP4 (or raw .ts fallback). */
  private async runTsPath(
    playlist: ParsedPlaylist,
    audio: ParsedPlaylist | undefined,
    wantMp4: boolean,
    decryptor: Awaited<ReturnType<typeof makeDecryptor>>,
    skipIndices?: Set<number>,
    onSegmentDone?: (seq: number) => void,
  ): Promise<void> {
    const { segments } = playlist;

    if (wantMp4) {
      this.transmuxer = new TsTransmuxer();
      try {
        await this.transmuxer.init({ onError: (e) => log.warn('transmux err', e) });
        this.transmuxer.onData((chunk) => {
          if (chunk.init && chunk.init.length) this.initSeg = chunk.init;
          if (chunk.data && chunk.data.length) this.dataChunks.push(chunk.data);
        });
      } catch (e) {
        log.warn('transmuxer init failed; will use ts fallback', e);
        this.mp4Failed = true;
        this.transmuxer = null;
      }
    }

    for await (const res of this.poolFor(playlist, skipIndices, onSegmentDone)) {
      if (this.aborted) throw new ExtensionError('CANCELED');
      const seg = res.bytes;
      this.tsBuffer.push(res.bytes);

      // Skip mux.js when payload is already ISO BMFF (mis-labeled playlist).
      if (this.tsBuffer.length === 1 && isIsoBmff(seg) && !isMpegTs(seg)) {
        log.info('engine: segments are fMP4; skipping TS transmux');
        this.transmuxer = null;
        this.mp4Failed = true; // force non-transmux assemble branch below
        this.dataChunks = [];
        this.initSeg = null;
        continue;
      }

      if (this.transmuxer && !this.mp4Failed) {
        try {
          this.transmuxer.push(seg);
        } catch (e) {
          log.warn('transmux push failed; switching to ts fallback', e);
          this.mp4Failed = true;
          this.transmuxer = null;
          this.dataChunks = [];
          this.initSeg = null;
        }
      }
    }

    if (this.aborted) throw new ExtensionError('CANCELED');

    // Playlist lacked #EXT-X-MAP but bytes are CMAF → assemble / remux as fMP4.
    if (
      wantMp4 &&
      this.tsBuffer.length &&
      isIsoBmff(this.tsBuffer[0]) &&
      !isMpegTs(this.tsBuffer[0])
    ) {
      log.info('engine: assembling fMP4 segments without playlist MAP');
      if (audio?.segments.length) {
        try {
          const audioTrack = await this.downloadFmp4Track(audio);
          const merged = await mergeFmp4Tracks(
            { init: null, media: this.tsBuffer },
            audioTrack,
          );
          return this.finish(new Blob([merged as BlobPart], { type: 'video/mp4' }), 'mp4', segments.length);
        } catch (e) {
          log.warn('late A/V remux failed; video-only fMP4', e);
        }
      }
      const r = assembleMp4(null, this.tsBuffer);
      return this.finish(r.blob, r.format, segments.length);
    }

    let blob: Blob;
    let format: OutputFormat;

    if (wantMp4 && !this.mp4Failed && this.transmuxer && this.dataChunks.length) {
      try {
        const r = assembleMp4(this.initSeg, this.dataChunks);
        blob = r.blob;
        format = r.format;
      } catch (e) {
        log.warn('mp4 assemble failed; fallback to ts', e);
        const r = assembleTs(this.tsBuffer);
        blob = r.blob;
        format = r.format;
      }
    } else if (wantMp4 && this.mp4Failed) {
      const r = assembleTs(this.tsBuffer);
      blob = r.blob;
      format = r.format;
    } else {
      const r = assembleTs(this.tsBuffer);
      blob = r.blob;
      format = r.format;
    }

    this.finish(blob, format, segments.length);
  }

  private finish(blob: Blob, format: OutputFormat, segmentCount: number): void {
    this.tsBuffer = [];
    this.dataChunks = [];
    this.initSeg = null;

    // Download finalized — clear any resume checkpoint for this playlist.
    const mediaUrl = this.job.variantUrl || this.job.url;
    void clearResumeState(mediaUrl).catch(() => {});

    const filename = `${this.job.baseFilename}.${extFor(format)}`;
    this.emit({
      status: 'downloading',
      done: segmentCount,
      total: segmentCount,
      bytesLoaded: blob.size,
      bytesTotal: blob.size,
      outputFormat: format,
      filename,
    });
    this.cb.onComplete({ blob, format, filename });
  }

  private async resolveTracks(url: string, variantUrl?: string): Promise<ResolvedTracks> {
    const text = await fetchText(url, { timeoutMs: 30_000 });
    const pl = parsePlaylist(text, url);

    if (!pl.isMaster) {
      return { video: pl };
    }

    const chosen =
      (variantUrl ? pl.variants.find((v) => v.url === variantUrl) : undefined) ??
      pickBestVariant(pl.variants);
    if (!chosen) throw new ExtensionError('PARSE', 'Master playlist has no variants');

    // If UI passed a variant URL that isn't in the list, still fetch it as video media.
    const videoUrl =
      variantUrl && !pl.variants.some((v) => v.url === variantUrl) ? variantUrl : chosen.url;

    const mediaText = await fetchText(videoUrl, { timeoutMs: 30_000 });
    const video = parsePlaylist(mediaText, videoUrl);

    // Audio group follows the matched variant when possible; else the chosen best.
    const audioSource =
      pl.variants.find((v) => v.url === videoUrl) ?? chosen;

    let audio: ParsedPlaylist | undefined;
    const groupId = audioSource.audioGroupId;
    if (groupId && pl.mediaGroups?.AUDIO?.[groupId]) {
      const rendition = pickAudioRendition(pl.mediaGroups.AUDIO[groupId]);
      if (rendition?.uri) {
        try {
          const audioText = await fetchText(rendition.uri, { timeoutMs: 30_000 });
          audio = parsePlaylist(audioText, rendition.uri);
          log.info('engine: linked audio playlist', {
            groupId,
            segments: audio.segments.length,
            uri: rendition.uri,
          });
        } catch (e) {
          log.warn('failed to fetch linked audio playlist; continuing video-only', e);
        }
      }
    }

    return { video, audio };
  }

  private emit(p: Partial<DownloadProgress> & { status: DownloadProgress['status'] }): void {
    this.cb.onProgress({
      jobId: this.job.id,
      done: p.done ?? 0,
      total: p.total ?? 0,
      bytesLoaded: p.bytesLoaded ?? 0,
      bytesTotal: p.bytesTotal ?? 0,
      status: p.status,
      outputFormat: p.outputFormat,
      filename: p.filename,
      error: p.error,
    });
  }
}

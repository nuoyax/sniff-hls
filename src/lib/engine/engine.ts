// DownloadEngine: orchestrates playlist fetch → segment pool → decrypt →
// transmux → assemble, streaming results. Runs in the host (DOM) context.
//
// Design notes:
// - Engine depends only on fetch / crypto.subtle / Blob / URL — all present
//   in both chrome.offscreen documents and hidden extension pages.
// - Emits progress via a callback; the host forwards to the SW over a port.
// - MP4-first with automatic .ts fallback: we ALWAYS keep the raw decrypted
//   .ts buffer. If transmuxing fails or produces nothing, we assemble the
//   .ts instead — the user always gets *something* playable.
import { fetchText } from './fetcher';
import { parsePlaylist, pickBestVariant } from './m3u8Parser';
import { SegmentPool, makeDecryptor } from './segmentPool';
import { TsTransmuxer } from './transmuxer';
import { assembleMp4, assembleTs, extFor } from './blobAssembler';
import { ExtensionError } from '../errors';
import log from '../log';
import type { DownloadJob, DownloadProgress, OutputFormat, ParsedPlaylist } from '../types';

export interface EngineCallbacks {
  onProgress: (p: DownloadProgress) => void;
  onComplete: (result: { blob: Blob; format: OutputFormat; filename: string }) => void;
  onError: (e: ExtensionError) => void;
}

export class DownloadEngine {
  private aborted = false;
  private transmuxer: TsTransmuxer | null = null;
  private mp4Failed = false;
  /** Raw decrypted .ts bytes, kept for fallback regardless of mp4 path. */
  private tsBuffer: Uint8Array[] = [];
  /** Transmuxed fMP4 data chunks + init. */
  private dataChunks: Uint8Array[] = [];
  private initSeg: Uint8Array | null = null;

  constructor(private job: DownloadJob, private cb: EngineCallbacks) {}

  cancel(): void {
    this.aborted = true;
  }

  async run(): Promise<void> {
    const { job } = this;
    try {
      this.emit({ status: 'fetching' });

      // 1. Resolve to a media playlist.
      const playlist = await this.resolveMediaPlaylist(job.url);
      if (this.aborted) throw new ExtensionError('CANCELED');

      const { segments, key } = playlist;
      if (!segments.length) throw new ExtensionError('PARSE', 'No segments in playlist');

      log.info('engine: playlist resolved', {
        segments: segments.length,
        keyMethod: key?.method,
        endList: playlist.endList,
      });

      // 2. Decryptor (NONE passthrough when no key). Unsupported methods →
      //    makeDecryptor returns null and we go TS-only (can't decrypt).
      const decryptor = await makeDecryptor(key);
      const canDecrypt = !key || key.method === 'NONE' || decryptor;
      if (!canDecrypt) {
        log.warn('cannot decrypt; aborting (DRM/cipher not supported)', key?.method);
        throw new ExtensionError('DECRYPT', `Unsupported encryption: ${key?.method}`);
      }

      // 3. Output path decision.
      const tsOnly = job.format === 'ts';
      const wantMp4 = !tsOnly;

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

      // 4. Stream segments through the pool.
      const pool = new SegmentPool({
        concurrency: job.concurrency,
        decryptor: decryptor ?? undefined,
        onProgress: (done, _total, bytes) => {
          this.emit({
            status: this.transmuxer && !this.mp4Failed ? 'transmuxing' : 'fetching',
            done,
            total: segments.length,
            bytesLoaded: bytes,
          });
        },
      });

      for await (const res of pool.run(segments)) {
        if (this.aborted) throw new ExtensionError('CANCELED');
        const seg = res.bytes;
        this.tsBuffer.push(seg); // always keep raw ts for fallback
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

      // 5. Assemble.
      this.emit({ status: 'assembling', done: segments.length, total: segments.length });

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

      // Free large intermediates.
      this.tsBuffer = [];
      this.dataChunks = [];
      this.initSeg = null;

      const filename = `${job.baseFilename}.${extFor(format)}`;
      this.emit({
        status: 'downloading',
        done: segments.length,
        total: segments.length,
        bytesLoaded: blob.size,
        bytesTotal: blob.size,
        outputFormat: format,
        filename,
      });

      this.cb.onComplete({ blob, format, filename });
    } catch (e) {
      if (e instanceof ExtensionError) this.cb.onError(e);
      else this.cb.onError(new ExtensionError('UNKNOWN', (e as Error)?.message, e));
    }
  }

  private async resolveMediaPlaylist(url: string): Promise<ParsedPlaylist> {
    const text = await fetchText(url, { timeoutMs: 30_000 });
    let pl = parsePlaylist(text, url);
    if (pl.isMaster) {
      const variant = pickBestVariant(pl.variants);
      if (!variant) throw new ExtensionError('PARSE', 'Master playlist has no variants');
      const mediaText = await fetchText(variant.url, { timeoutMs: 30_000 });
      pl = parsePlaylist(mediaText, variant.url);
    }
    return pl;
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

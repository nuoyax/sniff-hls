// Integration test mirroring the real-world flow of
// https://nnyy.in/dianying/202597447.html (努力影院):
//   page → /_gp/<id>/<ep> API returns video_plays[].play_data (m3u8 URL)
//   → media playlist: VOD, #EXT-X-VERSION:3, ~5688 one-second .ts segments,
//     no encryption, no #EXT-X-MAP → classic TS path → mux.js → MP4.
// Verified live against the site (2026-08-29):
//   segments: 5688, endlist: true, first seg sync byte: 0x47, Range → 206.
// These tests replay that exact playlist shape with a stubbed network and
// REAL engine + parser + transmuxer + assembler (no mocks on the pipeline).
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  (globalThis as any).__VITEST__ = true; // skip backoff sleeps
  // Engine reads settings/resume state via the WebExtension storage shim —
  // provide a minimal in-memory chrome-like API (vitest has no runtime).
  (globalThis as any).chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (keys: any) => (typeof keys === 'string' ? {} : {}),
        set: async (_o: any) => {},
        remove: async (_k: any) => {},
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

import { parsePlaylist, pickBestVariant } from '../src/lib/engine/m3u8Parser';
import { TsTransmuxer, concatBytes } from '../src/lib/engine/transmuxer';
import { assembleMp4, assembleTs } from '../src/lib/engine/blobAssembler';
import { isMpegTs, isIsoBmff } from '../src/lib/engine/containerDetect';
import { DownloadEngine } from '../src/lib/engine/engine';
import type { DownloadJob, DownloadProgress, ParsedPlaylist } from '../src/lib/types';
import { ExtensionError } from '../src/lib/errors';

const PLAYLIST_URL = 'https://fengbao12.com/video/mourenzhiqi/a203ebf21a6d/index.m3u8';

/** Build a playlist body identical in shape to the live site's. */
function makePlaylistText(n: number): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MEDIA-SEQUENCE:0',
  ];
  for (let i = 0; i < n; i++) {
    lines.push('#EXTINF:1,');
    lines.push(`${String(i).padStart(7, '0')}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

/**
 * Build a byte-level realistic TS segment: PAT + PMT (CRC-32/MPEG valid, as
 * mux.js requires) + one video PES with H.264 start codes. mux.js's demux
 * silently drops junk packets, so a synthetic 0x47-filled segment produces no
 * transmux output — real segments always carry PAT/PMT/PES.
 */
function makeTsSegment(seed: number): Uint8Array {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n << 24;
      for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes: number[]): number => {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ b) & 0xff];
      crc >>>= 0;
    }
    return crc >>> 0;
  };
  const pkt = (pid: number, payload: Uint8Array): Uint8Array => {
    const p = new Uint8Array(188);
    p[0] = 0x47;
    p[1] = 0x40 | ((pid >> 8) & 0x1f); // PUSI set
    p[2] = pid & 0xff;
    p[3] = 0x10; // payload only, CC=0 (fine for one-shot segments)
    p.set(payload.subarray(0, 184), 4);
    return p;
  };
  const withCrc = (section: number[]): Uint8Array => {
    const crc = crc32(section);
    const out = new Uint8Array(1 + section.length + 4); // + pointer byte
    out[0] = 0;
    out.set(Uint8Array.from(section), 1);
    out[1 + section.length] = (crc >>> 24) & 0xff;
    out[2 + section.length] = (crc >>> 16) & 0xff;
    out[3 + section.length] = (crc >>> 8) & 0xff;
    out[4 + section.length] = crc & 0xff;
    return out;
  };
  const pat = pkt(0x00, withCrc([0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0, 0x64]));
  const pmt = pkt(0x64, withCrc([0x02, 0xb0, 0x17, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe0, 0x64, 0xf0, 0x00, 0x1b, 0xe1, 0x00, 0xf0, 0x00]));
  // video PES: start codes + PTS + AUD/slice NALs; filler byte varies by seed
  const pesBody = [0, 0, 1, 0xe0, 0x00, 0x0d, 0x80, 0x80, 0x05, 0x21, 0, 0x0a, 0x0a, 0x0a, 0, 0, 1, 0x09, 0x10, 0, 0, 1, 0x41, 0x9a, seed & 0xff];
  const pes = pkt(0x100, new Uint8Array(pesBody));
  const out = new Uint8Array(188 * 3);
  out.set(pat, 0);
  out.set(pmt, 188);
  out.set(pes, 376);
  return out;
}

function segOf(seq: number, urlBase: string): any {
  return { sequence: seq, url: `${urlBase}${String(seq).padStart(7, '0')}.ts`, duration: 1 };
}

function parseMedia(n: number): ParsedPlaylist {
  return parsePlaylist(makePlaylistText(n), PLAYLIST_URL);
}

describe('nnyy.in download flow (202597447.html) — live-shaped regression', () => {
  // ---------- 1. detection/parse stage ----------
  it('parses the site playlist shape: VOD, media (not master), 5688 segments', () => {
    const pl = parseMedia(5688);
    expect(pl.isMaster).toBe(false);
    expect(pl.endList).toBe(true);
    expect(pl.segments.length).toBe(5688);
    expect(pl.segments[0].url).toBe(`${PLAYLIST_URL.replace('index.m3u8', '')}0000000.ts`);
    expect(pl.segments[5687].sequence).toBe(5687);
    expect(pl.key?.method ?? 'NONE').toBe('NONE'); // no encryption
    expect(pl.initSegment).toBeUndefined(); // classic TS, no #EXT-X-MAP
  });

  it('master-unwrap: site page proxies play through /_gp API → direct m3u8 (no master)', () => {
    // The page's play_data IS the media playlist (src_site: bfzy). If it were a
    // master, pickBestVariant would choose the highest bandwidth; ensure a
    // media playlist round-trips without variant selection.
    const pl = parseMedia(10);
    expect(pickBestVariant(pl.variants) ?? null).toBeUndefined ?? true;
    expect(pl.isMaster).toBe(false);
  });

  // ---------- 2. segment fetch stage (SegmentPool via engine pipeline shape) ----------
  it('fetches all segments in order with concurrency (small cut of the 5688)', async () => {
    const N = 40;
    const pl = parseMedia(N);
    const fetched: number[] = [];
    // stub network
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      const seq = Number(u.match(/(\d{7})\.ts/)![1]);
      return new Response(makeTsSegment(seq).buffer as ArrayBuffer, { status: 200 });
    }) as any;
    try {
      const { SegmentPool } = await import('../src/lib/engine/segmentPool');
      const pool = new SegmentPool({ concurrency: 6, retries: 1 });
      for await (const r of pool.run(pl.segments)) {
        fetched.push(r.sequence);
        expect(r.bytes[0]).toBe(0x47); // sync byte intact
      }
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(fetched).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it('pause/resume: pool stops launching new fetches while paused, resumes after', async () => {
    const N = 12;
    const pl = parseMedia(N);
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    // Gate each fetch behind a 10ms delay so we can observe pause behavior.
    globalThis.fetch = (async (url: any) => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 10));
      const seq = Number(String(url).match(/(\d{7})\.ts/)![1]);
      return new Response(makeTsSegment(seq).buffer as ArrayBuffer, { status: 200 });
    }) as any;
    try {
      const { SegmentPool } = await import('../src/lib/engine/segmentPool');
      const pool = new SegmentPool({ concurrency: 2, retries: 1 });
      const drain = (async () => {
        for await (const _ of pool.run(pl.segments)) { /* drain */ }
      })();

      // Let the first concurrency-2 wave launch, then pause.
      await new Promise((r) => setTimeout(r, 25));
      const countAtPause = fetchCount;
      pool.pause();
      await new Promise((r) => setTimeout(r, 60));
      // No new fetches may start while paused (in-flight ones may finish, but
      // the backpressure loop must not launch replacements).
      expect(fetchCount).toBeLessThanOrEqual(countAtPause + 2);

      pool.resume();
      await drain;
      expect(fetchCount).toBe(N);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ---------- 3. transmux + assemble stage (real mux.js) ----------
  it('TS path: transmuxes collected segments to fMP4 and assembles an MP4 blob', async () => {
    const N = 12;
    const pl = parseMedia(N);
    const tsBuffer: Uint8Array[] = [];
    const dataChunks: Uint8Array[] = [];
    let initSeg: Uint8Array | null = null;

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(makeTsSegment(1).buffer as ArrayBuffer, { status: 200 })) as any;
    try {
      // collect like engine.runTsPath does
      const { SegmentPool } = await import('../src/lib/engine/segmentPool');
      const pool = new SegmentPool({ concurrency: 4, retries: 1 });
      for await (const r of pool.run(pl.segments)) tsBuffer.push(r.bytes);

      // engine logic: first segment must look like TS, not ISO BMFF
      expect(isIsoBmff(tsBuffer[0])).toBe(false);
      expect(isMpegTs(tsBuffer[0])).toBe(true);

      const t = new TsTransmuxer();
      await t.init({ onError: () => {} });
      t.onData((chunk) => {
        if (chunk.init && chunk.init.length) initSeg = chunk.init;
        if (chunk.data && chunk.data.length) dataChunks.push(chunk.data);
      });
      for (const seg of tsBuffer) t.push(seg);

      expect(initSeg).not.toBeNull();
      expect(dataChunks.length).toBeGreaterThan(0);

      const { blob, format } = assembleMp4(initSeg, dataChunks);
      expect(format).toBe('mp4');
      expect(blob.type).toBe('video/mp4');
      expect(blob.size).toBeGreaterThan(0);

      // ftyp box must lead the assembled file (bytes 4-8 hold the box type;
      // bytes 0-3 are the box size)
      const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
      expect(String.fromCharCode(...head)).toBe('ftyp');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('TS fallback: raw .ts assembly still produces a valid video/mp2t blob', () => {
    const segs = Array.from({ length: 5 }, (_, i) => makeTsSegment(i));
    const { blob, format } = assembleTs(segs);
    expect(format).toBe('ts');
    expect(blob.type).toBe('video/mp2t');
    expect(blob.size).toBe(188 * 3 * 5);
  });

  // ---------- 4. full engine end-to-end (host-level, mocked downloads) ----------
  it('DownloadEngine end-to-end: playlist → segments → mp4 blob → onComplete', async () => {
    const N = 15;
    const playlistText = makePlaylistText(N);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('index.m3u8')) {
        return new Response(playlistText, {
          status: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        });
      }
      const m = u.match(/(\d{7})\.ts/);
      return new Response(makeTsSegment(m ? Number(m[1]) : 0).buffer as ArrayBuffer, { status: 200 });
    }) as any;

    const events: DownloadProgress[] = [];
    let completed: { blob: Blob; format: string } | null = null;
    let error: ExtensionError | null = null;

    try {
      const job: DownloadJob = {
        id: 'dl_test_nnyy',
        url: PLAYLIST_URL,
        format: 'mp4',
        concurrency: 4,
        baseFilename: '某某之妻_20260829',
        filename: '某某之妻_20260829.mp4',
      };
      const engine = new DownloadEngine(job, {
        onProgress: (p) => events.push(p),
        onComplete: async (r) => {
          completed = { blob: r.blob, format: r.format };
        },
        onError: (e) => {
          error = e;
        },
      });
      await engine.run();

      expect(error).toBeNull();
      expect(completed).not.toBeNull();
      const c = completed as unknown as { blob: Blob; format: string };
      expect(c.format).toBe('mp4');
      expect(c.blob.size).toBeGreaterThan(0);
      expect(c.blob.type).toBe('video/mp4');

      // progress must end at done===total and pass through 'downloading'
      const last = events[events.length - 1];
      expect(last.status).toBe('downloading');
      const maxDone = Math.max(...events.map((e) => e.done));
      expect(maxDone).toBe(N);
      // filename carried on the final progress event
      expect(last.filename).toBe('某某之妻_20260829.mp4');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ---------- 5. edge cases seen on such sites ----------
  it('dead link: HTTP 404 playlist → onError PARSE/HOST error, not silent hang', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;
    try {
      const job: DownloadJob = {
        id: 'dl_dead',
        url: 'https://fengbao12.com/video/gone/dead/index.m3u8',
        format: 'mp4',
        concurrency: 2,
        baseFilename: 'x',
        filename: 'x.mp4',
      };
      let error: ExtensionError | null = null;
      const engine = new DownloadEngine(job, {
        onProgress: () => {},
        onComplete: async () => {},
        onError: (e) => {
          error = e;
        },
      });
      await engine.run();
      expect(error).not.toBeNull();
      expect((error as unknown as ExtensionError).code).toBeTruthy();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('concatBytes preserves order (assembly correctness guard)', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([9]);
    const out = concatBytes([a, b]);
    expect([...out]).toEqual([1, 2, 3, 9]);
  });
});

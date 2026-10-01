// Regression guard: the AES-128 decryptor must actually reach SegmentPool.
//
// History: engine.run() built a decryptor and passed it into runTsPath, but
// poolFor() hard-coded `decryptor: undefined` and never forwarded the argument
// from downloadFmp4Track either. Every encrypted segment was therefore emitted
// as raw ciphertext while the `canDecrypt` gate still passed — a silent
// corruption, not an error. These tests assert the plaintext that comes out.
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  (globalThis as any).__VITEST__ = true; // skip backoff sleeps
  (globalThis as any).chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

import { DownloadEngine } from '../src/lib/engine/engine';
import type { DownloadJob, DownloadProgress } from '../src/lib/types';
import { ExtensionError } from '../src/lib/errors';

const KEY_BYTES = new Uint8Array(16).map((_, i) => i + 1); // 1..16
const IV = new Uint8Array(16).fill(0);
IV[15] = 1; // 0x000...001, same value the playlist's IV=0x...01 parses to

/** Deterministic MPEG-TS-shaped plaintext: 8 packets of 188 bytes. */
function makePlain(seed: number): Uint8Array {
  const out = new Uint8Array(188 * 8);
  for (let p = 0; p < 8; p++) out[p * 188] = 0x47; // TS sync byte
  for (let i = 1; i < out.length; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

async function importEncryptKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', KEY_BYTES, { name: 'AES-CBC' }, false, ['encrypt']);
}

async function encryptSeg(plain: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: IV as unknown as BufferSource },
    key,
    plain as unknown as BufferSource,
  );
  return new Uint8Array(buf);
}

function makeEncryptedPlaylist(n: number): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001',
  ];
  for (let i = 0; i < n; i++) {
    lines.push('#EXTINF:1,');
    lines.push(`${String(i).padStart(7, '0')}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

function makeJob(url: string, format: 'ts' | 'mp4' = 'ts'): DownloadJob {
  return {
    id: 'dl_decrypt',
    url,
    format,
    concurrency: 3,
    baseFilename: 'enc',
    filename: 'enc.ts',
  };
}

/** Run the engine against a stubbed network; returns the completion result. */
async function runEngine(
  job: DownloadJob,
  playlistBody: string,
  segmentBody: (i: number) => Uint8Array | Promise<Uint8Array>,
  extraRoutes: Record<string, () => Uint8Array | Promise<Uint8Array>> = {},
): Promise<{ blob: Blob | null; error: ExtensionError | null; events: DownloadProgress[] }> {
  const origFetch = globalThis.fetch;
  const events: DownloadProgress[] = [];

  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    const route = extraRoutes[u];
    if (route) return new Response((await route()).buffer as ArrayBuffer, { status: 200 });
    if (/\.m3u8(\?|$)/.test(u)) return new Response(playlistBody, { status: 200 });
    if (u.endsWith('key.bin')) return new Response(KEY_BYTES.buffer as ArrayBuffer, { status: 200 });
    const m = u.match(/(\d{7})\.ts/);
    if (m) return new Response((await segmentBody(Number(m[1]))).buffer as ArrayBuffer, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as any;

  let blob: Blob | null = null;
  let error: ExtensionError | null = null;
  try {
    const engine = new DownloadEngine(job, {
      onProgress: (p) => events.push(p),
      onComplete: (r) => {
        blob = r.blob;
      },
      onError: (e) => {
        error = e;
      },
    });
    await engine.run();
  } finally {
    globalThis.fetch = origFetch;
  }
  return { blob, error, events };
}

describe('AES-128 decryption reaches the segment pool', () => {
  it('emits decrypted plaintext, not ciphertext', async () => {
    const N = 4;
    const key = await importEncryptKey();
    const plains = Array.from({ length: N }, (_, i) => makePlain(i));
    const ciphertexts = await Promise.all(plains.map((p) => encryptSeg(p, key)));

    // Sanity: the fixture really is encrypted (IV=0 leaves a repeated first
    // block, so compare the tail packets instead of the whole segment).
    expect(ciphertexts[0].length).toBeGreaterThan(plains[0].length); // PKCS#7 padding
    expect(Array.from(ciphertexts[0].slice(-32))).not.toEqual(
      Array.from(plains[0].slice(-32)),
    );

    const { blob, error } = await runEngine(
      makeJob('https://cdn/enc/index.m3u8'),
      makeEncryptedPlaylist(N),
      (i) => ciphertexts[i],
    );

    expect(error).toBeNull();
    expect(blob).not.toBeNull();

    const out = new Uint8Array(await blob!.arrayBuffer());
    const expected = new Uint8Array(N * plains[0].length);
    plains.forEach((p, i) => expected.set(p, i * p.length));

    expect(out.length).toBe(expected.length);
    expect(Array.from(out)).toEqual(Array.from(expected));
    // The ciphertext path would have produced longer, different bytes.
    expect(out.length).toBe(N * 188 * 8);
  });

  it('still works when the playlist declares no key at all', async () => {
    const N = 3;
    const plains = Array.from({ length: N }, (_, i) => makePlain(i));
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-ENDLIST',
      ...Array.from({ length: N }, (_, i) => `#EXTINF:1,\n${String(i).padStart(7, '0')}.ts`),
    ].join('\n');

    const { blob, error } = await runEngine(makeJob('https://cdn/plain/index.m3u8'), body, (i) => plains[i]);
    expect(error).toBeNull();
    const out = new Uint8Array(await blob!.arrayBuffer());
    expect(out.length).toBe(N * 188 * 8);
  });
});

describe('fMP4 track decryption guard', () => {
  // #EXT-X-MEDIA audio renditions carry their own #EXT-X-KEY. makeDecryptor()
  // swallows the failure and returns null, so without an explicit guard the
  // audio track would be concatenated as raw ciphertext.
  it('errors instead of emitting an undecryptable audio rendition', async () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="a"',
      'video.m3u8',
    ].join('\n');

    const video = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:2,',
      '0000000.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const audio = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"',
      '#EXTINF:2,',
      '0000000.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('master.m3u8')) return new Response(master, { status: 200 });
      if (u.endsWith('video.m3u8')) return new Response(video, { status: 200 });
      if (u.endsWith('audio.m3u8')) return new Response(audio, { status: 200 });
      if (u.endsWith('key.bin')) return new Response(KEY_BYTES.buffer as ArrayBuffer, { status: 200 });
      return new Response(new Uint8Array([0x00, 0x00, 0x00, 0x08]).buffer as ArrayBuffer, { status: 200 });
    }) as any;

    let error: ExtensionError | null = null;
    try {
      const engine = new DownloadEngine(makeJob('https://cdn/cmaf/master.m3u8', 'mp4'), {
        onProgress: () => {},
        onComplete: () => {},
        onError: (e) => {
          error = e;
        },
      });
      await engine.run();
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(error).not.toBeNull();
    expect(error!.code).toBe('DECRYPT');
  });
});

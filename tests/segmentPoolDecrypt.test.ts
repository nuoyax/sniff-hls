// Per-segment decryptor resolution (HLS key rotation) — see segmentPool.test.ts
// for retry/resume behavior of the same pool.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// fetcher imports the browser shim, which throws without a WebExtension runtime.
vi.stubGlobal('browser', {
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  runtime: { getURL: (p: string) => 'https://ext/' + p, id: 'test' },
  webRequest: {},
  proxy: {},
  downloads: {},
  offscreen: {},
  action: {},
  notifications: {},
  tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn() },
});

const { SegmentPool } = await import('../src/lib/engine/segmentPool');
const fetcher = await import('../src/lib/engine/fetcher');
import type { Segment, KeyInfo } from '../src/lib/types';

function seg(url: string, sequence = 0): Segment {
  return { url, duration: 6, sequence };
}

function makeKey(id: string): KeyInfo {
  return { method: 'AES-128', uri: `https://cdn.example.com/${id}.bin` };
}

/** Marker decryptor: prefixes the plaintext with the key id so tests can tell rotations apart. */
function markerDecryptor(id: string) {
  return {
    decrypt: vi.fn(async (bytes: Uint8Array, _seq: number) => {
      const tag = new TextEncoder().encode(id);
      const out = new Uint8Array(tag.length + bytes.length);
      out.set(tag, 0);
      out.set(bytes, tag.length);
      return out;
    }),
  };
}

describe('SegmentPool per-segment decryptor resolution', () => {
  beforeEach(() => {
    vi.spyOn(fetcher, 'fetchBytes').mockImplementation(async (url: string) => {
      return new TextEncoder().encode(`body:${url}`);
    });
  });

  it('uses a different decryptor per segment when keys rotate', async () => {
    const k1 = markerDecryptor('k1');
    const k2 = markerDecryptor('k2');
    const segments: Segment[] = [
      { ...seg('https://cdn.example.com/0.ts', 0), key: makeKey('k1') },
      { ...seg('https://cdn.example.com/1.ts', 1), key: makeKey('k1') },
      { ...seg('https://cdn.example.com/2.ts', 2), key: makeKey('k2') },
    ];
    const byUri: Record<string, ReturnType<typeof markerDecryptor>> = { k1, k2 };

    const pool = new SegmentPool({
      concurrency: 2,
      resolveDecryptor: (s) => byUri[s.key!.uri!.match(/k\d/)![0]],
    });

    const out: string[] = [];
    for await (const res of pool.run(segments)) {
      out.push(new TextDecoder().decode(res.bytes));
    }

    expect(out).toHaveLength(3);
    expect(out[0].startsWith('k1')).toBe(true);
    expect(out[1].startsWith('k1')).toBe(true);
    expect(out[2].startsWith('k2')).toBe(true);
    // Each key was asked to decrypt only the segments it covers.
    expect(k1.decrypt).toHaveBeenCalledTimes(2);
    expect(k2.decrypt).toHaveBeenCalledTimes(1);
  });

  it('leaves segments untouched when the resolver returns undefined (METHOD=NONE)', async () => {
    const segments: Segment[] = [
      { ...seg('https://cdn.example.com/clear.ts'), key: { method: 'NONE' } },
    ];
    const pool = new SegmentPool({ concurrency: 1, resolveDecryptor: () => undefined });
    const out: string[] = [];
    for await (const res of pool.run(segments)) out.push(new TextDecoder().decode(res.bytes));
    expect(out[0]).toBe('body:https://cdn.example.com/clear.ts');
  });

  it('falls back to the pool-level decryptor when there is no resolver', async () => {
    const fallback = markerDecryptor('fb');
    const pool = new SegmentPool({ concurrency: 1, decryptor: fallback as never });
    for await (const _ of pool.run([seg('https://cdn.example.com/a.ts')])) { /* drain */ }
    expect(fallback.decrypt).toHaveBeenCalledTimes(1);
  });

  it('emits results in playlist order even when later segments resolve first', async () => {
    vi.mocked(fetcher.fetchBytes).mockImplementation(async (url: string) => {
      // The first segment is slowest, forcing out-of-order completion.
      const delay = url.includes('0.ts') ? 20 : 0;
      await new Promise((r) => setTimeout(r, delay));
      return new TextEncoder().encode(url);
    });
    const segments = [
      seg('https://cdn.example.com/0.ts', 0),
      seg('https://cdn.example.com/1.ts', 1),
      seg('https://cdn.example.com/2.ts', 2),
    ];
    const pool = new SegmentPool({ concurrency: 3 });
    const order: number[] = [];
    for await (const res of pool.run(segments)) order.push(res.sequence);
    expect(order).toEqual([0, 1, 2]);
  });

  it('propagates a fetch failure to the caller', async () => {
    vi.mocked(fetcher.fetchBytes).mockRejectedValueOnce(new Error('boom'));
    const pool = new SegmentPool({ concurrency: 1 });
    const drain = async () => {
      for await (const _ of pool.run([seg('https://cdn.example.com/fail.ts')])) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow('boom');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const fetcher = await import('../src/lib/engine/fetcher');
const { createKeyResolver } = await import('../src/lib/engine/keyRegistry');
import type { Segment } from '../src/lib/types';

function seg(url: string, keyUri?: string): Segment {
  return {
    url,
    duration: 6,
    sequence: 0,
    key: keyUri ? { method: 'AES-128', uri: keyUri } : undefined,
  };
}

describe('createKeyResolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn(async () => ({ id: 'crypto-key' })),
        decrypt: vi.fn(async (_alg: unknown, _key: unknown, data: BufferSource) => data),
      },
      getRandomValues: (arr: Uint8Array) => arr,
    });
  });

  it('imports each distinct key URL exactly once', async () => {
    const fetchSpy = vi
      .spyOn(fetcher, 'fetchBytes')
      .mockResolvedValue(new Uint8Array(16).fill(7));

    const segments: Segment[] = [
      seg('https://cdn.example.com/0.ts', 'https://cdn.example.com/a.bin'),
      seg('https://cdn.example.com/1.ts', 'https://cdn.example.com/a.bin'),
      seg('https://cdn.example.com/2.ts', 'https://cdn.example.com/b.bin'),
    ];

    const resolve = await createKeyResolver(segments, null);

    // One fetch per distinct key URI, not per segment.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual([
      'https://cdn.example.com/a.bin',
      'https://cdn.example.com/b.bin',
    ]);

    // Same key → same decryptor instance; different key → different instance.
    expect(resolve(segments[0])).toBe(resolve(segments[1]));
    expect(resolve(segments[0])).not.toBe(resolve(segments[2]));
  });

  it('treats the same URI with different IVs as distinct keys', async () => {
    const fetchSpy = vi
      .spyOn(fetcher, 'fetchBytes')
      .mockResolvedValue(new Uint8Array(16).fill(1));
    const iv1 = new Uint8Array(16);
    const iv2 = new Uint8Array(16).fill(1);

    const segments: Segment[] = [
      { url: 's0.ts', duration: 1, sequence: 0, key: { method: 'AES-128', uri: 'https://k', iv: iv1 } },
      { url: 's1.ts', duration: 1, sequence: 1, key: { method: 'AES-128', uri: 'https://k', iv: iv2 } },
    ];
    const resolve = await createKeyResolver(segments, null);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(resolve(segments[0])).not.toBe(resolve(segments[1]));
  });

  it('returns undefined for segments with no key', async () => {
    const resolve = await createKeyResolver([seg('https://cdn.example.com/x.ts')], null);
    expect(resolve(seg('https://cdn.example.com/x.ts'))).toBeUndefined();
  });

  it('returns undefined for METHOD=NONE segments', async () => {
    const segments: Segment[] = [
      { url: 'x.ts', duration: 1, sequence: 0, key: { method: 'NONE' } },
    ];
    const resolve = await createKeyResolver(segments, null);
    expect(resolve(segments[0])).toBeUndefined();
  });

  it('falls back to the playlist-level decryptor when a segment has no key', async () => {
    const fallback = { decrypt: vi.fn(async (b: Uint8Array) => b) };
    const resolve = await createKeyResolver([seg('https://cdn.example.com/x.ts')], fallback);
    expect(resolve(seg('https://cdn.example.com/x.ts'))).toBe(fallback);
  });

  it('rejects before any download when a rotated key uses an unsupported method', async () => {
    const segments: Segment[] = [
      seg('https://cdn.example.com/0.ts', 'https://cdn.example.com/a.bin'),
      { url: '1.ts', duration: 1, sequence: 1, key: { method: 'SAMPLE-AES', uri: 'https://cdn.example.com/sample.bin' } },
    ];
    await expect(createKeyResolver(segments, null)).rejects.toThrow();
  });

  it('surfaces a key fetch failure', async () => {
    vi.spyOn(fetcher, 'fetchBytes').mockRejectedValue(new Error('404 key'));
    const segments: Segment[] = [seg('https://cdn.example.com/0.ts', 'https://cdn.example.com/missing.bin')];
    await expect(createKeyResolver(segments, null)).rejects.toThrow('404 key');
  });
});

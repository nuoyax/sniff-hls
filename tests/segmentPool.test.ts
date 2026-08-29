// Tests for segment retry + resume skip behavior in SegmentPool.
// Mocks global fetch (which real fetchBytes calls) so fetchBytes' own
// internal retry loop is exercised; __VITEST__ skips backoff sleeps.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
  (globalThis as any).__VITEST__ = true;
});

// Per-URL remaining failures; each fetch attempt for that URL consumes one.
const failuresByUrl = new Map<string, number>();
const attemptsByUrl = new Map<string, number>();

afterEach(() => {
  failuresByUrl.clear();
  attemptsByUrl.clear();
  vi.unstubAllGlobals();
});

/** Stub global fetch: fails per failuresByUrl, then returns 3 bytes. */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      attemptsByUrl.set(u, (attemptsByUrl.get(u) ?? 0) + 1);
      const remaining = failuresByUrl.get(u) ?? 0;
      if (remaining > 0) {
        failuresByUrl.set(u, remaining - 1);
        return new Response('server busy', { status: 503 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }),
  );
}

import { SegmentPool } from '../src/lib/engine/segmentPool';
import type { Segment } from '../src/lib/types';

function seg(seq: number): Segment {
  return { url: `https://cdn/seg${seq}.ts`, duration: 4, sequence: seq };
}

async function collect(pool: SegmentPool, segments: Segment[]) {
  const out: number[] = [];
  for await (const r of pool.run(segments)) out.push(r.sequence);
  return out;
}

describe('SegmentPool retry + resume', () => {
  it('retries failed segments until success (fetchBytes internal loop)', async () => {
    stubFetch();
    failuresByUrl.set('https://cdn/seg1.ts', 2); // fails twice, 3rd attempt OK
    const pool = new SegmentPool({ concurrency: 2, retries: 3 });
    const out = await collect(pool, [seg(0), seg(1), seg(2)]);
    expect(out).toEqual([0, 1, 2]);
    expect(attemptsByUrl.get('https://cdn/seg1.ts')).toBe(3);
  });

  it('gives up after retries exhausted and surfaces the error', async () => {
    stubFetch();
    failuresByUrl.set('https://cdn/seg1.ts', 99);
    const pool = new SegmentPool({ concurrency: 2, retries: 1 });
    await expect(collect(pool, [seg(0), seg(1)])).rejects.toThrow(/HTTP 503/);
    expect(attemptsByUrl.get('https://cdn/seg1.ts')).toBe(2); // 1 + retries
  });

  it('skips segments listed in skipIndices (resume) but still yields order', async () => {
    stubFetch();
    const pool = new SegmentPool({
      concurrency: 2,
      retries: 0,
      skipIndices: new Set([1]),
    });
    const out = await collect(pool, [seg(0), seg(1), seg(2)]);
    // seq 1 skipped — not fetched, not yielded; caller re-injects its bytes.
    expect(out).toEqual([0, 2]);
    expect(attemptsByUrl.has('https://cdn/seg1.ts')).toBe(false);
  });

  it('reports onSegmentDone for each fetched segment', async () => {
    stubFetch();
    const done: number[] = [];
    const pool = new SegmentPool({ concurrency: 3, retries: 0, onSegmentDone: (s) => done.push(s) });
    await collect(pool, [seg(0), seg(1), seg(2)]);
    expect(done.sort()).toEqual([0, 1, 2]);
  });
});

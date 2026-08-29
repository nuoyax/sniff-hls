// Concurrency-limited segment fetcher that emits results in playlist order.
// Bounded buffer with backpressure: won't fetch ahead beyond maxBufferedBytes.
import { fetchBytes } from './fetcher';
import type { Segment, KeyInfo } from '../types';
import { createDecryptor, type Decryptor } from './aesDecryptor';
import log from '../log';

export interface SegmentResult {
  sequence: number;
  bytes: Uint8Array;
}

export interface PoolOptions {
  concurrency: number;
  /** Max bytes buffered ahead of emission (backpressure). */
  maxBufferedBytes?: number;
  decryptor?: Decryptor;
  keyInfo?: KeyInfo;
  /** Retry attempts per segment on network/HTTP errors (default 3). */
  retries?: number;
  /** Segment indices to skip (already fetched in a previous attempt — resume). */
  skipIndices?: Set<number>;
  /** Called after a segment is fetched+decrypted (for resume checkpoints). */
  onSegmentDone?: (sequence: number) => void;
  onProgress?: (done: number, total: number, bytes: number) => void;
  signal?: AbortSignal;
}

interface Pending {
  segment: Segment;
  promise: Promise<Uint8Array>;
  index: number;
}

/**
 * Fetch + decrypt segments concurrently but yield results in order.
 * Caller drains the async iterator.
 */
export class SegmentPool {
  private opts: PoolOptions;
  private decryptor: Decryptor | null;
  private buffered = 0;
  private bytesLoaded = 0;
  private done = 0;
  /** When set, new segment launches are held back (pause support). */
  private paused = false;
  private resumeWaiters: (() => void)[] = [];

  constructor(opts: PoolOptions) {
    this.opts = opts;
    this.decryptor = opts.decryptor ?? null;
  }

  /** Pause launching new segments. In-flight requests are left to finish and
   * their bytes kept; nothing new starts while paused. The SW broadcasts
   * 'paused' instantly, so no progress event is needed here. */
  pause(): void {
    this.paused = true;
  }

  /** Resume launching segments. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const w of this.resumeWaiters.splice(0)) w();
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused) {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
    }
  }

  async *run(segments: Segment[]): AsyncIterable<SegmentResult> {
    const total = segments.length;
    let emitIndex = 0;
    const results = new Map<number, Uint8Array>();
    const queue: Pending[] = [];
    let inputIndex = 0;
    const skip = this.opts.skipIndices;

    const launch = (seg: Segment) => {
      const promise = (async () => {
        await this.waitWhilePaused();
        return this.fetchOne(seg);
      })().catch((e) => {
        throw e;
      });
      queue.push({ segment: seg, promise, index: inputIndex++ });
    };

    // Prime the queue, skipping segments already fetched in a prior attempt.
    while (queue.length < this.opts.concurrency && inputIndex < segments.length) {
      if (skip?.has(segments[inputIndex].sequence)) {
        inputIndex++;
        continue;
      }
      launch(segments[inputIndex]);
    }

    while (queue.length) {
      // Wait for the head to resolve (preserve order).
      const head = queue[0];
      let bytes: Uint8Array;
      try {
        bytes = await head.promise;
      } catch (e) {
        throw e;
      }
      queue.shift();
      this.buffered -= bytes.length;

      results.set(head.index, bytes);

      // Emit any contiguous results, advancing past skipped segments
      // (they were fetched in a prior attempt and are re-injected by the caller).
      while (results.has(emitIndex) || skip?.has(emitIndex)) {
        if (results.has(emitIndex)) {
          const b = results.get(emitIndex)!;
          results.delete(emitIndex);
          yield { sequence: emitIndex, bytes: b };
        }
        emitIndex++;
      }

      // Backpressure: launch next only if buffer budget allows.
      while (
        queue.length < this.opts.concurrency &&
        inputIndex < segments.length &&
        this.buffered < (this.opts.maxBufferedBytes ?? 256 * 1024 * 1024)
      ) {
        if (this.paused) {
          await this.waitWhilePaused();
          continue;
        }
        if (skip?.has(segments[inputIndex].sequence)) {
          inputIndex++;
          continue;
        }
        launch(segments[inputIndex]);
      }
    }
  }

  private async fetchOne(seg: Segment): Promise<Uint8Array> {
    if (this.opts.signal?.aborted) throw new Error('canceled');
    const raw = await fetchBytes(seg.url, {
      byterange: seg.byterange,
      timeoutMs: 90_000,
      retries: this.opts.retries ?? 3,
    });
    if (this.opts.signal?.aborted) throw new Error('canceled');
    const dec = this.decryptor ? await this.decryptor.decrypt(raw, seg.sequence) : raw;
    this.buffered += dec.length;
    this.bytesLoaded += dec.length;
    this.done++;
    this.opts.onSegmentDone?.(seg.sequence);
    this.opts.onProgress?.(this.done, 0, this.bytesLoaded);
    return dec;
  }
}

/** Convenience: build a decryptor if key info present. */
export async function makeDecryptor(keyInfo?: KeyInfo): Promise<Decryptor | null> {
  if (!keyInfo || keyInfo.method === 'NONE') return null;
  try {
    return await createDecryptor(keyInfo);
  } catch (e) {
    log.warn('decryptor unavailable; will fall back to raw ts', e);
    return null;
  }
}

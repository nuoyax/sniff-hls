// mux.js wrapper: transmux MPEG-TS segments → fragmented MP4 (fMP4),
// without re-encoding. Reuses a single Transmuxer instance for PES continuity.
import { ExtensionError } from '../errors';
import log from '../log';

type TransmuxerType = any;

let TransmuxerCtor: TransmuxerType | null = null;

async function getTransmuxer(): Promise<TransmuxerType> {
  if (TransmuxerCtor) return TransmuxerCtor;
  // mux.js v6 ESM shape: default export is { codecs, mp4, flv, mp2t, partial }
  // and Transmuxer lives at default.mp4.Transmuxer (not the default itself).
  // @ts-expect-error — mux.js ships no bundled types; treat as any.
  const mod: any = await import('mux.js');
  const root = mod?.default ?? mod;
  TransmuxerCtor =
    root?.mp4?.Transmuxer ||
    mod?.mp4?.Transmuxer ||
    root?.Transmuxer ||
    mod?.Transmuxer;
  if (typeof TransmuxerCtor !== 'function') {
    throw new ExtensionError('TRANSMUX', 'mux.js Transmuxer not found');
  }
  return TransmuxerCtor;
}

export interface Mp4Chunk {
  init: Uint8Array | null;
  data: Uint8Array;
}

export interface TransmuxOptions {
  onError?: (e: Error) => void;
}

export class TsTransmuxer {
  private transmuxer: any = null;
  private initSegment: Uint8Array | null = null;
  private dataHandler: ((chunk: Mp4Chunk) => void) | null = null;

  async init(opts: TransmuxOptions = {}): Promise<void> {
    const Ctor = await getTransmuxer();
    this.transmuxer = new Ctor();
    this.transmuxer.on('data', (segment: any) => {
      try {
        if (segment.type === 'combined' || segment.initSegment) {
          if (segment.initSegment && segment.initSegment.length) {
            this.initSegment = segment.initSegment;
          }
        }
        const data: Uint8Array = segment.data;
        if (data && data.length) {
          this.dataHandler?.({ init: this.initSegment, data });
        }
      } catch (e) {
        opts.onError?.(e as Error);
      }
    });
    this.transmuxer.on('done', () => {
      /* no-op; per-segment flush used */
    });
  }

  onData(cb: (chunk: Mp4Chunk) => void): void {
    this.dataHandler = cb;
  }

  /** Push one decrypted .ts segment and flush. */
  push(ts: Uint8Array): void {
    if (!this.transmuxer) throw new ExtensionError('TRANSMUX', 'transmuxer not initialized');
    this.transmuxer.push(ts as unknown as BufferSource);
    this.transmuxer.flush();
  }
  reset(): void {
    this.initSegment = null;
    try {
      this.transmuxer?.reset();
    } catch {
      /* noop */
    }
  }
}

/** Concatenate Uint8Array chunks into one. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

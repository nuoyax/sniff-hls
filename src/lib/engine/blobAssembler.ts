// Assemble transmuxed fMP4 chunks (or raw .ts) into a final Blob.
// Lives in the host (DOM) context where Blob + URL.createObjectURL exist.
import type { OutputFormat } from '../types';
import { concatBytes } from './transmuxer';

export interface AssembleResult {
  blob: Blob;
  format: OutputFormat;
}

/** Assemble fMP4: emit init segment once, then concatenated data segments. */
export function assembleMp4(init: Uint8Array | null, dataChunks: Uint8Array[]): AssembleResult {
  const parts: BlobPart[] = [];
  if (init && init.length) parts.push(toBlobPart(init));
  for (const d of dataChunks) if (d && d.length) parts.push(toBlobPart(d));
  const blob = new Blob(parts, { type: 'video/mp4' });
  return { blob, format: 'mp4' };
}

/** Assemble raw .ts fallback. */
export function assembleTs(segments: Uint8Array[]): AssembleResult {
  const blob = new Blob(segments.map(toBlobPart), { type: 'video/mp2t' });
  return { blob, format: 'ts' };
}

/** Coerce a Uint8Array to a BlobPart acceptable to the DOM lib (TS 5.7). */
function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}

/** Estimate an output filename extension for a format. */
export function extFor(format: OutputFormat): string {
  return format === 'ts' ? 'ts' : 'mp4';
}

/** Convenience: create a blob URL. Must be revoked by caller. */
export function toObjectURL(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export { concatBytes };

// Per-segment key resolution.
//
// RFC 8216 §4.3.2.4 gives every media segment the key that was in effect when
// its #EXT-X-KEY tag appeared: playlists may rotate between AES-128 keys, or
// turn encryption off mid-stream with METHOD=NONE. This module resolves one
// decryptor per distinct key, importing every key in the playlist up front so
// an unsupported rotation fails before any segment is downloaded.
import { createDecryptor, type Decryptor } from './aesDecryptor';
import type { KeyInfo, Segment } from '../types';

/** Stable identity for a key: URI alone is not enough — the IV may differ. */
function keyId(key: KeyInfo): string {
  const iv = key.iv ? Array.from(key.iv).join(',') : '';
  return `${key.method}:${key.uri ?? ''}:${iv}`;
}

export interface KeyResolver {
  /** Decryptor for a segment, or undefined when the segment is unencrypted. */
  (segment: Segment): Decryptor | undefined;
}

/**
 * Import every distinct key referenced by `segments`.
 *
 * @param fallback Decryptor for segments without their own key, i.e. the
 *   playlist-level key. Pass null when the playlist carries no key at all.
 * @throws when a key uses an unsupported method or cannot be fetched.
 */
export async function createKeyResolver(
  segments: Segment[],
  fallback: Decryptor | null,
): Promise<KeyResolver> {
  const byId = new Map<string, Promise<Decryptor>>();

  for (const seg of segments) {
    const key = seg.key;
    if (!key || key.method === 'NONE') continue;
    const id = keyId(key);
    if (!byId.has(id)) byId.set(id, createDecryptor(key));
  }

  // Fail fast: all keys must be importable before the pool starts fetching.
  const resolved = new Map<string, Decryptor>();
  for (const [id, promise] of byId) resolved.set(id, await promise);

  return (segment: Segment): Decryptor | undefined => {
    const key = segment.key;
    if (!key) return fallback ?? undefined;
    if (key.method === 'NONE') return undefined;
    return resolved.get(keyId(key)) ?? fallback ?? undefined;
  };
}

// AES-128 HLS decryption using WebCrypto (crypto.subtle).
// Handles #EXT-X-KEY:METHOD=AES-128 with explicit IV or sequence-derived IV
// (per RFC 8216: IV = sequence as big-endian 16-byte int).
import { fetchBytes } from './fetcher';
import { ExtensionError } from '../errors';
import type { KeyInfo } from '../types';
import log from '../log';

const keyCache = new Map<string, Uint8Array>();
const cryptoKeyCache = new Map<string, Promise<CryptoKey>>();

async function fetchKey(uri: string): Promise<Uint8Array> {
  if (keyCache.has(uri)) return keyCache.get(uri)!;
  const bytes = await fetchBytes(uri, { timeoutMs: 15_000, retries: 3 });
  if (bytes.length !== 16) {
    throw new ExtensionError('DECRYPT', `AES-128 key must be 16 bytes, got ${bytes.length}`);
  }
  keyCache.set(uri, bytes);
  return bytes;
}

async function importKey(uri: string, raw: Uint8Array): Promise<CryptoKey> {
  const cached = cryptoKeyCache.get(uri);
  if (cached) return cached;
  const p = crypto.subtle.importKey('raw', toBufferSource(raw), { name: 'AES-CBC' }, false, ['decrypt']);
  cryptoKeyCache.set(uri, p);
  return p;
}

/** Coerce a Uint8Array to a BufferSource acceptable to WebCrypto (TS 5.7 lib). */
function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** Derive IV from segment sequence (RFC 8216). */
export function ivFromSequence(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  // big-endian in the last 8 bytes
  const dv = new DataView(iv.buffer);
  dv.setUint32(8, Math.floor(seq / 2 ** 32));
  dv.setUint32(12, seq >>> 0);
  return iv;
}

export interface Decryptor {
  decrypt(segment: Uint8Array, seq: number): Promise<Uint8Array>;
}

/** Create a decryptor bound to a key info. NONE → passthrough. */
export async function createDecryptor(keyInfo: KeyInfo | undefined): Promise<Decryptor> {
  if (!keyInfo || keyInfo.method === 'NONE') {
    return {
      async decrypt(segment: Uint8Array): Promise<Uint8Array> {
        return segment;
      },
    };
  }
  if (keyInfo.method !== 'AES-128') {
    // SAMPLE-AES and others: not supported → caller will fall back to raw .ts
    throw new ExtensionError('DECRYPT', `Unsupported key method: ${keyInfo.method}`);
  }
  if (!keyInfo.uri) {
    throw new ExtensionError('DECRYPT', 'AES-128 key missing URI');
  }

  const rawKey = await fetchKey(keyInfo.uri);
  const cryptoKey = await importKey(keyInfo.uri, rawKey);
  log.info('decryptor ready for', keyInfo.uri);

  return {
    async decrypt(segment: Uint8Array, seq: number): Promise<Uint8Array> {
      const iv = keyInfo.iv ?? ivFromSequence(seq);
      try {
        const dec = await crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: toBufferSource(iv) },
          cryptoKey,
          toBufferSource(segment),
        );
        return new Uint8Array(dec);
      } catch (e) {
        throw new ExtensionError('DECRYPT', 'AES-CBC decrypt failed', e);
      }
    },
  };
}

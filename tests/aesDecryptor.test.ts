import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionError } from '../src/lib/errors';

// aesDecryptor imports the browser shim, which throws if no WebExtension
// runtime is present. Provide a minimal stub before importing the module.
const storage = {
  local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
};
vi.stubGlobal('browser', {
  storage,
  runtime: { getURL: (p: string) => 'https://ext/' + p },
  webRequest: {},
  proxy: {},
  downloads: {},
  offscreen: {},
  action: {},
  notifications: {},
  tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn() },
});

const aes = await import('../src/lib/engine/aesDecryptor');

describe('AES-128 IV derivation (RFC 8216)', () => {
  it('derives IV 0 as 16 zero bytes', () => {
    const iv = aes.ivFromSequence(0);
    expect(iv.length).toBe(16);
    expect(iv.every((b) => b === 0)).toBe(true);
  });

  it('derives IV for sequence 1 with last byte = 1', () => {
    const iv = aes.ivFromSequence(1);
    expect(iv.length).toBe(16);
    expect(iv[15]).toBe(1);
    expect(iv[0]).toBe(0);
  });

  it('derives IV for a large sequence spanning the high 32 bits', () => {
    const iv = aes.ivFromSequence(0x1_0000_0001);
    const dv = new DataView(iv.buffer);
    expect(dv.getUint32(8)).toBe(1);
    expect(dv.getUint32(12)).toBe(1);
  });
});

describe('ExtensionError classification', () => {
  it('produces a human message and code', () => {
    const e = new ExtensionError('DECRYPT', 'bad key');
    expect(e.code).toBe('DECRYPT');
    expect(e.toHuman()).toBe('bad key');
    const e2 = new ExtensionError('TRANSMUX');
    expect(e2.code).toBe('TRANSMUX');
  });
});

describe('createDecryptor', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn(),
        decrypt: vi.fn(),
      },
      getRandomValues: (arr: Uint8Array) => arr,
    });
  });

  it('returns a passthrough decryptor for NONE', async () => {
    const d = await aes.createDecryptor({ method: 'NONE' });
    const seg = new Uint8Array([1, 2, 3]);
    const out = await d.decrypt(seg, 0);
    expect(out).toBe(seg);
  });

  it('throws on unsupported method', async () => {
    await expect(aes.createDecryptor({ method: 'SAMPLE-AES' })).rejects.toThrow();
  });
});


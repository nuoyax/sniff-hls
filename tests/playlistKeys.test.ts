import { describe, it, expect } from 'vitest';
import { parsePlaylist, parseByterange, pickVariant } from '../src/lib/engine/m3u8Parser';
import type { Segment, VariantInfo } from '../src/lib/types';

describe('parseByterange', () => {
  it('parses length@offset', () => {
    expect(parseByterange('32768@2048')).toEqual({ length: 32768, offset: 2048 });
  });

  it('reports -1 when the offset is omitted', () => {
    expect(parseByterange('1024')).toEqual({ length: 1024, offset: -1 });
  });

  it('returns undefined for garbage', () => {
    expect(parseByterange('abc')).toBeUndefined();
    expect(parseByterange('')).toBeUndefined();
  });
});

const ROTATING_KEYS = `#EXTM3U
#EXT-X-VERSION:5
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key1.bin"
#EXTINF:6,
seg0.ts
#EXTINF:6,
seg1.ts
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key2.bin",IV=0x000102030405060708090a0b0c0d0e0f
#EXTINF:6,
seg2.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:6,
seg3.ts
#EXT-X-ENDLIST
`;

describe('parsePlaylist key rotation (RFC 8216 §4.3.2.4)', () => {
  const pl = parsePlaylist(ROTATING_KEYS, 'https://cdn.example.com/index.m3u8');

  it('stamps each segment with the key in effect', () => {
    expect(pl.segments).toHaveLength(4);
    expect(pl.segments[0].key?.uri).toBe('https://cdn.example.com/key1.bin');
    expect(pl.segments[1].key?.uri).toBe('https://cdn.example.com/key1.bin');
    expect(pl.segments[2].key?.uri).toBe('https://cdn.example.com/key2.bin');
    // METHOD=NONE ends encryption from that point on.
    expect(pl.segments[3].key?.method).toBe('NONE');
  });

  it('carries the explicit IV of the rotated key', () => {
    expect(pl.segments[2].key?.iv).toBeDefined();
    expect(pl.segments[2].key!.iv![15]).toBe(0x0f);
    // The first key had no IV → sequence-derived.
    expect(pl.segments[0].key?.iv).toBeUndefined();
  });

  it('keeps the first key on the playlist for backwards compatibility', () => {
    expect(pl.key?.uri).toBe('https://cdn.example.com/key1.bin');
  });
});

const IMPLICIT_BYTERANGE = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:4,
#EXT-X-BYTERANGE:1000@720
chunk.m4s
#EXTINF:4,
#EXT-X-BYTERANGE:1000
chunk.m4s
#EXTINF:4,
#EXT-X-BYTERANGE:1000@4000
chunk.m4s
#EXT-X-ENDLIST
`;

describe('parsePlaylist implicit byte-range chaining', () => {
  const pl = parsePlaylist(IMPLICIT_BYTERANGE, 'https://cdn.example.com/b.m3u8');

  it('continues after the previous sub-range when @offset is omitted', () => {
    expect(pl.segments[0].byterange).toEqual({ offset: 720, length: 1000 });
    expect(pl.segments[1].byterange).toEqual({ offset: 1720, length: 1000 });
  });

  it('honours an explicit offset when given', () => {
    expect(pl.segments[2].byterange).toEqual({ offset: 4000, length: 1000 });
  });
});

const ENCRYPTED_MAP = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/k.bin"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6,
s0.m4s
#EXT-X-ENDLIST
`;

describe('parsePlaylist encrypted init segment', () => {
  it('records the key active when #EXT-X-MAP was declared', () => {
    const pl = parsePlaylist(ENCRYPTED_MAP, 'https://cdn.example.com/i.m3u8');
    expect(pl.initSegment?.key?.uri).toBe('https://cdn.example.com/k.bin');
    expect(pl.segments[0].key?.uri).toBe('https://cdn.example.com/k.bin');
  });
});

describe('pickVariant', () => {
  const variants: VariantInfo[] = [
    { url: 'low.m3u8', bandwidth: 400_000 },
    { url: 'mid.m3u8', bandwidth: 1_500_000 },
    { url: 'high.m3u8', bandwidth: 4_000_000 },
  ];

  it('picks the highest bandwidth by default', () => {
    expect(pickVariant(variants)?.url).toBe('high.m3u8');
    expect(pickVariant(variants, 'highest')?.url).toBe('high.m3u8');
  });

  it('picks the lowest when the user prefers it', () => {
    expect(pickVariant(variants, 'lowest')?.url).toBe('low.m3u8');
  });

  it('returns undefined for an empty list', () => {
    expect(pickVariant([], 'lowest')).toBeUndefined();
  });
});

describe('segment key typing', () => {
  it('exposes per-segment key on the Segment type', () => {
    const seg: Segment = {
      url: 'https://cdn.example.com/s.ts',
      duration: 6,
      sequence: 0,
      key: { method: 'AES-128', uri: 'https://cdn.example.com/k.bin' },
    };
    expect(seg.key?.method).toBe('AES-128');
  });
});

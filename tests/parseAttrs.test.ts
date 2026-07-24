import { describe, it, expect } from 'vitest';
import { parseAttrs, parseByterange, parseMap, parsePlaylist } from '../src/lib/engine/m3u8Parser';

describe('parseAttrs (quoted byterange)', () => {
  it('parses BYTERANGE="718@0" as a quoted value', () => {
    const a = parseAttrs('URI="init.mp4",BYTERANGE="718@0"');
    expect(a.URI).toBe('init.mp4');
    expect(a.BYTERANGE).toBe('718@0');
  });
  it('parses unquoted BYTERANGE=32768@2048', () => {
    const a = parseAttrs('BYTERANGE=32768@2048');
    expect(a.BYTERANGE).toBe('32768@2048');
  });
});

describe('parseByterange', () => {
  it('parses length@offset', () => {
    expect(parseByterange('718@0')).toEqual({ length: 718, offset: 0 });
    expect(parseByterange('32768@2048')).toEqual({ length: 32768, offset: 2048 });
  });
  it('parses length only → offset -1', () => {
    expect(parseByterange('32768')).toEqual({ length: 32768, offset: -1 });
  });
});

describe('parseMap', () => {
  it('parses init segment with quoted byterange', () => {
    const init = parseMap('#EXT-X-MAP:URI="init.mp4",BYTERANGE="718@0"', 'https://cdn.example.com/b.m3u8');
    expect(init).toBeDefined();
    expect(init!.uri).toBe('https://cdn.example.com/init.mp4');
    expect(init!.byterange).toEqual({ offset: 0, length: 718 });
  });
});

import { describe, it, expect } from 'vitest';
import {
  isM3u8Url,
  isHlsContentType,
  normalizeUrl,
  resolveUrl,
  deriveBaseFilename,
} from '../src/lib/detection/urlNormalizer';

describe('isM3u8Url', () => {
  it('matches .m3u8 and .m3u with query/fragment', () => {
    expect(isM3u8Url('https://x.com/a/b.m3u8')).toBe(true);
    expect(isM3u8Url('https://x.com/a/b.m3u8?token=1#f')).toBe(true);
    expect(isM3u8Url('https://x.com/a/b.m3u')).toBe(true);
  });
  it('rejects non-m3u8', () => {
    expect(isM3u8Url('https://x.com/a/b.ts')).toBe(false);
    expect(isM3u8Url('https://x.com/a/bmp4')).toBe(false);
    expect(isM3u8Url('')).toBe(false);
  });
});

describe('isHlsContentType', () => {
  it('matches HLS content types case-insensitively', () => {
    expect(isHlsContentType('application/vnd.apple.mpegurl')).toBe(true);
    expect(isHlsContentType('Application/X-MPEGURL; charset=utf-8')).toBe(true);
    expect(isHlsContentType('text/html')).toBe(false);
    expect(isHlsContentType(null)).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('strips fragment and drops tracking params, sorts keys', () => {
    const n = normalizeUrl('https://x.com/a.m3u8?utm_source=foo&b=2&a=1#frag');
    expect(n).toContain('a=1');
    expect(n).toContain('b=2');
    expect(n).not.toContain('utm_source');
    expect(n).not.toContain('#');
  });
});

describe('resolveUrl', () => {
  it('resolves relative URLs against a base', () => {
    expect(resolveUrl('https://cdn.x.com/p/master.m3u8', '720p.m3u8')).toBe(
      'https://cdn.x.com/p/720p.m3u8',
    );
    expect(resolveUrl('https://cdn.x.com/p/master.m3u8', '/abs/q.m3u8')).toBe(
      'https://cdn.x.com/abs/q.m3u8',
    );
  });
});

describe('deriveBaseFilename', () => {
  it('derives a slug from host + path', () => {
    const f = deriveBaseFilename('https://www.example.com/v/clip-123.m3u8?token=x');
    expect(f).toBe('example-clip-123');
  });
});

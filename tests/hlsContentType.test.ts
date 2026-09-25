import { describe, it, expect } from 'vitest';
import {
  extractM3u8Url,
  isM3u8Url,
  isHlsContentType,
  normalizeUrl,
} from '../src/lib/detection/urlNormalizer';

describe('isHlsContentType', () => {
  it('accepts the canonical HLS mime types', () => {
    expect(isHlsContentType('application/vnd.apple.mpegurl')).toBe(true);
    expect(isHlsContentType('application/x-mpegURL')).toBe(true);
    expect(isHlsContentType('audio/mpegurl')).toBe(true);
  });

  it('ignores charset parameters and surrounding whitespace', () => {
    expect(isHlsContentType('  application/vnd.apple.mpegurl; charset=utf-8 ')).toBe(true);
  });

  it('rejects unrelated types', () => {
    expect(isHlsContentType('application/octet-stream')).toBe(false);
    expect(isHlsContentType('text/html')).toBe(false);
    expect(isHlsContentType('video/mp2t')).toBe(false);
    expect(isHlsContentType(undefined)).toBe(false);
    expect(isHlsContentType(null)).toBe(false);
    expect(isHlsContentType('')).toBe(false);
  });
});

describe('content-type detected playlists with extension-less URLs', () => {
  it('is not URL-detectable but is content-type detectable', () => {
    const url = 'https://cdn.example.com/hls/playback?token=abc';
    expect(isM3u8Url(url)).toBe(false);
    expect(isHlsContentType('application/vnd.apple.mpegurl')).toBe(true);
  });

  it('still detects extension-less playlists that are wrapped in ?url=', () => {
    const wrapped =
      'https://player.example.com/proxy?url=' +
      encodeURIComponent('https://cdn.example.com/index.m3u8');
    expect(extractM3u8Url(wrapped)).toBe('https://cdn.example.com/index.m3u8');
  });

  it('normalizes an extension-less URL unchanged', () => {
    const url = 'https://cdn.example.com/hls/playback?token=abc';
    expect(normalizeUrl(url)).toBe(url);
  });
});

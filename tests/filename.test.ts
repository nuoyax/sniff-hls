import { describe, it, expect } from 'vitest';
import { sanitizeTitleStem, buildDefaultFilename, timestampString, deriveBaseFilename } from '../src/lib/detection/urlNormalizer';

describe('sanitizeTitleStem', () => {
  it('removes OS-illegal and special chars', () => {
    expect(sanitizeTitleStem('My Video: Best <clips> 2024!')).toBe('My Video Best clips 2024');
  });
  it('collapses whitespace', () => {
    // tabs/newlines are stripped as special chars, then remaining spaces collapse
    expect(sanitizeTitleStem('a    b   c')).toBe('a b c');
  });
  it('keeps CJK characters', () => {
    expect(sanitizeTitleStem('我的视频 #1 / part2')).toBe('我的视频 1 part2');
  });
  it('strips leading/trailing spaces and slashes', () => {
    expect(sanitizeTitleStem('  /some/ path  ')).toBe('some path');
  });
  it('falls back to "video" when empty', () => {
    expect(sanitizeTitleStem('')).toBe('video');
    expect(sanitizeTitleStem('***???')).toBe('video');
  });
});

describe('timestampString', () => {
  it('produces a YYYYMMDD_HHMMSS string', () => {
    const ts = timestampString(new Date('2026-07-24T15:30:45').getTime());
    expect(ts).toMatch(/^\d{8}_\d{6}$/);
  });
  it('zero-pads single-digit fields', () => {
    const ts = timestampString(new Date('2026-01-02T03:04:05').getTime());
    expect(ts).toBe('20260102_030405');
  });
});

describe('buildDefaultFilename', () => {
  it('combines sanitized title + timestamp', () => {
    const f = buildDefaultFilename('Cool Clip!');
    const m = f.match(/^(.+)_(\d{8}_\d{6})$/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('Cool Clip');
  });
  it('falls back to "video" with no title', () => {
    const f = buildDefaultFilename(undefined);
    expect(f).toMatch(/^video_\d{8}_\d{6}$/);
  });
});

describe('deriveBaseFilename', () => {
  it('derives a slug from host + path', () => {
    const f = deriveBaseFilename('https://www.example.com/v/clip-123.m3u8?token=x');
    expect(f).toBe('example-clip-123');
  });
});

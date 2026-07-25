import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { concatFmp4Track, mergeFmp4Tracks } from '../src/lib/engine/fmp4Merge';

describe('concatFmp4Track', () => {
  it('concatenates init + media in order', () => {
    const init = new Uint8Array([1, 2, 3]);
    const m0 = new Uint8Array([4, 5]);
    const m1 = new Uint8Array([6]);
    const out = concatFmp4Track({ init, media: [m0, m1] });
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('allows missing init', () => {
    const out = concatFmp4Track({ init: null, media: [new Uint8Array([9])] });
    expect(Array.from(out)).toEqual([9]);
  });
});

describe('mergeFmp4Tracks (Twitter probe fixtures)', () => {
  const videoPath = resolve('.output/probe/video-only.mp4');
  const audioPath = resolve('.output/probe/audio-only.mp4');
  const hasFixtures = existsSync(videoPath) && existsSync(audioPath);

  it.skipIf(!hasFixtures)(
    'remuxes separate A/V fMP4 into a playable file',
    async () => {
      const video = new Uint8Array(readFileSync(videoPath));
      const audio = new Uint8Array(readFileSync(audioPath));
      const merged = await mergeFmp4Tracks(
        { init: null, media: [video] },
        { init: null, media: [audio] },
      );
      expect(merged.byteLength).toBeGreaterThan(1000);
      const type = String.fromCharCode(merged[4], merged[5], merged[6], merged[7]);
      expect(type).toBe('ftyp');
    },
    30_000,
  );
});

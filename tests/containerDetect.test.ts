import { describe, it, expect } from 'vitest';
import {
  isMpegTs,
  isIsoBmff,
  playlistLooksFmp4,
} from '../src/lib/engine/containerDetect';
import type { ParsedPlaylist } from '../src/lib/types';

function emptyPl(partial: Partial<ParsedPlaylist>): ParsedPlaylist {
  return {
    isMaster: false,
    endList: true,
    variants: [],
    segments: [],
    totalDuration: 0,
    ...partial,
  };
}

describe('containerDetect', () => {
  it('detects MPEG-TS sync bytes', () => {
    const ts = new Uint8Array(189);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(isMpegTs(ts)).toBe(true);
    expect(isIsoBmff(ts)).toBe(false);
  });

  it('detects ftyp / moof ISO BMFF', () => {
    const ftyp = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
    expect(isIsoBmff(ftyp)).toBe(true);
    expect(isMpegTs(ftyp)).toBe(false);

    const moof = new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]);
    expect(isIsoBmff(moof)).toBe(true);
  });

  it('playlistLooksFmp4 from MAP or .m4s URL', () => {
    expect(
      playlistLooksFmp4(
        emptyPl({
          initSegment: { uri: 'https://cdn.example.com/init.mp4' },
        }),
      ),
    ).toBe(true);

    expect(
      playlistLooksFmp4(
        emptyPl({
          segments: [
            {
              url: 'https://video.twimg.com/amplify_video/x/pl/avc1/1080/seg0.m4s',
              duration: 1,
              sequence: 0,
            },
          ],
        }),
      ),
    ).toBe(true);

    expect(
      playlistLooksFmp4(
        emptyPl({
          segments: [
            { url: 'https://cdn.example.com/seg0.ts', duration: 1, sequence: 0 },
          ],
        }),
      ),
    ).toBe(false);
  });
});

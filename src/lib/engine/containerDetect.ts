// Detect MPEG-TS vs ISO BMFF (fMP4/CMAF) from playlist hints or segment magic.

import type { ParsedPlaylist } from '../types';

/** MPEG-TS sync byte; packets are typically 188 bytes. */
export function isMpegTs(bytes: Uint8Array): boolean {
  if (!bytes.length || bytes[0] !== 0x47) return false;
  // Confirm sync on the next packet when enough bytes are present.
  if (bytes.length >= 189) return bytes[188] === 0x47;
  return true;
}

/** ISO BMFF box type at offset 4 (ftyp/styp/moof/moov/sidx/mdat). */
export function isIsoBmff(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return (
    type === 'ftyp' ||
    type === 'styp' ||
    type === 'moof' ||
    type === 'moov' ||
    type === 'sidx' ||
    type === 'mdat' ||
    type === 'free'
  );
}

/** Playlist declares #EXT-X-MAP → almost always CMAF/fMP4, not MPEG-TS. */
export function playlistLooksFmp4(pl: ParsedPlaylist): boolean {
  if (pl.initSegment) return true;
  const u = pl.segments[0]?.url?.toLowerCase() ?? '';
  return u.includes('.m4s') || u.includes('.mp4') || u.includes('/mp4a/') || u.includes('/avc1/');
}

// Merge separate CMAF/fMP4 audio + video tracks into one progressive MP4
// via mediabunny (copy/transmux when possible — same idea as ffmpeg -c copy).
import {
  Input,
  Output,
  Conversion,
  Mp4OutputFormat,
  BufferTarget,
  BufferSource,
  ALL_FORMATS,
} from 'mediabunny';
import { concatBytes } from './transmuxer';
import log from '../log';

export interface Fmp4TrackBytes {
  init: Uint8Array | null;
  media: Uint8Array[];
}

export function concatFmp4Track(track: Fmp4TrackBytes): Uint8Array {
  const parts: Uint8Array[] = [];
  if (track.init?.length) parts.push(track.init);
  for (const m of track.media) if (m?.length) parts.push(m);
  return concatBytes(parts);
}

function toInput(data: Uint8Array): Input {
  return new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(data.slice()),
  });
}

/**
 * Remux video + optional audio fMP4 byte streams into one MP4.
 * Throws if demux/remux fails — caller should fall back to video-only concat.
 */
export async function mergeFmp4Tracks(
  video: Fmp4TrackBytes,
  audio?: Fmp4TrackBytes | null,
): Promise<Uint8Array> {
  const videoBytes = concatFmp4Track(video);
  if (!audio) return videoBytes;

  const audioBytes = concatFmp4Track(audio);
  if (!audioBytes.length) {
    log.warn('fmp4 merge: empty audio track; returning video-only');
    return videoBytes;
  }

  const videoInput = toInput(videoBytes);
  const audioInput = toInput(audioBytes);
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });

  const videoConversion = await Conversion.init({
    input: videoInput,
    output,
    composable: true,
    audio: { discard: true },
  });
  const audioConversion = await Conversion.init({
    input: audioInput,
    output,
    composable: true,
    video: { discard: true },
  });

  if (!videoConversion.isValid) {
    throw new Error(
      `video remux invalid: ${JSON.stringify(videoConversion.discardedTracks)}`,
    );
  }
  if (!audioConversion.isValid) {
    log.warn('audio remux invalid; returning video-only', audioConversion.discardedTracks);
    return videoBytes;
  }

  await output.start();
  await Promise.all([videoConversion.execute(), audioConversion.execute()]);
  await output.finalize();

  const buf = target.buffer;
  if (!buf?.byteLength) throw new Error('mediabunny produced empty buffer');
  return new Uint8Array(buf);
}

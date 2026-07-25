import { describe, it, expect } from 'vitest';
import {
  parsePlaylist,
  pickBestVariant,
  pickAudioRendition,
  parseAttrs,
  parseHex,
} from '../src/lib/engine/m3u8Parser';

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin",IV=0x000102030405060708090a0b0c0d0e0f
#EXTINF:9.97,
https://cdn.example.com/seg-0.ts
#EXTINF:9.97,
https://cdn.example.com/seg-1.ts
#EXT-X-ENDLIST
`;

const BYTERANGE_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-MAP:URI="init.mp4",BYTERANGE="718@0"
#EXTINF:5.96,
#EXT-X-BYTERANGE:32768@2048
chunks.m4s
#EXT-X-ENDLIST
`;

describe('parseAttrs', () => {
  it('parses quoted and unquoted values', () => {
    const a = parseAttrs('A=1,B="quoted, with comma",C=0xFF');
    expect(a.A).toBe('1');
    expect(a.B).toBe('quoted, with comma');
    expect(a.C).toBe('0xFF');
  });
});

describe('parseHex', () => {
  it('parses 0x-prefixed hex into bytes', () => {
    const b = parseHex('0x000102030405060708090a0b0c0d0e0f');
    expect(b.length).toBe(16);
    expect(b[0]).toBe(0);
    expect(b[15]).toBe(0x0f);
  });
});

describe('parsePlaylist master', () => {
  const pl = parsePlaylist(MASTER, 'https://cdn.example.com/master.m3u8');

  it('detects master', () => {
    expect(pl.isMaster).toBe(true);
    expect(pl.segments.length).toBe(0);
  });

  it('parses variants with resolution + codecs', () => {
    expect(pl.variants.length).toBe(3);
    const v0 = pl.variants[0];
    expect(v0.bandwidth).toBe(800000);
    expect(v0.resolution).toEqual({ width: 640, height: 360 });
    expect(v0.codecs).toBe('avc1.4d401e,mp4a.40.2');
    expect(v0.url).toBe('https://cdn.example.com/360p.m3u8');
  });

  it('picks the highest bandwidth variant', () => {
    const best = pickBestVariant(pl.variants)!;
    expect(best.bandwidth).toBe(5000000);
    expect(best.resolution?.height).toBe(1080);
    expect(best.url).toBe('https://cdn.example.com/1080p.m3u8');
  });
});

describe('parsePlaylist media', () => {
  const pl = parsePlaylist(MEDIA, 'https://cdn.example.com/index.m3u8');

  it('is a media playlist with endlist', () => {
    expect(pl.isMaster).toBe(false);
    expect(pl.endList).toBe(true);
    expect(pl.targetDuration).toBe(10);
    expect(pl.mediaSequence).toBe(0);
  });

  it('parses segments with sequence and duration', () => {
    expect(pl.segments.length).toBe(2);
    expect(pl.segments[0].url).toBe('https://cdn.example.com/seg-0.ts');
    expect(pl.segments[0].sequence).toBe(0);
    expect(pl.segments[0].duration).toBeCloseTo(9.97, 2);
    expect(pl.segments[1].sequence).toBe(1);
  });

  it('parses AES-128 key with URI and IV', () => {
    expect(pl.key).toBeDefined();
    expect(pl.key!.method).toBe('AES-128');
    expect(pl.key!.uri).toBe('https://cdn.example.com/key.bin');
    expect(pl.key!.iv).toBeDefined();
    expect(pl.key!.iv!.length).toBe(16);
    expect(pl.key!.iv![15]).toBe(0x0f);
  });

  it('sums total duration', () => {
    expect(pl.totalDuration).toBeCloseTo(19.94, 1);
  });
});

describe('parsePlaylist byterange + map', () => {
  const pl = parsePlaylist(BYTERANGE_MEDIA, 'https://cdn.example.com/b.m3u8');

  it('parses init segment', () => {
    expect(pl.initSegment).toBeDefined();
    expect(pl.initSegment!.uri).toBe('https://cdn.example.com/init.mp4');
    expect(pl.initSegment!.byterange).toEqual({ offset: 0, length: 718 });
  });

  it('parses segment byterange', () => {
    expect(pl.segments.length).toBe(1);
    expect(pl.segments[0].byterange).toEqual({ offset: 2048, length: 32768 });
    expect(pl.segments[0].sequence).toBe(1); // media sequence 1
    expect(pl.segments[0].url).toBe('https://cdn.example.com/chunks.m4s');
  });
});

const TWITTER_LIKE_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-32000",AUTOSELECT=YES,URI="/amplify/pl/mp4a/32000/a.m3u8"
#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",AUTOSELECT=YES,DEFAULT=YES,URI="/amplify/pl/mp4a/128000/b.m3u8"
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=201818,BANDWIDTH=256923,RESOLUTION=320x320,CODECS="mp4a.40.2,avc1.4D401E",AUDIO="audio-32000"
/amplify/pl/avc1/320x320/v0.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=3056912,BANDWIDTH=4217042,RESOLUTION=1080x1080,CODECS="mp4a.40.2,avc1.64002A",AUDIO="audio-128000"
/amplify/pl/avc1/1080x1080/v1.m3u8
`;

describe('parsePlaylist demuxed audio (Twitter-style)', () => {
  const pl = parsePlaylist(
    TWITTER_LIKE_MASTER,
    'https://video.example.com/amplify/pl/master.m3u8',
  );

  it('parses AUDIO media groups with absolute URIs', () => {
    expect(pl.isMaster).toBe(true);
    expect(pl.mediaGroups?.AUDIO?.['audio-128000']?.length).toBe(1);
    expect(pl.mediaGroups!.AUDIO!['audio-128000'][0].uri).toBe(
      'https://video.example.com/amplify/pl/mp4a/128000/b.m3u8',
    );
    expect(pl.mediaGroups!.AUDIO!['audio-128000'][0].default).toBe(true);
  });

  it('links STREAM-INF AUDIO group id on variants', () => {
    expect(pl.variants).toHaveLength(2);
    expect(pl.variants[0].audioGroupId).toBe('audio-32000');
    expect(pl.variants[1].audioGroupId).toBe('audio-128000');
  });

  it('pickBestVariant keeps audio group for remux', () => {
    const best = pickBestVariant(pl.variants)!;
    expect(best.bandwidth).toBe(4217042);
    expect(best.audioGroupId).toBe('audio-128000');
    const audio = pickAudioRendition(pl.mediaGroups!.AUDIO![best.audioGroupId!]);
    expect(audio?.uri).toContain('/mp4a/128000/');
  });
});

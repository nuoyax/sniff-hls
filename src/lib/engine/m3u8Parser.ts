// Hand-written HLS (m3u8) playlist parser.
// Supports the VOD subset we need: master + media playlists, AES-128 keys,
// byteranges, init segments (#EXT-X-MAP), media sequence, endlist.
// Pure, no I/O — unit-tested.

import type {
  ParsedPlaylist,
  Segment,
  VariantInfo,
  KeyInfo,
  InitSegment,
} from '../types';

/** Parse an #EXT-X-KEY attribute string into KeyInfo. */
export function parseKey(line: string, base: string): KeyInfo | undefined {
  // line like: #EXT-X-KEY:METHOD=AES-128,URI="https://x/key",IV=0x0001...
  const attrs = parseAttrs(line.slice('#EXT-X-KEY:'.length));
  const method = attrs.METHOD;
  if (!method || method === 'NONE') return { method: 'NONE' };
  const key: KeyInfo = { method };
  if (attrs.URI) key.uri = resolveMaybeQuoted(attrs.URI, base);
  if (attrs.IV) key.iv = parseHex(attrs.IV);
  return key;
}

function resolveMaybeQuoted(uri: string, base: string): string {
  const clean = uri.replace(/^"|"$/g, '');
  try {
    return new URL(clean, base).href;
  } catch {
    return clean;
  }
}

export function parseHex(hex: string): Uint8Array {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.ceil(h.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

/** Parse attribute pairs: KEY=VAL,KEY2="quoted, val",KEY3=0x.. */
export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    // skip leading whitespace / commas
    while (i < s.length && (s[i] === ' ' || s[i] === ',')) i++;
    if (i >= s.length) break;
    const eq = s.indexOf('=', i);
    if (eq < 0) {
      // bare attribute key (no value) — store empty
      const key = s.slice(i).trim();
      if (key) out[key] = '';
      break;
    }
    const key = s.slice(i, eq).trim();
    let j = eq + 1;
    let val: string;
    if (s[j] === '"') {
      const end = s.indexOf('"', j + 1);
      val = s.slice(j + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
      // consume following comma
      while (i < s.length && (s[i] === ' ' || s[i] === ',')) i++;
    } else {
      const comma = s.indexOf(',', j);
      const stop = comma < 0 ? s.length : comma;
      val = s.slice(j, stop).trim();
      i = comma < 0 ? s.length : stop + 1;
    }
    out[key] = val;
  }
  return out;
}

export function parseByterange(val: string): { offset: number; length: number } | undefined {
  if (!val) return undefined;
  // Format: "length" or "length@offset" (RFC 8216 #EXT-X-BYTERANGE).
  const trimmed = val.trim();
  const at = trimmed.indexOf('@');
  const lengthStr = at >= 0 ? trimmed.slice(0, at) : trimmed;
  const offsetStr = at >= 0 ? trimmed.slice(at + 1) : '';
  const length = parseInt(lengthStr, 10);
  if (!Number.isFinite(length)) return undefined;
  const offset = offsetStr ? parseInt(offsetStr, 10) : -1;
  return { length, offset };
}

/** Parse #EXT-X-MAP. */
export function parseMap(line: string, base: string): InitSegment | undefined {
  const attrs = parseAttrs(line.slice('#EXT-X-MAP:'.length));
  if (!attrs.URI) return undefined;
  const init: InitSegment = { uri: resolveMaybeQuoted(attrs.URI, base) };
  if (attrs.BYTERANGE) {
    // BYTERANGE value may be quoted: strip quotes then parse length@offset.
    const raw = attrs.BYTERANGE.replace(/^"|"$/g, '');
    const br = parseByterange(raw);
    if (br) {
      init.byterange = { offset: br.offset < 0 ? 0 : br.offset, length: br.length };
    }
  }
  return init;
}

export function parsePlaylist(text: string, baseUrl: string): ParsedPlaylist {
  const lines = text.split(/\r?\n/);
  let isMaster = false;
  let version: number | undefined;
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let endList = false;
  let key: KeyInfo | undefined;
  let initSegment: InitSegment | undefined;
  const variants: VariantInfo[] = [];
  const segments: Segment[] = [];

  let pendingStreamInf: Partial<VariantInfo> | null = null;
  let pendingInf: { duration: number; title?: string } | null = null;
  let pendingByterange: { offset: number; length: number } | undefined = undefined;
  let pendingDiscontinuity = false;
  let seq = 0;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '#EXTM3U') continue;
    if (line.startsWith('#EXT-X-VERSION:')) {
      version = parseInt(line.slice('#EXT-X-VERSION:'.length), 10);
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.slice('#EXT-X-TARGETDURATION:'.length), 10);
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10);
      seq = mediaSequence;
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      endList = true;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      key = parseKey(line, baseUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      initSegment = parseMap(line, baseUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const br = parseByterange(line.slice('#EXT-X-BYTERANGE:'.length));
      if (br) pendingByterange = { offset: br.offset < 0 ? 0 : br.offset, length: br.length };
      continue;
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isMaster = true;
      pendingStreamInf = parseStreamInf(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const body = line.slice('#EXTINF:'.length);
      const comma = body.lastIndexOf(',');
      const dur = parseFloat(comma >= 0 ? body.slice(0, comma) : body);
      const title = comma >= 0 ? body.slice(comma + 1).trim() : undefined;
      pendingInf = { duration: Number.isFinite(dur) ? dur : 0, title };
      continue;
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      pendingDiscontinuity = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    // A URI line.
    const abs = resolveMaybeQuoted(line, baseUrl);
    if (pendingStreamInf) {
      variants.push({
        url: abs,
        bandwidth: pendingStreamInf.bandwidth ?? 0,
        resolution: pendingStreamInf.resolution,
        codecs: pendingStreamInf.codecs,
        frameRate: pendingStreamInf.frameRate,
        averageBandwidth: pendingStreamInf.averageBandwidth,
      });
      pendingStreamInf = null;
      continue;
    }
    if (pendingInf) {
      const seg: Segment = {
        url: abs,
        duration: pendingInf.duration,
        sequence: seq,
        title: pendingInf.title,
        byterange: pendingByterange,
        discontinuity: pendingDiscontinuity,
      };
      segments.push(seg);
      seq++;
      pendingInf = null;
      pendingByterange = undefined;
      pendingDiscontinuity = false;
      continue;
    }
    // bare URI without EXTINF (rare) — skip
  }

  const totalDuration = segments.reduce((s, x) => s + x.duration, 0);

  return {
    isMaster,
    version,
    targetDuration,
    mediaSequence,
    endList,
    variants,
    segments,
    key,
    initSegment,
    totalDuration,
  };
}

function parseStreamInf(attrsStr: string): Partial<VariantInfo> {
  const attrs = parseAttrs(attrsStr);
  const out: Partial<VariantInfo> = {};
  const bw = parseInt(attrs.BANDWIDTH, 10);
  if (Number.isFinite(bw)) out.bandwidth = bw;
  const abw = parseInt(attrs['AVERAGE-BANDWIDTH'], 10);
  if (Number.isFinite(abw)) out.averageBandwidth = abw;
  if (attrs.RESOLUTION) {
    const m = attrs.RESOLUTION.match(/^(\d+)x(\d+)$/);
    if (m) out.resolution = { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  }
  if (attrs.CODECS) out.codecs = attrs.CODECS;
  if (attrs['FRAME-RATE']) {
    const fr = parseFloat(attrs['FRAME-RATE']);
    if (Number.isFinite(fr)) out.frameRate = fr;
  }
  return out;
}

/** Pick the highest-bandwidth variant (resolves codec preference implicitly). */
export function pickBestVariant(variants: VariantInfo[]): VariantInfo | undefined {
  if (!variants.length) return undefined;
  return variants.slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
}

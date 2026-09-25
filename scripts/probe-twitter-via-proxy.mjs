/**
 * Fetch Twitter amplify HLS via local Clash proxy (7890), assemble/remux, ffprobe.
 * Usage: node scripts/probe-twitter-via-proxy.mjs
 */
import {
  Input,
  Output,
  Conversion,
  Mp4OutputFormat,
  BufferTarget,
  BufferSource,
  ALL_FORMATS,
} from 'mediabunny';
import { writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
const MASTER =
  process.env.M3U8_URL ||
  'https://video.twimg.com/amplify_video/2080337269240836096/pl/styK0YRpdiiEeyeT.m3u8';
const OUT_DIR = fileURLToPath(new URL('../.output/probe/', import.meta.url));

function curlGet(url, asText = false) {
  const tmp = join(tmpdir(), `sniffls-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const r = spawnSync(
    'curl.exe',
    ['-sS', '-f', '-L', '-x', PROXY, '--connect-timeout', '20', '-o', tmp, url],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`curl failed ${url}: ${r.stderr || r.stdout || r.status}`);
  }
  const buf = readFileSync(tmp);
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  return asText ? buf.toString('utf8') : new Uint8Array(buf);
}

function parseAttrs(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === ',')) i++;
    if (i >= s.length) break;
    const eq = s.indexOf('=', i);
    if (eq < 0) break;
    const key = s.slice(i, eq).trim();
    let j = eq + 1;
    let val;
    if (s[j] === '"') {
      const end = s.indexOf('"', j + 1);
      val = s.slice(j + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
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

function parseMaster(text, base) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const audio = {};
  const variants = [];
  let pending = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttrs(line.slice('#EXT-X-MEDIA:'.length));
      if (a.TYPE !== 'AUDIO') continue;
      (audio[a['GROUP-ID']] ??= []).push({
        uri: a.URI ? new URL(a.URI.replace(/^"|"$/g, ''), base).href : undefined,
        default: a.DEFAULT === 'YES',
        autoselect: a.AUTOSELECT === 'YES',
      });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttrs(line.slice('#EXT-X-STREAM-INF:'.length));
      pending = {
        bandwidth: parseInt(a.BANDWIDTH, 10) || 0,
        audioGroupId: a.AUDIO,
        resolution: a.RESOLUTION,
      };
    } else if (!line.startsWith('#') && pending) {
      variants.push({ ...pending, url: new URL(line, base).href });
      pending = null;
    }
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return { audio, variants };
}

function parseMedia(text, base) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let init;
  const segs = [];
  let pending = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(line.slice('#EXT-X-MAP:'.length));
      if (a.URI) init = new URL(a.URI.replace(/^"|"$/g, ''), base).href;
    } else if (line.startsWith('#EXTINF:')) pending = true;
    else if (!line.startsWith('#') && pending) {
      segs.push(new URL(line, base).href);
      pending = false;
    }
  }
  return { init, segs };
}

function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function fetchAll(init, segs, maxSegs) {
  const parts = [];
  if (init) {
    console.log('  GET init', init);
    parts.push(curlGet(init));
  }
  const list = segs.slice(0, maxSegs);
  for (let i = 0; i < list.length; i++) {
    if (i % 10 === 0) console.log(`  GET seg ${i + 1}/${list.length}`);
    parts.push(curlGet(list[i]));
  }
  return {
    concat: concatBytes(parts),
    initBytes: init ? parts[0] : null,
    mediaParts: init ? parts.slice(1) : parts,
  };
}

function boxType(bytes) {
  if (!bytes || bytes.length < 8) return '?';
  return String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
}

async function remux(videoBytes, audioBytes) {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoConversion = await Conversion.init({
    input: new Input({ formats: ALL_FORMATS, source: new BufferSource(videoBytes) }),
    output,
    composable: true,
    audio: { discard: true },
  });
  const audioConversion = await Conversion.init({
    input: new Input({ formats: ALL_FORMATS, source: new BufferSource(audioBytes) }),
    output,
    composable: true,
    video: { discard: true },
  });
  console.log('videoConversion.valid', videoConversion.isValid);
  console.log('audioConversion.valid', audioConversion.isValid);
  await output.start();
  await Promise.all([videoConversion.execute(), audioConversion.execute()]);
  await output.finalize();
  const buf = target.buffer;
  if (!buf?.byteLength) throw new Error('empty remux');
  console.log('remux out bytes', buf.byteLength);
  return new Uint8Array(buf);
}

function ffprobe(path) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size,format_name:stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      path,
    ],
    { encoding: 'utf8' },
  );
  return { status: r.status, out: r.stdout, err: r.stderr };
}

console.log('proxy', PROXY);
console.log('master', MASTER);
const masterText = curlGet(MASTER, true);
console.log('master preview:\n', masterText.slice(0, 800));

const { audio, variants } = parseMaster(masterText, MASTER);
const best = variants[0];
console.log('best variant', best);
const audioList = audio[best.audioGroupId] || [];
const audioRend =
  audioList.find((a) => a.default) || audioList.find((a) => a.autoselect) || audioList[0];
console.log('audio rendition', audioRend);

const vText = curlGet(best.url, true);
const aText = curlGet(audioRend.uri, true);
console.log('--- video media ---\n', vText.slice(0, 600));
console.log('--- audio media ---\n', aText.slice(0, 600));

const vPl = parseMedia(vText, best.url);
const aPl = parseMedia(aText, audioRend.uri);
console.log('video init', vPl.init, 'segs', vPl.segs.length);
console.log('audio init', aPl.init, 'segs', aPl.segs.length);

const maxSegs = Number(process.env.MAX_SEGS || 0) || Infinity;
console.log('downloading maxSegs=', maxSegs === Infinity ? 'all' : maxSegs);
const vAll = await fetchAll(vPl.init, vPl.segs, maxSegs);
const aAll = await fetchAll(aPl.init, aPl.segs, maxSegs);
console.log(
  'video concat',
  vAll.concat.length,
  'box',
  boxType(vAll.concat),
  'init',
  boxType(vAll.initBytes),
);
console.log(
  'audio concat',
  aAll.concat.length,
  'box',
  boxType(aAll.concat),
  'init',
  boxType(aAll.initBytes),
);

mkdirSync(OUT_DIR, { recursive: true });
const videoOnly = join(OUT_DIR, 'video-only.mp4');
const audioOnly = join(OUT_DIR, 'audio-only.mp4');
const merged = join(OUT_DIR, 'merged.mp4');
writeFileSync(videoOnly, Buffer.from(vAll.concat));
writeFileSync(audioOnly, Buffer.from(aAll.concat));
console.log('wrote', videoOnly);

try {
  const m = await remux(vAll.concat, aAll.concat);
  writeFileSync(merged, Buffer.from(m));
  console.log('wrote', merged, m.length);
} catch (e) {
  console.error('REMUX FAILED', e);
}

for (const p of [videoOnly, audioOnly, merged]) {
  try {
    const r = ffprobe(p);
    console.log('===== ffprobe', p, 'status', r.status);
    console.log(r.out || r.err);
  } catch (e) {
    console.log('ffprobe missing/failed', p, e.message);
  }
}

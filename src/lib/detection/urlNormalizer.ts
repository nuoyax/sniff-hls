// URL helpers: normalization, m3u8 detection, base resolution.
// Pure functions, no I/O — unit-tested.

const M3U8_RE = /\.m3u8?(?:$|[?#])/i;
const HLS_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);

export function isM3u8Url(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    // match path extension or .m3u with optional query
    return M3U8_RE.test(u.pathname + u.search) || /\.m3u8?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isHlsContentType(contentType?: string | null): boolean {
  if (!contentType) return false;
  return HLS_CONTENT_TYPES.has(contentType.split(';')[0].trim().toLowerCase());
}

/** Resolve a possibly-relative URL against a base. */
export function resolveUrl(base: string, rel: string): string {
  if (!rel) return base;
  try {
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
}

/**
 * Normalize an m3u8 URL for dedup: drop fragment, lowercase host,
 * sort selected query params, drop tracking params.
 */
const DROP_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', '_t', 'timestamp', 'rn', 'r']);

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const keys = Array.from(u.searchParams.keys());
    const keep: Record<string, string> = {};
    for (const k of keys.sort()) {
      if (DROP_PARAMS.has(k.toLowerCase())) continue;
      keep[k] = u.searchParams.get(k) || '';
    }
    u.search = '';
    for (const [k, v] of Object.entries(keep)) u.searchParams.set(k, v);
    return u.href;
  } catch {
    return url;
  }
}

/** Derive a sensible base filename from a URL. */
export function deriveBaseFilename(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').split('.')[0] || 'video';
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    const stem = last.replace(/\.(m3u8?|txt|json)$/i, '').replace(/[^\w-]+/g, '-');
    return stem ? `${host}-${stem}` : host;
  } catch {
    return 'video';
  }
}

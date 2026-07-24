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

/**
 * Sanitize a raw title/name into a filename-safe stem:
 * strip OS-illegal + special characters, collapse whitespace to single spaces,
 * trim. e.g. "My Video: Best <clips> 2024!" -> "My Video Best clips 2024"
 */
export function sanitizeTitleStem(raw: string): string {
  if (!raw) return 'video';
  // Remove OS-illegal chars (Windows < > : " / \ | ? * and control chars)
  let s = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  // Remove other special chars but keep word chars, spaces, CJK, hyphen, dot, parens
  s = s.replace(/[`~!@#$%^&*+=\[\]{};'",<>]/g, '');
  // Collapse whitespace runs to a single space
  s = s.replace(/\s+/g, ' ').trim();
  return s || 'video';
}

/**
 * Build a download base filename from a page title + timestamp suffix.
 * Format: "<sanitized title>_<yyyyMMdd_HHmmss>"
 */
export function buildDefaultFilename(title?: string): string {
  const stem = sanitizeTitleStem(title || '');
  const ts = timestampString();
  return `${stem}_${ts}`;
}

/** Compact local timestamp: 20260724_153045 (no Date.now() needed — caller passes epoch). */
export function timestampString(epochMs: number = Date.now()): string {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = p(d.getMonth() + 1);
  const dd = p(d.getDate());
  const hh = p(d.getHours());
  const mi = p(d.getMinutes());
  const ss = p(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

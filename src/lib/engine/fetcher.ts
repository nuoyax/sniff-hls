// Fetch helpers shared by detection probe and the engine.
// Extension fetch() with host_permissions:<all_urls> bypasses CORS.
import { bapi } from '../platform/browser';

export interface FetchTextOptions {
  /** Optional Referer to spoof (some CDNs require it). */
  referer?: string;
  /** Timeout ms. */
  timeoutMs?: number;
}

/** Fetch a URL as text. Uses extension fetch (cross-origin capable). */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const init: RequestInit = { signal: controller.signal, credentials: 'omit' };
    if (opts.referer) {
      // Note: browsers may strip Referer on cross-origin fetch; extension can't
      // always set it. We attempt; CDN may still serve.
      (init.headers as Record<string, string>) = { Referer: opts.referer };
    }
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL as ArrayBuffer. */
export async function fetchBytes(
  url: string,
  opts: { byterange?: { offset: number; length: number }; timeoutMs?: number; retries?: number } = {},
): Promise<Uint8Array> {
  const { byterange, timeoutMs = 60_000, retries = 3 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = { signal: controller.signal, credentials: 'omit' };
      if (byterange) {
        const end = byterange.offset + byterange.length - 1;
        (init.headers as Record<string, string>) = {
          Range: `bytes=${byterange.offset}-${end}`,
        };
      }
      const res = await fetch(url, init);
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      lastErr = e;
      // exponential backoff with jitter
      const wait = Math.min(8000, 300 * 2 ** attempt) * (0.5 + Math.random());
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetch failed');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a short id. Uses crypto if available. */
export function genId(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.random().toString(16).slice(2);
  return prefix + Date.now().toString(36) + rnd;
}

/** Re-export for convenience. */
export { bapi };

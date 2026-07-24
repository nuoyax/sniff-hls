// Runtime feature detection: which WebExtension APIs are available on this browser.
// Drives cross-browser fallbacks (offscreen vs extension page, proxy, storage.session).

export type BrowserTarget = 'chrome' | 'firefox' | 'safari' | 'edge' | 'unknown';

declare const browser: any;

function getApi(): any {
  const g = globalThis as any;
  // Prefer chrome/browser that actually has extension APIs — never return {}.
  if (g.chrome?.runtime) return g.chrome;
  if (g.browser?.runtime) return g.browser;
  if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome;
  if (typeof browser !== 'undefined' && browser?.runtime) return browser;
  return g.chrome || g.browser || {};
}

const api = getApi();

export const target: BrowserTarget = (() => {
  // Prefer WXT's per-build BROWSER flag. Avoid `typeof import.meta` — Vite
  // rewrites bare `import.meta` to a document.currentScript / document.baseURI
  // polyfill that throws ReferenceError in MV3 service workers (status 15).
  const envBrowser = (import.meta as ImportMeta & { env?: { BROWSER?: string } }).env?.BROWSER ?? '';
  if (envBrowser) return envBrowser as BrowserTarget;

  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isFirefox = typeof api.runtime?.getBrowserInfo !== 'undefined';
  if (isFirefox) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'unknown';
})();

/** Chrome.offscreen present (Chromium 109+/Edge). Firefox & Safari lack it. */
export function hasOffscreen(): boolean {
  return !!api.offscreen?.createDocument;
}

/** storage.session (Chrome 102+, Firefox 115+). */
export function hasStorageSession(): boolean {
  return !!api.storage?.session;
}

/** chrome.proxy.settings (Chromium) or browser.proxy.settings (Firefox). */
export function hasProxySettings(): boolean {
  return !!(api.proxy?.settings?.set || api.proxy?.onRequest);
}

export function hasNotifications(): boolean {
  return !!api.notifications?.create;
}

export function hasDownloads(): boolean {
  return !!api.downloads?.download;
}

export function hasWebRequest(): boolean {
  return !!api.webRequest?.onBeforeRequest;
}

export const capabilities = {
  target,
  offscreen: hasOffscreen(),
  storageSession: hasStorageSession(),
  proxy: hasProxySettings(),
  notifications: hasNotifications(),
  downloads: hasDownloads(),
  webRequest: hasWebRequest(),
};

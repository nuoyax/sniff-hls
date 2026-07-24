// Runtime feature detection: which WebExtension APIs are available on this browser.
// Drives cross-browser fallbacks (offscreen vs extension page, proxy, storage.session).

export type BrowserTarget = 'chrome' | 'firefox' | 'safari' | 'edge' | 'unknown';

declare const browser: any;

function getApi(): any {
  // WXT injects a `browser` global (webextension-polyfill style) in all contexts.
  if (typeof browser !== 'undefined') return browser;
  if (typeof chrome !== 'undefined') return chrome;
  return {};
}

const api = getApi();

export const target: BrowserTarget = (() => {
  // WXT sets import.meta.env.BROWSER per build target — use it as the source
  // of truth so each build artifact reports the correct target (rather than
  // sniffing navigator.userAgent, which is unreliable inside extensions).
  const envBrowser =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.BROWSER) ||
    '';
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

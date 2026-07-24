// Content script: scans the page DOM/JSON for embedded m3u8 URLs as a
// tertiary detector (primary path is webRequest, which is CSP-immune).
// Runs on demand (scripting.executeScript) to keep page overhead low.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  async main() {
    try {
      const urls = scanPage();
      if (urls.length) {
        // Relay findings to the background SW; SW dedupes + stores.
        browser.runtime.sendMessage({
          __content_scan: true,
          urls,
          pageUrl: location.href,
        }).catch(() => {
          /* SW may be restarting */
        });
      }
    } catch {
      /* never break the host page */
    }
  },
});

const M3U8_RE = /https?:\/\/[^\s"'<>]+\.m3u8?(?:[?#][^\s"'<>]*)?/gi;

function scanPage(): string[] {
  const found = new Set<string>();

  // 1. Visible HTML text + script/JSON blobs.
  try {
    const html = document.documentElement.outerHTML;
    for (const m of html.matchAll(M3U8_RE)) found.add(m[0].replace(/&amp;/g, '&'));
  } catch {
    /* ignore */
  }

  // 2. performance resource timing entries.
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const e of entries) {
      if (/\.m3u8?(?:[?#]|$)/i.test(e.name)) found.add(e.name);
    }
  } catch {
    /* ignore */
  }

  // 3. video/audio source elements + data attributes.
  try {
    document.querySelectorAll('video, audio, source').forEach((el) => {
      const src = el.getAttribute('src') || '';
      if (/\.m3u8?(?:[?#]|$)/i.test(src)) found.add(src);
      el.querySelectorAll('source').forEach((s) => {
        const ss = s.getAttribute('src') || '';
        if (/\.m3u8?(?:[?#]|$)/i.test(ss)) found.add(ss);
      });
    });
  } catch {
    /* ignore */
  }

  return Array.from(found);
}

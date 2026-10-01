// Content script: scans the page DOM/JSON for embedded m3u8 URLs as a
// tertiary detector (primary path is webRequest, which is CSP-immune).
//
// Registered as `runtime` (NOT declaratively): the SW injects it on demand via
// scripting.executeScript when the user hits Scan. Declarative injection with
// `allFrames` ran this in every frame of every page and serialized the whole
// document via outerHTML — a large synchronous allocation on each load, even
// when the extension was never opened.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  registration: 'runtime',
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
  // Serializing `document.documentElement.outerHTML` builds a full copy of the
  // DOM as one string — tens of MB on heavy SPAs. Skip script/style bodies
  // (where the handful of JSON blobs we care about live) and walk elements
  // instead, so the peak allocation stays proportional to real content.
  try {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = (node as Text).parentElement;
      if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'NOSCRIPT') {
        const text = node.nodeValue;
        if (text && text.includes('.m3u8')) {
          for (const m of text.matchAll(M3U8_RE)) found.add(m[0].replace(/&amp;/g, '&'));
        }
      }
      node = walker.nextNode();
    }
    // Script/JSON blobs: match each script's own text, never the whole document.
    for (const s of document.querySelectorAll('script')) {
      const text = s.textContent;
      if (!text || !text.includes('.m3u8')) continue;
      for (const m of text.matchAll(M3U8_RE)) found.add(m[0].replace(/&amp;/g, '&'));
    }
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

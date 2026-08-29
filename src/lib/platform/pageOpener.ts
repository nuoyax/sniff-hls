import { bapi } from '@/lib/platform/browser';

/**
 * Open an extension page (e.g. 'options.html', 'download-manager.html') in a
 * tab. If the page is already open, focus the existing tab instead of
 * spawning a duplicate.
 */
export async function openOrFocusPage(page: string): Promise<void> {
  const url = bapi.runtime.getURL(page);
  // Compare by page filename rather than exact origin: in WXT dev mode the
  // pages are served from http://localhost:<port>/, so an extension-URL
  // query would never match and a duplicate tab would open every time.
  const targetPath = `/${page}`;
  try {
    const tabs = await bapi.tabs.query({});
    const existing = tabs.find((t: any) => {
      if (!t.url) return false;
      try {
        return new URL(t.url).pathname === targetPath;
      } catch {
        return false;
      }
    });
    if (existing?.id != null) {
      await bapi.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        await bapi.windows.update(existing.windowId, { focused: true }).catch(() => {});
      }
      return;
    }
  } catch {
    /* fall through to creating a new tab */
  }
  await bapi.tabs.create({ url });
}

import { bapi } from '@/lib/platform/browser';

/**
 * Open an extension page (e.g. 'options.html', 'download-manager.html') in a
 * tab. If the page is already open, focus the existing tab instead of
 * spawning a duplicate.
 */
export async function openOrFocusPage(page: string): Promise<void> {
  const url = bapi.runtime.getURL(page);
  try {
    const tabs = await bapi.tabs.query({ url });
    const existing = tabs[0];
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

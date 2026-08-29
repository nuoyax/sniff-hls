// Detection state for a tab, persisted to storage.session (or emulated local).
// Survives SW restart so the popup can repopulate after the SW is recycled.
import { storage } from '../platform/browser';
import type { DetectedItem } from '../types';
import { normalizeUrl } from '../detection/urlNormalizer';

const KEY_PREFIX = 'detect:';

function key(tabId: number): string {
  return KEY_PREFIX + tabId;
}

export async function getDetections(tabId: number): Promise<DetectedItem[]> {
  const res = await storage.session.get(key(tabId));
  return (res[key(tabId)] as DetectedItem[]) || [];
}

export async function addDetection(
  tabId: number,
  item: DetectedItem,
): Promise<{ added: boolean; list: DetectedItem[] }> {
  const list = await getDetections(tabId);
  const norm = normalizeUrl(item.url);
  const existing = list.find((d) => normalizeUrl(d.url) === norm);
  if (existing) {
    // merge richer info (variants) if we now have it
    if (item.variants && !existing.variants) existing.variants = item.variants;
    if (item.isMaster && !existing.isMaster) existing.isMaster = true;
    if (item.contentType && !existing.contentType) existing.contentType = item.contentType;
    await storage.session.set({ [key(tabId)]: list });
    return { added: false, list };
  }
  const next = [...list, { ...item, url: norm }];
  await storage.session.set({ [key(tabId)]: next });
  return { added: true, list: next };
}

export async function clearTab(tabId: number): Promise<void> {
  await storage.session.remove(key(tabId));
}

/** Drop all detection keys (e.g. on browser start cleanup). */
export async function clearAll(): Promise<void> {
  const all = await storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
  if (keys.length) await storage.session.remove(keys);
}

/** Mark a detection as unreachable (probe failed) so the UI can filter it. */
export async function markDetectionDead(tabId: number, url: string): Promise<void> {
  const list = await getDetections(tabId);
  const norm = normalizeUrl(url);
  const hit = list.find((d) => normalizeUrl(d.url) === norm);
  if (!hit || hit.dead) return;
  hit.dead = true;
  await storage.session.set({ [key(tabId)]: list });
}

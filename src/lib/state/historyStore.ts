// Download history, FIFO-capped.
import { storage } from '../platform/browser';
import type { HistoryEntry } from '../types';
import { getSettings } from './settingsStore';

const KEY = 'history';

export async function listHistory(): Promise<HistoryEntry[]> {
  const res = await storage.local.get(KEY);
  return (res[KEY] as HistoryEntry[]) || [];
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const cur = await listHistory();
  const settings = await getSettings();
  const next = [entry, ...cur].slice(0, settings.historyCap);
  await storage.local.set({ [KEY]: next });
}

export async function updateHistory(
  id: string,
  patch: Partial<HistoryEntry>,
): Promise<void> {
  const cur = await listHistory();
  const next = cur.map((h) => (h.id === id ? { ...h, ...patch } : h));
  await storage.local.set({ [KEY]: next });
}

export async function removeHistory(id: string): Promise<void> {
  const cur = await listHistory();
  await storage.local.set({ [KEY]: cur.filter((h) => h.id !== id) });
}

export async function clearHistory(): Promise<void> {
  await storage.local.set({ [KEY]: [] });
}

export function subscribeHistory(cb: (entries: HistoryEntry[]) => void): () => void {
  return storage.onChanged('local', (changes) => {
    if (KEY in changes && changes[KEY].newValue) {
      cb(changes[KEY].newValue as HistoryEntry[]);
    }
  });
}

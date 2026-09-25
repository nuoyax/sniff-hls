// Resume support: tracks which segments of a media playlist were already
// fetched for a given source m3u8, so a retry of the same download can skip
// them. Persisted to storage.local (small: URL → segment index set).
import { storage } from '../platform/browser';

const KEY = 'resumeState';
const MAX_ENTRIES = 50;

export interface ResumeEntry {
  /** Media playlist URL (after master resolution). */
  url: string;
  /** Indices of segments already fetched (contiguous prefix, but stored as a set for safety). */
  doneIndices: number[];
  updatedAt: number;
}

type ResumeMap = Record<string, ResumeEntry>;

async function load(): Promise<ResumeMap> {
  const res = await storage.local.get(KEY);
  return (res[KEY] as ResumeMap) || {};
}

async function save(map: ResumeMap): Promise<void> {
  // Cap entries: drop oldest.
  const entries = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  const trimmed = entries.slice(0, MAX_ENTRIES);
  await storage.local.set({ [KEY]: Object.fromEntries(trimmed.map((e) => [e.url, e])) });
}

export async function getResumeState(url: string): Promise<Set<number>> {
  const map = await load();
  return new Set(map[url]?.doneIndices ?? []);
}

export async function saveResumeState(url: string, done: Iterable<number>): Promise<void> {
  const map = await load();
  map[url] = { url, doneIndices: [...done], updatedAt: Date.now() };
  await save(map);
}

export async function clearResumeState(url: string): Promise<void> {
  const map = await load();
  delete map[url];
  await save(map);
}

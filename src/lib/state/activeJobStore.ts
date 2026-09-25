// Persisted index of in-flight download jobs.
//
// The SW's in-memory job map dies with the service worker (MV3 recycles after
// ~30s idle), taking GET_ACTIVE and cancel with it even though the engine host
// keeps downloading. Mirroring the map into storage.session lets a restarted SW
// answer the UI again and route CANCEL back to the host.
import { storage } from '../platform/browser';
import type { DownloadJob, DownloadProgress } from '../types';

const KEY = 'activeJobs';

/** Minimal job record the SW needs to describe + cancel a download. */
export interface PersistedJob {
  job: DownloadJob;
  status: DownloadProgress['status'];
  done: number;
  total: number;
  bytesLoaded: number;
  startedAt: number;
  historyId: string;
}

export async function loadActiveJobs(): Promise<PersistedJob[]> {
  try {
    const res = await storage.session.get(KEY);
    return (res[KEY] as PersistedJob[]) || [];
  } catch {
    return [];
  }
}

export async function saveActiveJobs(jobs: PersistedJob[]): Promise<void> {
  try {
    if (jobs.length) await storage.session.set({ [KEY]: jobs });
    else await storage.session.remove(KEY);
  } catch {
    /* session storage may be unavailable while the SW is shutting down */
  }
}

// Background service worker (MV3). Stays thin:
//  - observes webRequest for m3u8 URLs
//  - routes messages from the UI (popup/options/manager)
//  - dispatches download jobs to the engine host
//  - updates badges + history
// All heavy work happens in the offscreen/runner host, NOT here.
import { bapi } from '@/lib/platform/browser';
import { capabilities } from '@/lib/platform/featureDetect';
import { storage } from '@/lib/platform/browser';
import { registerMessageHandler, onProgressPort, type Request, type Response } from '@/lib/platform/messaging';
import { isM3u8Url, isHlsContentType, deriveBaseFilename, extractM3u8Url } from '@/lib/detection/urlNormalizer';
import { probeVariants } from '@/lib/detection/masterQualityProbe';
import { getDetections, addDetection, clearTab } from '@/lib/state/sessionStore';
import { getSettings, setSettings, subscribeSettings, DEFAULT_SETTINGS } from '@/lib/state/settingsStore';
import { addHistory, updateHistory } from '@/lib/state/historyStore';
import { loadActiveJobs, saveActiveJobs, type PersistedJob } from '@/lib/state/activeJobStore';
import { setBadge, clearBadge, type BadgeState } from '@/lib/detection/badge';
import { ensureHost, markHostReady, sendToHost, setupHostPort, cancelJobInHost } from '@/lib/engine/hostManager';
import { applyProxy, clearProxy } from '@/lib/platform/proxyShim';
import { sanitizeFilename } from '@/lib/platform/downloadsShim';
import { setDebug } from '@/lib/log';
import log from '@/lib/log';
import { genId } from '@/lib/engine/fetcher';
import type { DownloadJob, DownloadProgress, HistoryEntry } from '@/lib/types';

export default defineBackground(() => {
  // ---- init ----
  // Host port must be wired before ensureHost / downloads.
  setupHostPort(handleHostMessage);
  void bootstrap();

  subscribeSettings(async (s) => {
    setDebug(s.debug);
    if (s.proxy.mode !== 'none' && s.proxy.host) {
      await applyProxy(s.proxy as any);
    } else {
      await clearProxy();
    }
    refreshAllBadges();
  });

  // ---- webRequest detection ----
  if (capabilities.webRequest) {
    const filter = { urls: ['<all_urls>'] };
    bapi.webRequest.onBeforeRequest.addListener(onWebRequest, filter);
    bapi.webRequest.onResponseStarted.addListener(onResponseStarted, filter, [
      'responseHeaders',
    ]);
  }

  bapi.tabs.onRemoved.addListener((tabId: number) => {
    void clearTab(tabId).then(() => refreshBadge(tabId));
  });
  bapi.tabs.onActivated.addListener((info: any) => refreshBadge(info.tabId));

  // ---- messages from UI ----
  registerMessageHandler(handleMessage);

  // ---- streaming progress ports (host → SW → UI) ----
  setupProgressFanout();

  // ---- host → SW messages (engine lifecycle) + content scan relay ----
  bapi.runtime.onMessage.addListener((msg: any, sender: any) => {
    if (msg && msg.__host === true) {
      handleHostMessage(msg);
      return undefined;
    }
    if (msg && msg.__content_scan === true) {
      const tabId = sender?.tab?.id;
      if (typeof tabId === 'number' && Array.isArray(msg.urls)) {
        for (const url of msg.urls) {
          void recordDetection(tabId, url, 'dom');
        }
      }
      return undefined;
    }
    return undefined;
  });

  log.info('background ready', capabilities.target, {
    offscreen: capabilities.offscreen,
    webRequest: capabilities.webRequest,
  });
});

// ===================== bootstrap =====================
async function bootstrap() {
  try {
    const s = await getSettings();
    setDebug(s.debug);
    if (s.proxy.mode !== 'none' && s.proxy.host) {
      await applyProxy(s.proxy as any);
    }
  } catch (e) {
    log.warn('bootstrap settings failed', e);
  }
  await rehydrateActiveJobs();
  // Pre-warm the host so the first download is snappy.
  ensureHost().catch(() => {});
}

/**
 * Re-adopt downloads that survived an SW recycle.
 *
 * The engine host keeps running without us, but our in-memory map (and with it
 * GET_ACTIVE + cancel) is gone. Mirror the persisted records back into memory
 * and ask the host which jobs it is actually still running, so stale entries
 * don't linger as phantom "active" downloads forever.
 */
async function rehydrateActiveJobs() {
  try {
    const persisted = await loadActiveJobs();
    if (!persisted.length) return;
    for (const p of persisted) {
      activeJobs.set(p.job.id, {
        jobId: p.job.id,
        url: p.job.url,
        baseFilename: p.job.baseFilename,
        format: p.job.format,
        status: p.status,
        done: p.done,
        total: p.total,
        bytesLoaded: p.bytesLoaded,
        startedAt: p.startedAt,
        historyId: p.historyId,
        job: p.job,
        lastHistoryWrite: Date.now(),
      });
    }
    log.info('rehydrated active jobs after SW restart', persisted.length);

    // Expect the host's JOBS reply before probing, so a fast reply isn't lost.
    pendingReconcile = true;
    const res = (await sendToHost({ __host: true, kind: 'LIST_JOBS' })) as { ok?: boolean };
    if (!res?.ok) {
      pendingReconcile = false;
      dropStaleJobs();
    }
  } catch (e) {
    log.warn('rehydrate active jobs failed', e);
    activeJobs.clear();
    void saveActiveJobs([]);
  }
}

/** Drop persisted jobs the host is no longer running; keep the live ones. */
function reconcileWithHost(hostJobIds: string[]) {
  const live = new Set(hostJobIds);
  let dropped = 0;
  for (const [id, j] of activeJobs) {
    if (!live.has(id)) {
      activeJobs.delete(id);
      void updateHistory(j.historyId, { status: 'error', error: 'Interrupted by browser restart' });
      dropped++;
    }
  }
  pendingReconcile = false;
  if (dropped) log.info('dropped interrupted jobs', dropped);
  persistActiveJobs();
}

/** No host reachable → every persisted job is stale. */
function dropStaleJobs() {
  for (const [, j] of activeJobs) {
    void updateHistory(j.historyId, { status: 'error', error: 'Interrupted by browser restart' });
  }
  activeJobs.clear();
  void saveActiveJobs([]);
}

// ===================== detection =====================
function onWebRequest(details: { tabId: number; url: string }) {
  if (details.tabId < 0) return;
  if (!isM3u8Url(details.url)) return;
  void recordDetection(details.tabId, details.url, 'network');
}

function onResponseStarted(details: {
  tabId: number;
  url: string;
  statusCode: number;
  responseHeaders?: { name: string; value?: string }[];
}) {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  if (isM3u8Url(details.url)) return; // already handled by onBeforeRequest

  // Playlists served from extension-less URLs (CDN endpoints, player proxies)
  // are invisible to the URL matcher — fall back to the response Content-Type.
  const contentType = details.responseHeaders?.find(
    (h) => h.name.toLowerCase() === 'content-type',
  )?.value;
  if (isHlsContentType(contentType)) {
    void recordDetection(details.tabId, details.url, 'network', contentType);
  }
}

async function recordDetection(
  tabId: number,
  url: string,
  source: 'network' | 'dom',
  contentType?: string,
) {
  const s = await getSettings();
  if (!s.autoDetect && source === 'network') return;
  // Unwrap player proxies like /m3u8/?url=https%3A%2F%2Fcdn%2Findex.m3u8
  const real = extractM3u8Url(url) || url;
  const pageUrl = await safeTabUrl(tabId);
  const { added, list } = await addDetection(tabId, {
    url: real,
    originalUrl: real === url ? undefined : url,
    source,
    detectedAt: Date.now(),
    pageUrl,
    contentType,
  });
  if (added) {
    log.debug('detected', real, real !== url ? `(from ${url})` : '');
    refreshBadge(tabId, list.length);
    // Probe quality in the background; update the stored item.
    probeVariants(real).then((variants) => {
      if (!variants.length) return;
      void addDetection(tabId, {
        url: real,
        source,
        detectedAt: Date.now(),
        variants,
        isMaster: variants.length > 1,
        pageUrl,
      });
      refreshBadge(tabId);
    });
  }
}

async function safeTabUrl(tabId: number): Promise<string | undefined> {
  try {
    const t = await bapi.tabs.get(tabId);
    return t?.url;
  } catch {
    return undefined;
  }
}

async function safeTabInfo(tabId: number): Promise<{ title?: string; url?: string }> {
  try {
    const t = await bapi.tabs.get(tabId);
    return { title: t?.title, url: t?.url };
  } catch {
    return {};
  }
}

async function refreshBadge(tabId: number, count?: number) {
  const s = await getSettings();
  if (!s.autoDetect) {
    clearBadge(tabId);
    return;
  }
  const list = count !== undefined ? count : (await getDetections(tabId)).length;
  const state: BadgeState = list > 0 ? 'detected' : 'idle';
  setBadge(tabId, list, state);
}

async function refreshAllBadges() {
  const tabs = await bapi.tabs.query({});
  for (const t of tabs) if (t.id != null) refreshBadge(t.id);
}

// ===================== message handler =====================
async function handleMessage(req: Request): Promise<Response> {
  switch (req.type) {
    case 'GET_DETECTIONS': {
      const list = await getDetections(req.tabId);
      return { ok: true, data: list };
    }
    case 'GET_TAB_INFO': {
      const info = await safeTabInfo(req.tabId);
      return { ok: true, data: info };
    }
    case 'SCAN_PAGE': {
      try {
        await bapi.scripting.executeScript({
          target: { tabId: req.tabId },
          files: ['content-scripts/content.js'],
        });
        // content script posts detections back via runtime message
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    case 'START_DOWNLOAD': {
      const id = startDownloadJob(req).catch((e) => log.error('start download failed', e));
      return { ok: true, data: { jobId: await id } };
    }
    case 'CANCEL_DOWNLOAD': {
      cancelJob(req.jobId);
      return { ok: true };
    }
    case 'GET_ACTIVE': {
      return { ok: true, data: Object.fromEntries(Array.from(activeJobs, ([id, j]) => [id, toActiveView(j)])) };
    }
    case 'OPEN_MANAGER': {
      await bapi.tabs.create({ url: bapi.runtime.getURL('download-manager.html') });
      return { ok: true };
    }
    case 'APPLY_PROXY': {
      const r = await applyProxy(req.config);
      return { ok: r.ok, error: r.ok ? undefined : r.message, data: r.message };
    }
    case 'CLEAR_PROXY': {
      await clearProxy();
      const s = await getSettings();
      await setSettings({ proxy: { ...DEFAULT_SETTINGS.proxy } });
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown request' };
  }
}

// ===================== download orchestration =====================
interface ActiveJob {
  jobId: string;
  url: string;
  baseFilename: string;
  format: import('@/lib/types').OutputFormat;
  status: DownloadProgress['status'];
  done: number;
  total: number;
  bytesLoaded: number;
  startedAt: number;
  historyId: string;
  /** Full job description — persisted so a recycled SW can still cancel it. */
  job: DownloadJob;
  /** Last time history was written for this job (throttles storage writes). */
  lastHistoryWrite: number;
}

const activeJobs = new Map<string, ActiveJob>();
/** History writes are throttled: progress ticks at segment rate. */
const HISTORY_WRITE_INTERVAL_MS = 5000;
/** True while we're expecting the host's JOBS reply to a LIST_JOBS probe. */
let pendingReconcile = false;

function persistActiveJobs(): void {
  const snapshot: PersistedJob[] = Array.from(activeJobs.values()).map((j) => ({
    job: j.job,
    status: j.status,
    done: j.done,
    total: j.total,
    bytesLoaded: j.bytesLoaded,
    startedAt: j.startedAt,
    historyId: j.historyId,
  }));
  void saveActiveJobs(snapshot);
}

function toActiveView(j: ActiveJob) {
  return {
    jobId: j.jobId,
    url: j.url,
    baseFilename: j.baseFilename,
    format: j.format,
    status: j.status,
    done: j.done,
    total: j.total,
    bytesLoaded: j.bytesLoaded,
    startedAt: j.startedAt,
  };
}

async function startDownloadJob(req: Extract<Request, { type: 'START_DOWNLOAD' }>): Promise<string> {
  const s = await getSettings();
  const jobId = genId('dl_');
  const historyId = genId('h_');
  // The popup already sanitized + timestamped the filename; sanitize again as
  // a defense-in-depth (also normalizes for programmatic START_DOWNLOAD calls).
  const baseFilename = sanitizeFilename(req.payload.baseFilename || deriveBaseFilename(req.payload.url));

  // Apply the user's configured download subfolder, if any.
  const subfolder = (s.subfolder || '').trim().replace(/[<>:"/\\|?*]/g, '').replace(/^\/+|\/+$/g, '');
  const fullFilename = subfolder ? `${subfolder}/${baseFilename}.mp4` : `${baseFilename}.mp4`;

  const job: DownloadJob = {
    id: jobId,
    url: req.payload.url,
    variantUrl: req.payload.variantUrl,
    format: req.payload.format === 'auto' ? s.format : req.payload.format,
    concurrency: s.concurrency,
    defaultQuality: s.defaultQuality,
    baseFilename,
    filename: fullFilename,
    pageUrl: req.payload.pageUrl,
    tabId: req.payload.tabId,
  };

  const history: HistoryEntry = {
    id: historyId,
    url: req.payload.url,
    pageUrl: req.payload.pageUrl,
    filename: fullFilename,
    format: job.format,
    sizeBytes: 0,
    startedAt: Date.now(),
    status: 'fetching',
  };
  await addHistory(history);

  const active: ActiveJob = {
    jobId,
    url: req.payload.url,
    baseFilename,
    format: job.format,
    status: 'fetching',
    done: 0,
    total: 0,
    bytesLoaded: 0,
    startedAt: Date.now(),
    historyId,
    job,
    lastHistoryWrite: Date.now(),
  };
  activeJobs.set(jobId, active);
  persistActiveJobs();

  // Fire-and-forget; engine runs in the host.
  void runJobInHost(job, active).catch((e) => {
    log.error('job run failed', e);
  });

  return jobId;
}

function cancelJob(jobId: string) {
  const j = activeJobs.get(jobId);
  if (!j) return;
  j.status = 'canceled';
  // The engine lives in the host: without this the download keeps running and
  // eventually writes the file even though the UI already shows "canceled".
  void cancelJobInHost(jobId);
  void updateHistory(j.historyId, { status: 'canceled' });
  broadcastProgress({
    jobId,
    status: 'canceled',
    done: j.done,
    total: j.total,
    bytesLoaded: j.bytesLoaded,
    bytesTotal: 0,
  });
  activeJobs.delete(jobId);
  persistActiveJobs();
}

// ===================== engine host execution =====================
//
// Because the engine needs Blob/URL (absent in the SW), we run it inside the
// host context. The SW sends a RUN_JOB message to the host; the host boots
// DownloadEngine, streams progress back to the SW, builds the Blob, calls
// chrome.downloads, and reports completion. The SW then updates history + UI.
async function runJobInHost(job: DownloadJob, _active: ActiveJob): Promise<void> {
  // Ask the host to run the job. The host will post __host progress messages.
  try {
    await sendToHost({ __host: true, kind: 'RUN_JOB', job });
  } catch (e) {
    const message = (e as Error).message || String(e);
    log.error('job run failed', e);
    onHostError(job.id, { code: 'HOST', message });
    throw e;
  }
}

function handleHostMessage(msg: any) {
  if (msg.kind === 'PROGRESS') {
    onHostProgress(msg.progress as DownloadProgress);
  } else if (msg.kind === 'COMPLETE') {
    onHostComplete(msg.jobId, msg.result);
  } else if (msg.kind === 'ERROR') {
    onHostError(msg.jobId, msg.error);
  } else if (msg.kind === 'HOST_READY') {
    markHostReady();
    log.info('host ready', msg.host);
  } else if (msg.kind === 'JOBS' && pendingReconcile) {
    reconcileWithHost(Array.isArray(msg.ids) ? msg.ids : []);
  }
}

function onHostProgress(p: DownloadProgress) {
  const j = activeJobs.get(p.jobId);
  if (!j) return;
  j.status = p.status;
  j.done = p.done;
  j.total = p.total;
  j.bytesLoaded = p.bytesLoaded;
  broadcastProgress(p);
  // Progress ticks arrive per segment; writing storage.local on every one both
  // thrashes the disk and can lose the final write during SW shutdown. Keep the
  // in-memory map live and persist to history at most every few seconds.
  const now = Date.now();
  if (now - j.lastHistoryWrite >= HISTORY_WRITE_INTERVAL_MS) {
    j.lastHistoryWrite = now;
    void updateHistory(j.historyId, { status: p.status });
    persistActiveJobs();
  }
}

async function onHostComplete(jobId: string, result: { sizeBytes: number; filename: string; format: import('@/lib/types').OutputFormat }) {
  const j = activeJobs.get(jobId);
  if (!j) return;
  j.status = 'complete';
  await updateHistory(j.historyId, {
    status: 'complete',
    completedAt: Date.now(),
    sizeBytes: result.sizeBytes,
    filename: result.filename,
    format: result.format,
  });
  const s = await getSettings();
  if (s.notifyOnComplete && capabilities.notifications) {
    try {
      bapi.notifications.create(`done_${jobId}`, {
        type: 'basic',
        iconUrl: bapi.runtime.getURL('icon/48.png'),
        title: 'Download complete',
        message: result.filename,
      });
    } catch {
      /* noop */
    }
  }
  broadcastProgress({ jobId, status: 'complete', done: j.done, total: j.total, bytesLoaded: result.sizeBytes, bytesTotal: result.sizeBytes, filename: result.filename, outputFormat: result.format });
  activeJobs.delete(jobId);
  persistActiveJobs();
}

async function onHostError(jobId: string, error: { code: string; message: string }) {
  const j = activeJobs.get(jobId);
  if (!j) return;
  // An engine abort is a cancellation, not a failure — don't paint it red.
  if (error.code === 'CANCELED') {
    await updateHistory(j.historyId, { status: 'canceled' });
    broadcastProgress({
      jobId,
      status: 'canceled',
      done: j.done,
      total: j.total,
      bytesLoaded: j.bytesLoaded,
      bytesTotal: 0,
    });
    activeJobs.delete(jobId);
    persistActiveJobs();
    return;
  }
  j.status = 'error';
  await updateHistory(j.historyId, { status: 'error', error: error.message });
  broadcastProgress({ jobId, status: 'error', done: j.done, total: j.total, bytesLoaded: j.bytesLoaded, bytesTotal: 0, error: error.message });
  activeJobs.delete(jobId);
  persistActiveJobs();
}

// ===================== progress fan-out (SW → UI ports) =====================
const progressSinks = new Map<string, Set<(e: any) => void>>();

function setupProgressFanout() {
  onProgressPort((jobId, send) => {
    let set = progressSinks.get(jobId);
    if (!set) {
      set = new Set();
      progressSinks.set(jobId, set);
    }
    set.add(send);
    // Immediately send current state if we have it.
    const j = activeJobs.get(jobId);
    if (j) {
      send({ jobId, status: j.status, done: j.done, total: j.total, bytesLoaded: j.bytesLoaded, bytesTotal: 0 });
    }
    // We can't detect disconnect of the UI port from here easily; rely on
    // periodic broadcasts. Keep the sink until job completes.
  });
}

function broadcastProgress(p: DownloadProgress) {
  const sinks = progressSinks.get(p.jobId);
  if (!sinks) return;
  for (const send of sinks) send(p);
  if (p.status === 'complete' || p.status === 'error' || p.status === 'canceled') {
    progressSinks.delete(p.jobId);
  }
}

// Re-export for host module to call (host → SW uses runtime.sendMessage).
export { activeJobs };

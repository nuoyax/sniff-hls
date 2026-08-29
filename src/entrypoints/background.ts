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
import { isM3u8Url, isHlsContentType, normalizeUrl, deriveBaseFilename, extractM3u8Url } from '@/lib/detection/urlNormalizer';
import { probeVariants } from '@/lib/detection/masterQualityProbe';
import { getDetections, addDetection, clearTab } from '@/lib/state/sessionStore';
import { getSettings, setSettings, subscribeSettings, DEFAULT_SETTINGS } from '@/lib/state/settingsStore';
import { addHistory, updateHistory, listHistory } from '@/lib/state/historyStore';
import { setBadge, clearBadge, type BadgeState } from '@/lib/detection/badge';
import { ensureHost, markHostReady, sendToHost, setupHostPort } from '@/lib/engine/hostManager';
import { applyProxy, clearProxy } from '@/lib/platform/proxyShim';
import { openOrFocusPage } from '@/lib/platform/pageOpener';
import { sanitizeFilename } from '@/lib/platform/downloadsShim';
import { DownloadEngine } from '@/lib/engine/engine';
import { ExtensionError } from '@/lib/errors';
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
    bapi.webRequest.onResponseStarted.addListener(onResponseStarted, filter);
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
  // Pre-warm the host so the first download is snappy.
  ensureHost().catch(() => {});
}

// ===================== detection =====================
function onWebRequest(details: { tabId: number; url: string }) {
  if (details.tabId < 0) return;
  if (!isM3u8Url(details.url)) return;
  void recordDetection(details.tabId, details.url, 'network');
}

function onResponseStarted(details: { tabId: number; url: string; statusCode: number }) {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  // Content-Type-based detection handled elsewhere; URL match is primary here.
  if (isM3u8Url(details.url)) return; // already handled by onBeforeRequest
}

async function recordDetection(tabId: number, url: string, source: 'network' | 'dom') {
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
      return { ok: true, data: Object.fromEntries(activeJobs) };
    }
    case 'OPEN_MANAGER': {
      await openOrFocusPage('download-manager.html');
      return { ok: true };
    }
    case 'APPLY_PROXY': {
      const r = await applyProxy(req.config);
      // Persist the applied config so it survives SW restarts / browser relaunch.
      if (r.ok) await setSettings({ proxy: req.config });
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
  engine?: DownloadEngine;
  historyId: string;
}

const activeJobs = new Map<string, ActiveJob>();

async function startDownloadJob(req: Extract<Request, { type: 'START_DOWNLOAD' }>): Promise<string> {
  const s = await getSettings();
  const jobId = genId('dl_');
  const historyId = genId('h_');
  // The popup already sanitized + timestamped the filename; sanitize again as
  // a defense-in-depth (also normalizes for programmatic START_DOWNLOAD calls).
  const baseFilename = sanitizeFilename(req.payload.baseFilename || deriveBaseFilename(req.payload.url));

  // Apply the user's configured download directory, if any. Supports absolute
  // paths (C:\Videos or /home/user/Videos) — chrome.downloads.filename accepts
  // absolute paths on desktop. Strip only characters illegal in a path while
  // preserving separators, drive letters and a leading '/'.
  const dir = (s.downloadDir || '')
    .trim()
    .replace(/[<>:"|?*]/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const fullFilename = dir ? `${dir}/${baseFilename}.mp4` : `${baseFilename}.mp4`;

  const job: DownloadJob = {
    id: jobId,
    url: req.payload.url,
    variantUrl: req.payload.variantUrl,
    format: req.payload.format === 'auto' ? s.format : req.payload.format,
    concurrency: s.concurrency,
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
  };
  activeJobs.set(jobId, active);

  // Fire-and-forget; engine runs in the host.
  void runJobInHost(job, active).catch((e) => {
    log.error('job run failed', e);
  });

  return jobId;
}

function cancelJob(jobId: string) {
  const j = activeJobs.get(jobId);
  if (!j) return;
  j.engine?.cancel();
  j.status = 'canceled';
  void updateHistory(j.historyId, { status: 'canceled' });
  broadcastProgress({
    jobId,
    status: 'canceled',
    done: j.done,
    total: j.total,
    bytesLoaded: j.bytesLoaded,
    bytesTotal: 0,
  });
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
  // Best-effort history status update.
  void updateHistory(j.historyId, { status: p.status });
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
        message: `${result.filename} · ${formatBytes(result.sizeBytes)}`,
      });
    } catch {
      /* noop */
    }
  }
  broadcastProgress({ jobId, status: 'complete', done: j.done, total: j.total, bytesLoaded: result.sizeBytes, bytesTotal: result.sizeBytes, filename: result.filename, outputFormat: result.format });
  activeJobs.delete(jobId);
}

async function onHostError(jobId: string, error: { code: string; message: string }) {
  const j = activeJobs.get(jobId);
  if (!j) return;
  j.status = 'error';
  await updateHistory(j.historyId, { status: 'error', error: error.message });
  broadcastProgress({ jobId, status: 'error', done: j.done, total: j.total, bytesLoaded: j.bytesLoaded, bytesTotal: 0, error: error.message });
  const s = await getSettings();
  if (s.notifyOnComplete && capabilities.notifications) {
    try {
      bapi.notifications.create(`err_${jobId}`, {
        type: 'basic',
        iconUrl: bapi.runtime.getURL('icon/48.png'),
        title: `Download failed (${error.code})`,
        message: `${j.baseFilename} · ${error.message}`,
      });
    } catch {
      /* noop */
    }
  }
  activeJobs.delete(jobId);
}

// Notification click → open the download manager page.
bapi.notifications?.onClicked?.addListener((notifId: string) => {
  if (notifId.startsWith('done_') || notifId.startsWith('err_')) {
    void openOrFocusPage('download-manager.html');
  }
});

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
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

// Engine host abstraction: hidden extension page (download-runner.html).
// chrome.offscreen cannot call chrome.downloads, so we always use the runner page.
import { bapi } from '../platform/browser';
import log from '../log';
import { HOST_PORT_PREFIX } from './hostProtocol';

const RUNNER_URL = 'download-runner.html';

let ensuring: Promise<void> | null = null;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;
let hostIsReady = false;
let hostPort: any = null;
let runnerTabId: number | null = null;
let portListenerAttached = false;
let hostMsgHandler: ((msg: any) => void) | null = null;

function armReadyWait(): Promise<void> {
  if (hostIsReady && hostPort) return Promise.resolve();
  if (readyPromise) return readyPromise;
  readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  return readyPromise;
}

function clearReadyFlag(): void {
  hostIsReady = false;
  readyPromise = null;
  readyResolve = null;
}

/** Called when the host port announces HOST_READY (or reconnects). */
export function markHostReady(): void {
  hostIsReady = true;
  readyResolve?.();
  readyResolve = null;
  readyPromise = null;
}

export function prefersOffscreen(): boolean {
  return false;
}

function ensurePortListener(): void {
  if (portListenerAttached) return;
  portListenerAttached = true;
  bapi.runtime.onConnect.addListener((port: any) => {
    if (!String(port.name || '').startsWith(HOST_PORT_PREFIX)) return;
    log.info('host port connected', port.name);
    hostPort = port;
    markHostReady();

    port.onMessage.addListener((msg: any) => {
      if (msg?.kind === 'HOST_READY') {
        markHostReady();
        log.info('host ready', msg.host);
        return;
      }
      // Normalize to the same shape handleHostMessage expects.
      hostMsgHandler?.({ __host: true, ...msg });
    });

    port.onDisconnect.addListener(() => {
      log.warn('host port disconnected');
      if (hostPort === port) hostPort = null;
      clearReadyFlag();
    });
  });
}

/** Wire SW-side host port handling. Call once from background bootstrap. */
export function setupHostPort(onHostMsg: (msg: any) => void): void {
  hostMsgHandler = onHostMsg;
  ensurePortListener();
}

export async function ensureHost(opts?: { recreate?: boolean }): Promise<void> {
  ensurePortListener();

  if (opts?.recreate) {
    await tearDownHost();
    clearReadyFlag();
    ensuring = null;
  }

  if (!ensuring) {
    ensuring = (async () => {
      try {
        await ensureRunnerPage();
      } catch (e) {
        log.error('ensure host failed', e);
      }
    })().finally(() => {
      if (!hostIsReady) ensuring = null;
    });
  }
  await ensuring;

  try {
    await Promise.race([
      armReadyWait(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('host ready timeout')), 10000),
      ),
    ]);
  } catch (e) {
    log.warn('host ready wait failed', e);
    ensuring = null;
  }
}

async function tearDownHost(): Promise<void> {
  try {
    hostPort?.disconnect?.();
  } catch {
    /* noop */
  }
  hostPort = null;

  try {
    const tabs = await bapi.tabs.query({ url: bapi.runtime.getURL(RUNNER_URL) });
    for (const t of tabs || []) {
      if (t.id != null) {
        try {
          await bapi.tabs.remove(t.id);
        } catch {
          /* noop */
        }
      }
    }
  } catch (e) {
    log.warn('close runner tabs failed', e);
  }
  runnerTabId = null;
}

async function ensureRunnerPage(): Promise<void> {
  const tabs = await bapi.tabs.query({ url: bapi.runtime.getURL(RUNNER_URL) });
  if (tabs && tabs.length && hostPort) {
    runnerTabId = tabs[0].id;
    return;
  }
  // Stale runner tab without a live port → close and recreate.
  if (tabs && tabs.length) {
    for (const t of tabs) {
      if (t.id != null) {
        try {
          await bapi.tabs.remove(t.id);
        } catch {
          /* noop */
        }
      }
    }
  }
  clearReadyFlag();
  const tab = await bapi.tabs.create({ url: bapi.runtime.getURL(RUNNER_URL), active: false });
  runnerTabId = tab.id;
  log.info('runner page created', runnerTabId);
}

export function getRunnerTabId(): number | null {
  return runnerTabId;
}

function isNoReceiver(e: unknown): boolean {
  const msg = String((e as Error)?.message || e);
  return /Receiving end does not exist|Could not establish connection|host ready timeout|no host port/i.test(msg);
}

/** Send a command to the engine host via the long-lived port (with recreate+retry). */
export async function sendToHost(msg: unknown): Promise<unknown> {
  await ensureHost();
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      if (!hostPort) throw new Error('no host port');
      hostPort.postMessage(msg);
      return { ok: true };
    } catch (e) {
      lastErr = e;
      if (!isNoReceiver(e)) throw e;
      log.warn('sendToHost failed, recreating host', e);
      await ensureHost({ recreate: true });
    }
  }
  throw lastErr;
}

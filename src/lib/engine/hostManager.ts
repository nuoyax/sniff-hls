// Engine host abstraction. The engine logic (lib/engine/engine.ts) is the same
// everywhere; only the *host* (where fetch/Blob/URL live) differs:
//   - Chromium 109+/Edge: chrome.offscreen document
//   - Firefox / Safari / older: hidden extension page (download-runner.html)
//
// SW ↔ host communicate over runtime ports. The host boots the DownloadEngine,
// runs a job, creates the Blob URL, and hands it to chrome.downloads — all
// inside the DOM context where those APIs exist.
import { bapi } from '../platform/browser';
import { capabilities } from '../platform/featureDetect';
import log from '../log';

const OFFSCREEN_URL = 'offscreen.html';
const RUNNER_URL = 'download-runner.html';
const OFFSCREEN_REASON = 'Fetch, decrypt, and transmux m3u8 segments and assemble a Blob for download.';

let ensuring: Promise<void> | null = null;

/** True if this build/runtime can use chrome.offscreen. */
export function prefersOffscreen(): boolean {
  return capabilities.offscreen;
}

/** Ensure the engine host document/page exists. Idempotent. */
export async function ensureHost(): Promise<void> {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    try {
      if (prefersOffscreen()) {
        await ensureOffscreen();
      } else {
        await ensureRunnerPage();
      }
    } catch (e) {
      log.error('ensure host failed', e);
      // If offscreen path errored, fall back to runner page.
      if (prefersOffscreen()) {
        try {
          await ensureRunnerPage();
        } catch (e2) {
          log.error('runner fallback also failed', e2);
        }
      }
    }
  })();
  return ensuring;
}

async function ensureOffscreen(): Promise<void> {
  const existing = await bapi.offscreen.hasDocument?.();
  if (existing) return;
  try {
    await bapi.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS', 'DOM_PARSER'],
      justification: OFFSCREEN_REASON,
    });
    log.info('offscreen document created');
  } catch (e: any) {
    // "only a single offscreen" / already exists races → ignore those.
    if (String(e?.message || e).includes('Only a single offscreen')) return;
    throw e;
  }
}

let runnerTabId: number | null = null;
async function ensureRunnerPage(): Promise<void> {
  // Reuse an existing runner tab if present.
  const tabs = await bapi.tabs.query({ url: bapi.runtime.getURL(RUNNER_URL) });
  if (tabs && tabs.length) {
    runnerTabId = tabs[0].id;
    return;
  }
  const tab = await bapi.tabs.create({ url: bapi.runtime.getURL(RUNNER_URL), active: false });
  runnerTabId = tab.id;
  log.info('runner page created', runnerTabId);
}

export function getRunnerTabId(): number | null {
  return runnerTabId;
}

/** Send a command to the engine host via messaging (runtime.sendMessage). */
export async function sendToHost(msg: unknown): Promise<unknown> {
  return bapi.runtime.sendMessage(msg);
}

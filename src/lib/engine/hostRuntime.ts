// Shared host runtime: runs inside the hidden extension page (download-runner)
// / offscreen document. This is the DOM context where Blob / URL.createObjectURL
// / chrome.downloads live.
//
// Uses a long-lived runtime Port (name: sniffls-host:*) so the SW can reliably
// dispatch RUN_JOB without broadcast sendMessage races.
import { bapi } from '../platform/browser';
import { DownloadEngine } from './engine';
import { startDownload, whenDownloadSettled } from '../platform/downloadsShim';
import { toObjectURL } from './blobAssembler';
import { ExtensionError } from '../errors';
import log from '../log';
import type { DownloadJob, DownloadProgress } from '../types';
import { HOST_PORT_PREFIX } from './hostProtocol';

const engines = new Map<string, DownloadEngine>();
let port: any = null;

function postToSw(msg: Record<string, unknown>): void {
  try {
    port?.postMessage(msg);
  } catch {
    /* port gone — reconnect will happen */
  }
  // Also broadcast for SW listeners that use onMessage (best-effort).
  bapi.runtime.sendMessage({ __host: true, ...msg }).catch(() => {});
}

function handleHostCommand(msg: any): void {
  if (!msg) return;
  if (msg.kind === 'RUN_JOB' && msg.job) {
    void runJob(msg.job as DownloadJob);
  } else if (msg.kind === 'CANCEL' && msg.jobId) {
    engines.get(msg.jobId)?.cancel();
  } else if (msg.kind === 'PAUSE' && msg.jobId) {
    engines.get(msg.jobId)?.pause();
  } else if (msg.kind === 'RESUME' && msg.jobId) {
    engines.get(msg.jobId)?.resume();
  }
}

function connect(hostName: string): void {
  try {
    port = bapi.runtime.connect({ name: HOST_PORT_PREFIX + hostName });
  } catch (e) {
    log.error('host connect failed', e);
    setTimeout(() => connect(hostName), 1000);
    return;
  }

  port.onMessage.addListener((msg: any) => handleHostCommand(msg));
  port.onDisconnect.addListener(() => {
    port = null;
    log.warn('host port disconnected; reconnecting');
    setTimeout(() => connect(hostName), 500);
  });

  port.postMessage({ kind: 'HOST_READY', host: hostName });
  log.info('host runtime ready:', hostName);
}

export function bootstrapHost(hostName: string): void {
  // Keep onMessage as a fallback path.
  bapi.runtime.onMessage.addListener((msg: any) => {
    if (!msg || msg.__host !== true) return undefined;
    handleHostCommand(msg);
    // Ack so SW sendMessage promise resolves.
    return Promise.resolve({ ok: true });
  });

  connect(hostName);
}

async function runJob(job: DownloadJob): Promise<void> {
  const engine = new DownloadEngine(job, {
    onProgress: (p: DownloadProgress) => {
      postToSw({ kind: 'PROGRESS', progress: p });
    },
    onComplete: async (result) => {
      engines.delete(job.id);
      try {
        const url = toObjectURL(result.blob);
      const filename = job.filename || result.filename;
        const downloadId = await startDownload({ url, filename });
        log.info('download started', downloadId, filename);

        try {
          await whenDownloadSettled(downloadId, 30 * 60_000);
          postToSw({
            kind: 'COMPLETE',
            jobId: job.id,
            result: {
              sizeBytes: result.blob.size,
              filename,
              format: result.format,
            },
          });
        } catch (e) {
          postToSw({
            kind: 'ERROR',
            jobId: job.id,
            error: { code: 'DOWNLOAD', message: (e as Error).message },
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      } catch (e) {
        postToSw({
          kind: 'ERROR',
          jobId: job.id,
          error: { code: 'DOWNLOAD', message: (e as Error).message },
        });
      }
    },
    onError: (e: ExtensionError) => {
      engines.delete(job.id);
      postToSw({
        kind: 'ERROR',
        jobId: job.id,
        error: { code: e.code, message: e.toHuman() },
      });
    },
  });

  engines.set(job.id, engine);
  await engine.run();
}

// Shared host runtime: runs inside BOTH the chrome.offscreen document and the
// Firefox/Safari hidden extension page (download-runner). This is the DOM
// context where Blob / URL.createObjectURL / chrome.downloads live.
//
// Protocol with the background SW:
//   SW → host: { __host: true, kind: 'RUN_JOB', job }
//   host → SW: { __host: true, kind: 'PROGRESS', progress }
//   host → SW: { __host: true, kind: 'COMPLETE', jobId, result }
//   host → SW: { __host: true, kind: 'ERROR', jobId, error }
import { bapi } from '../platform/browser';
import { DownloadEngine } from './engine';
import { startDownload, whenDownloadSettled } from '../platform/downloadsShim';
import { toObjectURL } from './blobAssembler';
import { ExtensionError } from '../errors';
import log from '../log';
import type { DownloadJob, DownloadProgress } from '../types';

const engines = new Map<string, DownloadEngine>();

export function bootstrapHost(hostName: string): void {
  // Announce readiness so the SW knows the host is alive.
  bapi.runtime
    .sendMessage({ __host: true, kind: 'HOST_READY', host: hostName })
    .catch(() => {
      /* SW may be asleep; that's fine */
    });

  bapi.runtime.onMessage.addListener((msg: any, _sender: any, _reply: any) => {
    if (!msg || msg.__host !== true) return undefined;
    if (msg.kind === 'RUN_JOB' && msg.job) {
      void runJob(msg.job as DownloadJob);
      return undefined; // async; no reply
    }
    if (msg.kind === 'CANCEL' && msg.jobId) {
      engines.get(msg.jobId)?.cancel();
    }
    return undefined;
  });

  log.info('host runtime ready:', hostName);
}

async function runJob(job: DownloadJob): Promise<void> {
  const engine = new DownloadEngine(job, {
    onProgress: (p: DownloadProgress) => {
      bapi.runtime.sendMessage({ __host: true, kind: 'PROGRESS', progress: p }).catch(() => {});
    },
    onComplete: async (result) => {
      engines.delete(job.id);
      try {
        // Create the Blob URL in this DOM context and hand it to chrome.downloads.
        const url = toObjectURL(result.blob);
        const downloadId = await startDownload({ url, filename: result.filename });
        log.info('download started', downloadId, result.filename);

        try {
          await whenDownloadSettled(downloadId, 30 * 60_000);
          bapi.runtime
            .sendMessage({
              __host: true,
              kind: 'COMPLETE',
              jobId: job.id,
              result: {
                sizeBytes: result.blob.size,
                filename: result.filename,
                format: result.format,
              },
            })
            .catch(() => {});
        } catch (e) {
          bapi.runtime
            .sendMessage({
              __host: true,
              kind: 'ERROR',
              jobId: job.id,
              error: { code: 'DOWNLOAD', message: (e as Error).message },
            })
            .catch(() => {});
        } finally {
          // Release the blob URL after the browser has read it.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      } catch (e) {
        bapi.runtime
          .sendMessage({
            __host: true,
            kind: 'ERROR',
            jobId: job.id,
            error: { code: 'DOWNLOAD', message: (e as Error).message },
          })
          .catch(() => {});
      }
    },
    onError: (e: ExtensionError) => {
      engines.delete(job.id);
      bapi.runtime
        .sendMessage({
          __host: true,
          kind: 'ERROR',
          jobId: job.id,
          error: { code: e.code, message: e.toHuman() },
        })
        .catch(() => {});
    },
  });

  engines.set(job.id, engine);
  await engine.run();
}

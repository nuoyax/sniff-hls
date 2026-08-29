// Strongly-typed messaging between UI entrypoints and the background SW.
import { bapi } from './browser';

// ----- Request/Response schema -----
export type Request =
  | { type: 'GET_DETECTIONS'; tabId: number }
  | { type: 'GET_TAB_INFO'; tabId: number }
  | { type: 'SCAN_PAGE'; tabId: number }
  | { type: 'START_DOWNLOAD'; payload: StartDownloadPayload }
  | { type: 'CANCEL_DOWNLOAD'; jobId: string }
  | { type: 'PAUSE_DOWNLOAD'; jobId: string }
  | { type: 'RESUME_DOWNLOAD'; jobId: string }
  | { type: 'GET_ACTIVE' }
  | { type: 'OPEN_MANAGER' }
  | { type: 'APPLY_PROXY'; config: import('./proxyShim').ProxyConfig }
  | { type: 'CLEAR_PROXY' };

export interface StartDownloadPayload {
  url: string;
  format: import('../types').OutputFormat;
  variantUrl?: string;
  baseFilename: string;
  pageUrl?: string;
  tabId?: number;
}

export interface TabInfo {
  title?: string;
  url?: string;
}

export interface Response {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type MessageHandler = (req: Request) => Promise<Response> | Response;

let registered = false;
const handlers = new Set<MessageHandler>();

function dispatch(req: Request, _sender: unknown): Promise<Response> {
  for (const h of handlers) {
    const r = h(req);
    if (r instanceof Promise) {
      return r.then(
        (res) => res ?? { ok: false, error: 'no response' },
        (e) => ({ ok: false, error: (e as Error).message }),
      );
    }
    if (r) return Promise.resolve(r);
  }
  return Promise.resolve({ ok: false, error: 'unhandled' });
}

/** Register a message handler (background SW). Idempotent. */
export function registerMessageHandler(h: MessageHandler): () => void {
  handlers.add(h);
  if (!registered) {
    registered = true;
    const listener = (msg: unknown, _sender: unknown): Promise<Response> | undefined => {
      if (msg && typeof msg === 'object' && 'type' in (msg as any)) {
        return dispatch(msg as Request, _sender);
      }
      return undefined;
    };
    bapi.runtime.onMessage.addListener(listener);
  }
  return () => handlers.delete(h);
}

/** Send a message from a UI context to the background. */
export async function sendMessage(req: Request): Promise<Response> {
  return (await bapi.runtime.sendMessage(req)) as Response;
}

// ----- Streaming progress over a long-lived port -----
export type ProgressEvent =
  | import('../types').DownloadProgress
  | { kind: 'log'; jobId: string; message: string };

const PROGRESS_PORT_PREFIX = 'progress:';

export function openProgressPort(jobId: string): {
  onProgress: (cb: (e: ProgressEvent) => void) => () => void;
  close: () => void;
} {
  const port = bapi.runtime.connect({ name: PROGRESS_PORT_PREFIX + jobId });
  const cbs = new Set<(e: ProgressEvent) => void>();
  port.onMessage.addListener((msg: ProgressEvent) => {
    for (const cb of cbs) cb(msg);
  });
  return {
    onProgress(cb) {
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    close() {
      try {
        port.disconnect();
      } catch {
        /* noop */
      }
    },
  };
}

export function isProgressPort(name: string): boolean {
  return name.startsWith(PROGRESS_PORT_PREFIX);
}

export function jobIdFromPort(name: string): string {
  return name.slice(PROGRESS_PORT_PREFIX.length);
}

/** Background-side: handle incoming progress ports and give the SW a sink. */
export function onProgressPort(cb: (jobId: string, send: (e: ProgressEvent) => void) => void): void {
  bapi.runtime.onConnect.addListener((port: any) => {
    if (!isProgressPort(port.name)) return;
    const jobId = jobIdFromPort(port.name);
    cb(jobId, (e) => {
      try {
        port.postMessage(e);
      } catch {
        /* port closed */
      }
    });
  });
}

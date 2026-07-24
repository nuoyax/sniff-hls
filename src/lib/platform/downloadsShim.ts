// Downloads shim: hand a Blob URL to the browser's native download list,
// with cross-platform filename sanitization.
import { bapi } from './browser';
import type { HistoryEntry } from '../types';

export interface DownloadOptions {
  /** Blob URL (blob:...) or http(s) URL to download. */
  url: string;
  /** Full filename, including extension. */
  filename: string;
  /** Prompt the user for save location. Default false. */
  saveAs?: boolean;
}

/** Strip OS-illegal characters from a filename. */
export function sanitizeFilename(name: string): string {
  // Windows: < > : " / \ | ? *   (also control chars)
  // macOS/Linux: / and NUL
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

/** Start a browser download. Returns the downloadId. */
export async function startDownload(opts: DownloadOptions): Promise<number> {
  if (!bapi.downloads?.download) {
    throw new Error('downloads API unavailable');
  }
  const id = await bapi.downloads.download({
    url: opts.url,
    filename: opts.filename,
    saveAs: opts.saveAs ?? false,
    conflictAction: 'uniquify',
  });
  return id as number;
}

/** Resolve once the download reaches a terminal state. */
export function whenDownloadSettled(id: number, timeoutMs = 5 * 60_000): Promise<HistoryEntry['status']> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bapi.downloads.onChanged.removeListener(listener);
      reject(new Error('download settle timeout'));
    }, timeoutMs);

    const listener = (delta: any) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') {
        clearTimeout(timer);
        bapi.downloads.onChanged.removeListener(listener);
        resolve('complete');
      } else if (delta.state?.current === 'interrupted') {
        clearTimeout(timer);
        bapi.downloads.onChanged.removeListener(listener);
        // chrome's 'interrupted' can recover; treat as error for MVP
        resolve('error');
      }
    };
    bapi.downloads.onChanged.addListener(listener);
  });
}

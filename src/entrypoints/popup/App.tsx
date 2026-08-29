import { useEffect, useState, useCallback } from 'react';
import { sendMessage, openProgressPort, type ProgressEvent } from '@/lib/platform/messaging';
import { openOrFocusPage } from '@/lib/platform/pageOpener';
import type { DetectedItem, DownloadProgress, OutputFormat, VariantInfo } from '@/lib/types';
import { Button } from '@/components/Button';
import { Badge, qualityLabel } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { ProgressRing } from '@/components/Progress';
import { Settings, RefreshCw, Download as DownloadIcon, ListVideo, Edit3, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { deriveBaseFilename, buildDefaultFilename, sanitizeTitleStem, timestampString } from '@/lib/detection/urlNormalizer';

interface ActiveDownload {
  jobId: string;
  status: DownloadProgress['status'];
  ratio: number;
  format?: OutputFormat;
  error?: string;
}

export default function App() {
  const { t } = useI18n();
  const [detections, setDetections] = useState<DetectedItem[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [pageUrl, setPageUrl] = useState<string | undefined>();
  const [pageTitle, setPageTitle] = useState<string | undefined>();
  const [autoDetect, setAutoDetect] = useState(true);
  const [active, setActive] = useState<Record<string, ActiveDownload>>({});
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tab = await getCurrentTab();
        if (!tab?.id) {
          // Not running as an installed extension popup (e.g. opened HTML directly).
          setBootError('无法获取当前标签页。请从 chrome://extensions 加载扩展后，再点工具栏图标打开。');
          return;
        }
        setTabId(tab.id);
        setPageUrl(tab.url);
        // Fetch the page title from the SW for a sensible default filename.
        // Timeout: if the service worker never responds, don't spin forever.
        const info = await withTimeout(
          sendMessage({ type: 'GET_TAB_INFO', tabId: tab.id }),
          5000,
          'Background 无响应（service worker 可能未启动）',
        );
        if (cancelled) return;
        if (info.ok && info.data) {
          const t = info.data as { title?: string; url?: string };
          setPageTitle(t.title);
        } else if (tab.title) {
          setPageTitle(tab.title);
        }
        await withTimeout(refresh(tab.id), 5000, '获取检测列表超时');
      } catch (e) {
        if (!cancelled) {
          setBootError((e as Error).message || String(e));
          // Fall back to tab title from tabs API if SW is down.
          try {
            const tab = await getCurrentTab();
            if (tab?.title) setPageTitle(tab.title);
            if (tab?.id) setTabId(tab.id);
            if (tab?.url) setPageUrl(tab.url);
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (tid: number) => {
    const res = await sendMessage({ type: 'GET_DETECTIONS', tabId: tid });
    if (res.ok && Array.isArray(res.data)) setDetections(res.data as DetectedItem[]);
  }, []);

  // Keep popup download badges in sync with the SW (ports alone miss jobs
  // started while the popup was closed, or when a port disconnects).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await sendMessage({ type: 'GET_ACTIVE' });
        if (!alive || !res.ok || !res.data) return;
        const map = res.data as Record<
          string,
          { url: string; status: DownloadProgress['status']; done: number; total: number; format?: OutputFormat }
        >;
        setActive((prev) => {
          const next: Record<string, ActiveDownload> = { ...prev };
          for (const [jobId, j] of Object.entries(map)) {
            if (!j?.url) continue;
            const ratio = j.total > 0 ? j.done / j.total : next[j.url]?.ratio ?? 0;
            next[j.url] = {
              jobId,
              status: j.status,
              ratio,
              format: j.format ?? next[j.url]?.format,
              error: next[j.url]?.error,
            };
          }
          return next;
        });
      } catch {
        /* SW may be restarting */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const onScan = useCallback(async () => {
    if (tabId == null) return;
    await sendMessage({ type: 'SCAN_PAGE', tabId });
    setTimeout(() => refresh(tabId), 800);
  }, [tabId, refresh]);

  const openOptions = useCallback(async () => {
    await openOrFocusPage('options.html');
  }, []);

  const openManager = useCallback(async () => {
    await sendMessage({ type: 'OPEN_MANAGER' });
  }, []);

  const startDownload = useCallback(
    async (url: string, variant: VariantInfo | undefined, customFilename?: string) => {
      if (tabId == null) return;
      // Default filename: page title + timestamp; user can override via the
      // rename field. Sanitize and append a fresh timestamp on every download.
      const base = customFilename && customFilename.trim()
        ? `${sanitizeTitleStem(customFilename.trim())}_${timestampString()}`
        : buildDefaultFilename(pageTitle);
      const res = await sendMessage({
        type: 'START_DOWNLOAD',
        payload: {
          url,
          format: 'auto' as OutputFormat,
          variantUrl: variant?.url,
          baseFilename: base,
          pageUrl,
          tabId,
        },
      });
      if (res.ok && res.data && typeof (res.data as any).jobId === 'string') {
        const jobId = (res.data as { jobId: string }).jobId;
        setActive((a) => ({ ...a, [url]: { jobId, status: 'queued', ratio: 0 } }));
        const port = openProgressPort(jobId);
        port.onProgress((e: ProgressEvent) => {
          if ('kind' in e) return; // ignore log events
          const p = e as DownloadProgress;
          const ratio = p.total > 0 ? p.done / p.total : 0;
          setActive((a) => ({
            ...a,
            [url]: { jobId, status: p.status, ratio, format: p.outputFormat, error: p.error },
          }));
        });
      } else {
        setActive((a) => ({
          ...a,
          [url]: {
            jobId: '',
            status: 'error',
            ratio: 0,
            error: res.error || 'Failed to start download',
          },
        }));
      }
    },
    [tabId, pageUrl, pageTitle],
  );

  const cancel = useCallback(async (jobId: string, url: string) => {
    await sendMessage({ type: 'CANCEL_DOWNLOAD', jobId });
    setActive((a) => ({ ...a, [url]: { ...a[url], status: 'canceled' } }));
  }, []);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-fg-muted">Loading…</div>
    );
  }

  return (
    <div className="flex flex-col">
      {bootError && (
        <div className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-[11px] text-danger">
          {bootError}
        </div>
      )}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Sniffls</span>
          {pageUrl && <span className="max-w-[140px] truncate text-[11px] text-fg-muted">{hostOf(pageUrl)}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onScan} title={t('popup.scan')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={openManager} title={t('popup.manager')}>
            <ListVideo className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={openOptions} title={t('header.settings')}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {!autoDetect && (
        <div className="border-b border-warn/30 bg-warn/5 px-4 py-2 text-[11px] text-warn">
          {t('popup.autodetect.off')}
        </div>
      )}

      <div className="max-h-[440px] overflow-y-auto p-2">
        {detections.length === 0 ? (
          <EmptyState
            title={t('popup.empty.title')}
            hint={t('popup.empty.hint')}
            action={
              <Button variant="primary" size="sm" onClick={onScan}>
                <RefreshCw className="h-3.5 w-3.5" /> {t('popup.scan')}
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {detections.map((d) => (
              <StreamItem
                key={d.url}
                item={d}
                pageTitle={pageTitle}
                active={active[d.url]}
                onDownload={(v, fname) => startDownload(d.url, v, fname)}
                onCancel={() => active[d.url] && cancel(active[d.url].jobId, d.url)}
                onPauseResume={(pause) =>
                  active[d.url] &&
                  sendMessage({
                    type: pause ? 'PAUSE_DOWNLOAD' : 'RESUME_DOWNLOAD',
                    jobId: active[d.url].jobId,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-fg-muted">
        {t('popup.detected')}: {detections.length} ·{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openManager();
          }}
          className="text-accent hover:underline"
        >
          {t('popup.openManager')}
        </a>
      </footer>
    </div>
  );
}

function StreamItem({
  item,
  pageTitle,
  active,
  onDownload,
  onCancel,
  onPauseResume,
}: {
  item: DetectedItem;
  pageTitle?: string;
  active?: ActiveDownload;
  onDownload: (variant?: VariantInfo, filename?: string) => void;
  onCancel: () => void;
  onPauseResume: (pause: boolean) => void;
}) {
  const variants = item.variants ?? [];
  const best = variants.length ? variants[variants.length - 1] : undefined;
  const { t } = useI18n();
  const isDownloading = active && ['fetching', 'decrypting', 'transmuxing', 'assembling', 'downloading'].includes(active.status);
  const isDone = active?.status === 'complete';
  const isError = active?.status === 'error';

  // Editable filename state. Defaults to page-title-based stem (no timestamp
  // yet — timestamp appended on actual download so re-downloads don't collide).
  const defaultStem = pageTitle ? sanitizeTitleStem(pageTitle) : deriveBaseFilename(item.url);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(defaultStem);

  // Keep the editable name in sync if the page title arrives after mount.
  useEffect(() => {
    if (!editing) setName(pageTitle ? sanitizeTitleStem(pageTitle) : deriveBaseFilename(item.url));
  }, [pageTitle, item.url, editing]);

  const trigger = (v?: VariantInfo) => onDownload(v, name);

  return (
    <li className="rounded-xl border border-border bg-bg-elevated p-3 shadow-card transition-colors hover:border-accent/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge tone={item.source === 'network' ? 'accent' : 'neutral'}>
              {item.source === 'network' ? 'NET' : 'DOM'}
            </Badge>
            {best?.resolution && (
              <Badge tone="ok">{qualityLabel(best.resolution.height, best.bandwidth)}</Badge>
            )}
            {!best && <Badge>auto</Badge>}
            {isDone && active?.format && <Badge tone="ok">{active.format.toUpperCase()}</Badge>}
          </div>
          <p className="mt-1.5 truncate font-mono text-[11px] text-fg-muted" title={item.url}>
            {item.url}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isDownloading ? (
            <>
              <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                <ProgressRing value={active!.ratio} />
                {Math.round((active!.ratio || 0) * 100)}%
              </span>
              <Button variant="ghost" size="sm" onClick={() => onPauseResume(false)} title={t('manager.pause')}>
                ⏸
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel} title={t('popup.cancel')}>
                ✕
              </Button>
            </>
          ) : active?.status === 'paused' ? (
            <>
              <Badge tone="warn">{t('manager.pause')}</Badge>
              <Button variant="ghost" size="sm" onClick={() => onPauseResume(true)} title={t('manager.resume')}>
                ▶
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel} title={t('popup.cancel')}>
                ✕
              </Button>
            </>
          ) : isDone ? (
            <Badge tone="ok">{t('popup.done')}</Badge>
          ) : isError ? (
            <Badge tone="danger">
              <span title={active?.error}>{t('popup.failed')}</span>
            </Badge>
          ) : (
            <Button variant="primary" size="sm" onClick={() => trigger(best)}>
              <DownloadIcon className="h-3.5 w-3.5" /> {t('popup.download')}
            </Button>
          )}
        </div>
      </div>

      {/* Filename editor */}
      {!isDownloading && !isDone && (
        <div className="mt-2 flex items-center gap-1.5">
          {editing ? (
            <>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setEditing(false); trigger(best); }
                  if (e.key === 'Escape') { setEditing(false); setName(defaultStem); }
                }}
                placeholder={t('popup.filename')}
                className="min-w-0 flex-1 rounded-md border border-accent/50 bg-bg px-2 py-1 text-[11px] text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              />
              <span className="shrink-0 font-mono text-[10px] text-fg-muted">_&lt;ts&gt;.mp4</span>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); trigger(best); }} title={t('popup.confirm')}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent/40 hover:text-fg"
              title={t('popup.rename')}
            >
              <Edit3 className="h-3 w-3 shrink-0" />
              <span className="truncate">{name}</span>
              <span className="shrink-0 font-mono">_{timestampString().slice(0, 8)}…</span>
            </button>
          )}
        </div>
      )}

      {variants.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {variants.map((v, i) => (
            <button
              key={i}
              onClick={() => trigger(v)}
              className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-accent/40 hover:text-fg"
              title={v.url}
            >
              {qualityLabel(v.resolution?.height, v.bandwidth)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function getCurrentTab(): Promise<{ id?: number; url?: string; title?: string } | null> {
  const b = (typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null) as any;
  if (!b?.tabs?.query) return null;
  try {
    const [tab] = await b.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/Progress';
import { EmptyState } from '@/components/EmptyState';
import { PageShell } from '@/components/PageShell';
import { sendMessage } from '@/lib/platform/messaging';
import { bapi } from '@/lib/platform/browser';
import { listHistory, subscribeHistory, clearHistory, removeHistory } from '@/lib/state/historyStore';
import { useI18n } from '@/lib/i18n';
import type { DownloadProgress, HistoryEntry } from '@/lib/types';

interface ActiveView {
  jobId: string;
  url: string;
  status: DownloadProgress['status'];
  ratio: number;
  filename?: string;
}

/** Cancel the engine job behind an active row. */
async function cancelJob(jobId: string) {
  await sendMessage({ type: 'CANCEL_DOWNLOAD', jobId });
}

async function pauseJob(jobId: string) {
  await sendMessage({ type: 'PAUSE_DOWNLOAD', jobId });
}

async function resumeJob(jobId: string) {
  await sendMessage({ type: 'RESUME_DOWNLOAD', jobId });
}

/** Hard delete a history row: erase the file from disk + drop the entry. */
async function deleteHistoryHard(h: HistoryEntry) {
  // If the entry maps to a finished browser download, erase the file too.
  if (h.downloadId) {
    try {
      const items = await bapi.downloads.search({ id: h.downloadId });
      if (items?.[0]) await bapi.downloads.removeFile(h.downloadId);
    } catch {
      /* file already gone */
    }
  }
  await removeHistory(h.id);
}

/** Double-click / ▶: open the downloaded file; fall back to showing its folder. */
async function openHistoryFile(h: HistoryEntry) {
  if (!h.downloadId) return;
  try {
    const items = await bapi.downloads.search({ id: h.downloadId });
    const item = items?.[0];
    if (item?.exists && item.state === 'complete') {
      await bapi.downloads.open(h.downloadId);
    } else {
      await bapi.downloads.show(h.downloadId);
    }
  } catch {
    // open() may be blocked; reveal the containing folder instead.
    try {
      await bapi.downloads.show(h.downloadId);
    } catch {
      /* nothing else we can do */
    }
  }
}

export default function App() {
  const [active, setActive] = useState<ActiveView[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const { t } = useI18n();
  const pageSize = 20;

  useEffect(() => {
    listHistory().then(setHistory);
    const unsub = subscribeHistory(setHistory);
    return unsub;
  }, []);

  // Poll active jobs (the SW holds the live map).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const res = await sendMessage({ type: 'GET_ACTIVE' });
      if (!alive || !res.ok || !res.data) return;
      const map = res.data as Record<string, any>;
      const list = Object.entries(map).map(([jobId, j]) => ({
        jobId,
        url: j.url,
        status: j.status,
        ratio: j.total > 0 ? j.done / j.total : 0,
        filename: j.baseFilename,
      }));
      setActive(list);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(history.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = history.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <PageShell
      page="manager"
      title={t('manager.title')}
      subtitle={t('manager.subtitle')}
      actions={
        history.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => clearHistory().then(() => listHistory().then(setHistory))}>
            {t('manager.clearHistory')}
          </Button>
        ) : undefined
      }
    >

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('manager.active')}</h2>
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-fg-muted">
            {t('manager.active.empty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((a) => {
              const isPaused = a.status === 'paused';
              const running = !isPaused && a.status !== 'complete' && a.status !== 'error' && a.status !== 'canceled';
              return (
                <li key={a.jobId} className="rounded-xl border border-border bg-bg-elevated p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] text-fg-muted" title={a.url}>
                      {a.url}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge tone={a.status === 'downloading' ? 'ok' : a.status === 'paused' ? 'warn' : 'accent'}>{a.status}</Badge>
                      {running && (
                        <Button variant="ghost" size="sm" onClick={() => pauseJob(a.jobId)} title={t('manager.pause')}>
                          ⏸
                        </Button>
                      )}
                      {isPaused && (
                        <Button variant="ghost" size="sm" onClick={() => resumeJob(a.jobId)} title={t('manager.resume')}>
                          ▶
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => cancelJob(a.jobId)} title={t('popup.cancel')}>
                        ✕
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={a.ratio} />
                    <span className="mt-1 block text-[11px] text-fg-muted">{Math.round(a.ratio * 100)}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('manager.history')}</h2>
        {history.length === 0 ? (
          <EmptyState title={t('manager.history.empty.title')} hint={t('manager.history.empty.hint')} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {paged.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated p-3"
                onDoubleClick={() => void openHistoryFile(h)}
                title={t('manager.openFile')}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{h.filename}</p>
                  <p className="truncate font-mono text-[11px] text-fg-muted" title={h.url}>
                    {h.url} · {formatBytes(h.sizeBytes)} · {formatTime(h.completedAt || h.startedAt)}
                  </p>
                  {h.status === 'error' && h.error && (
                    <p className="mt-1 truncate text-[11px] text-danger" title={h.error}>
                      {h.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    tone={
                      h.status === 'complete' ? 'ok' : h.status === 'error' ? 'danger' : h.status === 'canceled' ? 'warn' : 'neutral'
                    }
                  >
                    {h.status}
                  </Badge>
                  {h.status === 'complete' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openHistoryFile(h)}
                      title={t('manager.openFile')}
                    >
                      ▶
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteHistoryHard(h).then(() => listHistory().then(setHistory))}
                    title={t('manager.delete')}
                  >
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm text-fg-muted">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹ {t('pager.prev')}
            </Button>
            <span className="text-[11px]">
              {t('pager.page')} {page} / {pageCount}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              {t('pager.next')} ›
            </Button>
          </div>
        )}
      </section>
    </PageShell>
  );
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

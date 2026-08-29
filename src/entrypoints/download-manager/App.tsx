import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/Progress';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { sendMessage } from '@/lib/platform/messaging';
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

export default function App() {
  const [active, setActive] = useState<ActiveView[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const { t } = useI18n();

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

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title={t('manager.title')}
        subtitle={t('manager.subtitle')}
        showSettings
        actions={
          history.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => clearHistory().then(() => listHistory().then(setHistory))}>
              {t('manager.clearHistory')}
            </Button>
          ) : undefined
        }
      />

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('manager.active')}</h2>
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-fg-muted">
            {t('manager.active.empty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((a) => (
              <li key={a.jobId} className="rounded-xl border border-border bg-bg-elevated p-3 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-fg-muted" title={a.url}>
                    {a.url}
                  </span>
                  <Badge tone={a.status === 'downloading' ? 'ok' : 'accent'}>{a.status}</Badge>
                </div>
                <div className="mt-2">
                  <ProgressBar value={a.ratio} />
                  <span className="mt-1 block text-[11px] text-fg-muted">{Math.round(a.ratio * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('manager.history')}</h2>
        {history.length === 0 ? (
          <EmptyState title={t('manager.history.empty.title')} hint={t('manager.history.empty.hint')} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated p-3"
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
                  <Button variant="ghost" size="sm" onClick={() => removeHistory(h.id).then(() => listHistory().then(setHistory))}>
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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

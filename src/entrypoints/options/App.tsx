import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { getSettings, setSettings, subscribeSettings, DEFAULT_SETTINGS, type Settings } from '@/lib/state/settingsStore';
import { sendMessage } from '@/lib/platform/messaging';
import { useI18n, type Locale } from '@/lib/i18n';
import type { ProxyConfig } from '@/lib/platform/proxyShim';
import type { OutputFormat } from '@/lib/types';

export default function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [proxyMsg, setProxyMsg] = useState('');
  const { t } = useI18n();

  const [loadError, setLoadError] = useState<string | null>(null);
  // Draft state: edits stay local until the user clicks Save.
  // (Hooks must run unconditionally — declared before any early return.)
  const [draft, setDraft] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    let unsub = () => {};
    getSettings()
      .then((v) => {
        setS(v);
        setDraft(v);
        unsub = subscribeSettings((next) => { setS({ ...next }); if (!dirtyRef.current) setDraft({ ...next }); });
      })
      .catch((e) => {
        setLoadError((e as Error).message || String(e));
        // Still render defaults so the page is usable outside a broken storage context.
        setS({ ...DEFAULT_SETTINGS });
        setDraft({ ...DEFAULT_SETTINGS });
      });
    return () => unsub();
  }, []);

  if (!s || !draft) {
    return (
      <div className="p-8 text-fg-muted">
        {loadError ? `Failed to load settings: ${loadError}` : 'Loading…'}
      </div>
    );
  }

  const update = (patch: Partial<Settings>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setSavedMsg('');
  };

  const save = async () => {
    const { schemaVersion: _sv, ...patch } = draft;
    await setSettings(patch);
    setDirty(false);
    setSavedMsg(t('settings.saved'));
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <Section title={t('section.detection')}>
        <ToggleRow
          label={t('detect.auto.label')}
          hint={t('detect.auto.hint')}
          checked={draft.autoDetect}
          onChange={(v) => update({ autoDetect: v })}
        />
        <ToggleRow
          label={t('detect.dom.label')}
          hint={t('detect.dom.hint')}
          checked={draft.domScan}
          onChange={(v) => update({ domScan: v })}
        />
      </Section>

      <Section title={t('section.downloads')}>
        <Row label={t('downloads.format')}>
          <select
            className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={draft.format}
            onChange={(e) => update({ format: e.target.value as OutputFormat })}
          >
            <option value="auto">{t('downloads.format.auto')}</option>
            <option value="mp4">{t('downloads.format.mp4')}</option>
            <option value="ts">{t('downloads.format.ts')}</option>
          </select>
        </Row>
        <Row label={`${t('downloads.concurrency')}: ${draft.concurrency}`}>
          <input
            type="range"
            min={1}
            max={20}
            value={draft.concurrency}
            onChange={(e) => update({ concurrency: Number(e.target.value) })}
            className="w-48 accent-[rgb(var(--accent))]"
          />
        </Row>
        <Row label={t('downloads.quality')}>
          <select
            className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={draft.defaultQuality}
            onChange={(e) => update({ defaultQuality: e.target.value as any })}
          >
            <option value="highest">{t('downloads.quality.highest')}</option>
            <option value="lowest">{t('downloads.quality.lowest')}</option>
          </select>
        </Row>
        <Row label={t('downloads.subfolder')}>
          <input
            className="w-48 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={draft.subfolder}
            onChange={(e) => update({ subfolder: e.target.value })}
          />
        </Row>
        <ToggleRow
          label={t('downloads.notify')}
          checked={draft.notifyOnComplete}
          onChange={(v) => update({ notifyOnComplete: v })}
        />
      </Section>

      <Section title={t('section.proxy')}>
        <ProxyForm
          config={draft.proxy as ProxyConfig}
          onApply={async (cfg) => {
            const r = await sendMessage({ type: 'APPLY_PROXY', config: cfg });
            setProxyMsg(r.ok ? t('proxy.applied') : `${t('proxy.failed')}: ${r.error}`);
            await update({ proxy: cfg });
          }}
          onClear={async () => {
            await sendMessage({ type: 'CLEAR_PROXY' });
            setProxyMsg(t('proxy.cleared'));
          }}
          message={proxyMsg}
        />
        <p className="mt-2 text-[11px] text-fg-muted">{t('proxy.note')}</p>
      </Section>

      <Section title={t('section.privacy')}>
        <ToggleRow
          label={t('privacy.telemetry')}
          hint={t('privacy.telemetry.hint')}
          checked={draft.telemetry}
          onChange={(v) => update({ telemetry: v })}
        />
        <ToggleRow label={t('privacy.debug')} checked={draft.debug} onChange={(v) => update({ debug: v })} />
      </Section>

      <p className="mt-8 text-[11px] text-fg-muted">
        Sniffls · v0.1.0 · MIT
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const { schemaVersion: _sv, ...defaults } = DEFAULT_SETTINGS;
            setDraft({ ...defaults, schemaVersion: draft.schemaVersion });
            setDirty(true);
            setSavedMsg('');
          }}
        >
          {t('settings.reset')}
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={!dirty}>
          {t('settings.save')}
        </Button>
        {savedMsg && <span className="text-[11px] text-ok">{savedMsg}</span>}
        {dirty && !savedMsg && <span className="text-[11px] text-warn">{t('settings.unsaved')}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-bg-elevated p-5 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-fg">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-fg">{label}</span>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        aria-checked={checked}
        role="switch"
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow"
          style={{ left: checked ? '22px' : '3px', transition: 'left 150ms ease' }}
        />
      </button>
    </div>
  );
}

function ProxyForm({
  config,
  onApply,
  onClear,
  message,
}: {
  config: ProxyConfig;
  onApply: (cfg: ProxyConfig) => void;
  onClear: () => void;
  message: string;
}) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<ProxyConfig>(config);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.mode}
          onChange={(e) => setCfg({ ...cfg, mode: e.target.value as ProxyConfig['mode'] })}
        >
          <option value="none">{t('proxy.mode.none')}</option>
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks">SOCKS5</option>
        </select>
        <input
          placeholder={t('proxy.host')}
          className="flex-1 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.host || ''}
          onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
        />
        <input
          placeholder={t('proxy.port')}
          type="number"
          className="w-20 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.port || ''}
          onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => onApply(cfg)}>
          {t('proxy.apply')}
        </Button>
        {message && <span className="text-[11px] text-fg-muted">{message}</span>}
      </div>
    </div>
  );
}

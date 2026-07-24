import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { getSettings, setSettings, subscribeSettings, type Settings } from '@/lib/state/settingsStore';
import { sendMessage } from '@/lib/platform/messaging';
import type { ProxyConfig } from '@/lib/platform/proxyShim';
import type { OutputFormat } from '@/lib/types';

export default function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [proxyMsg, setProxyMsg] = useState('');

  useEffect(() => {
    let unsub = () => {};
    getSettings().then((v) => {
      setS(v);
      unsub = subscribeSettings((next) => setS({ ...next }));
    });
    return () => unsub();
  }, []);

  if (!s) return <div className="p-8 text-fg-muted">Loading…</div>;

  const update = (patch: Partial<Settings>) => setSettings(patch);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-fg">m3u8 Extra — Settings</h1>
      <p className="mt-1 text-sm text-fg-muted">Tune detection, downloads, and proxy.</p>

      <Section title="Detection">
        <ToggleRow
          label="Auto-detect m3u8 on every page"
          hint="Sniffs network requests for m3u8 URLs and shows a badge count."
          checked={s.autoDetect}
          onChange={(v) => update({ autoDetect: v })}
        />
        <ToggleRow
          label="DOM scan on demand"
          hint="When you click refresh, also scan the page HTML for embedded m3u8."
          checked={s.domScan}
          onChange={(v) => update({ domScan: v })}
        />
      </Section>

      <Section title="Downloads">
        <Row label="Output format">
          <select
            className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={s.format}
            onChange={(e) => update({ format: e.target.value as OutputFormat })}
          >
            <option value="auto">Auto (MP4, fall back to TS)</option>
            <option value="mp4">Always MP4</option>
            <option value="ts">Always TS (raw)</option>
          </select>
        </Row>
        <Row label={`Concurrent segments: ${s.concurrency}`}>
          <input
            type="range"
            min={1}
            max={20}
            value={s.concurrency}
            onChange={(e) => update({ concurrency: Number(e.target.value) })}
            className="w-48 accent-[rgb(var(--accent))]"
          />
        </Row>
        <Row label="Default quality">
          <select
            className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={s.defaultQuality}
            onChange={(e) => update({ defaultQuality: e.target.value as any })}
          >
            <option value="highest">Highest bandwidth</option>
            <option value="lowest">Lowest bandwidth</option>
          </select>
        </Row>
        <Row label="Download subfolder">
          <input
            className="w-48 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
            value={s.subfolder}
            onChange={(e) => update({ subfolder: e.target.value })}
          />
        </Row>
        <ToggleRow
          label="Notify when a download completes"
          checked={s.notifyOnComplete}
          onChange={(v) => update({ notifyOnComplete: v })}
        />
      </Section>

      <Section title="Proxy">
        <ProxyForm
          config={s.proxy as ProxyConfig}
          onApply={async (cfg) => {
            const r = await sendMessage({ type: 'APPLY_PROXY', config: cfg });
            setProxyMsg(r.ok ? 'Proxy applied' : `Failed: ${r.error}`);
            await update({ proxy: cfg });
          }}
          onClear={async () => {
            await sendMessage({ type: 'CLEAR_PROXY' });
            setProxyMsg('Proxy cleared');
          }}
          message={proxyMsg}
        />
        <p className="mt-2 text-[11px] text-fg-muted">
          Note: extension network requests automatically use your browser/system proxy. Configure this only for a per-extension override.
        </p>
      </Section>

      <Section title="Privacy">
        <ToggleRow
          label="Anonymous telemetry"
          hint="Off by default. When on, only feature-usage counters are sent — never URLs, page titles, or file contents."
          checked={s.telemetry}
          onChange={(v) => update({ telemetry: v })}
        />
        <ToggleRow label="Debug logging" checked={s.debug} onChange={(v) => update({ debug: v })} />
      </Section>

      <p className="mt-8 text-[11px] text-fg-muted">
        m3u8 Extra · v0.1.0 · MIT
      </p>
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
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
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
  const [cfg, setCfg] = useState<ProxyConfig>(config);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.mode}
          onChange={(e) => setCfg({ ...cfg, mode: e.target.value as ProxyConfig['mode'] })}
        >
          <option value="none">No proxy / System</option>
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks">SOCKS5</option>
        </select>
        <input
          placeholder="host"
          className="flex-1 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.host || ''}
          onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
        />
        <input
          placeholder="port"
          type="number"
          className="w-20 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
          value={cfg.port || ''}
          onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => onApply(cfg)}>
          Apply
        </Button>
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear
        </Button>
        {message && <span className="text-[11px] text-fg-muted">{message}</span>}
      </div>
    </div>
  );
}

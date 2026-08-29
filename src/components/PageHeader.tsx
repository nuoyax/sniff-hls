import { useEffect, useState } from 'react';
import { Settings, Languages } from 'lucide-react';
import { Button } from '@/components/Button';
import { useI18n } from '@/lib/i18n';
import { getSettings, setSettings } from '@/lib/state/settingsStore';
import iconUrl from '@/assets/icon.svg';

/**
 * Shared page header for full-page UIs (options, download manager).
 * Brand block on the left, optional actions on the right.
 */
export function PageHeader({
  title,
  subtitle,
  showSettings,
  actions,
}: {
  title?: string;
  subtitle?: string;
  showSettings?: boolean;
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
      <div className="flex items-center gap-3">
        <img src={iconUrl} alt="" className="h-9 w-9" />
        <div>
          <h1 className="text-xl font-semibold text-fg">{title ?? t('app.name')}</h1>
          {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        <LanguageSwitch />
        {showSettings && (
          <Button variant="ghost" size="sm" onClick={() => window.open('/options.html')} title={t('header.settings')}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </header>
  );
}

/** Locale picker for the header: auto (browser) / en / zh-CN, persisted to settings. */
function LanguageSwitch() {
  const { t, locale } = useI18n();
  const [setting, setSetting] = useState<string>('auto');

  useEffect(() => {
    getSettings()
      .then((s) => setSetting(s.locale))
      .catch(() => {});
  }, []);

  const change = async (v: string) => {
    setSetting(v);
    await setSettings({ locale: v as 'auto' | 'en' | 'zh-CN' });
  };

  // Effective value for display: explicit setting wins; otherwise show which
  // locale 'auto' resolves to.
  const effective = setting === 'auto' ? locale : setting;
  const label = setting === 'auto' ? `AUTO · ${effective === 'zh-CN' ? '中' : 'EN'}` : effective === 'zh-CN' ? '中文' : 'EN';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => change(effective === 'zh-CN' ? 'en' : 'zh-CN')}
      onContextMenu={(e) => {
        // Right-click cycles to 'auto' (follow browser) as a hidden third state.
        e.preventDefault();
        void change('auto');
      }}
      title={`${t('settings.language')}: ${label}（${t('settings.language.auto')}：右键）`}
    >
      <Languages className="h-3.5 w-3.5" />
      <span className="text-[11px]">{label}</span>
    </Button>
  );
}

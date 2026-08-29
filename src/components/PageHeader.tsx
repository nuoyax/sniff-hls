import { Settings } from 'lucide-react';
import { Button } from '@/components/Button';
import { useI18n } from '@/lib/i18n';

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
        <img src="/icon/128.png" alt="" className="h-9 w-9 rounded-lg" />
        <div>
          <h1 className="text-xl font-semibold text-fg">{title ?? t('app.name')}</h1>
          {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        {showSettings && (
          <Button variant="ghost" size="sm" onClick={() => window.open('/options.html')} title={t('header.settings')}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </header>
  );
}

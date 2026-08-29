import { Settings, ListVideo } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import iconUrl from '@/assets/icon.svg';

/**
 * Shared page shell for full-page UIs (options, download manager):
 * left sidebar navigation (brand + nav + language switch) and a content
 * column. Both pages live in the same window style; navigation stays on
 * one extension page via chrome.runtime URL tabs.
 */
export function PageShell({
  page,
  title,
  subtitle,
  actions,
  children,
}: {
  page: 'manager' | 'settings';
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const navItems = [
    {
      key: 'manager' as const,
      icon: <ListVideo className="h-4 w-4" />,
      label: t('header.manager'),
      url: chrome.runtime.getURL('download-manager.html'),
    },
    {
      key: 'settings' as const,
      icon: <Settings className="h-4 w-4" />,
      label: t('header.settings'),
      url: chrome.runtime.getURL('options.html'),
    },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-bg-subtle px-3 py-5">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src={iconUrl} alt="" className="h-8 w-8" />
          <span className="text-sm font-semibold text-fg">{t('app.name')}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = item.key === page;
            return (
              <a
                key={item.key}
                href={item.url}
                onClick={(e) => {
                  e.preventDefault();
                  if (!active) window.location.href = item.url;
                }}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-accent/10 font-medium text-accent'
                    : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'
                }`}
              >
                {item.icon}
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>

      {/* Content column */}
      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-2xl">
          <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
            <div>
              <h1 className="text-xl font-semibold text-fg">{title}</h1>
              {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-1.5">{actions}</div>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}

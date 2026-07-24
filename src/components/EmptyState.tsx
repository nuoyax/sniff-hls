import { clsx } from '@/lib/cn';
import type { ReactNode } from 'react';
import { Download, Search } from 'lucide-react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-subtle text-fg-muted">
        <Search className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function IconDownload() {
  return <Download className="h-3.5 w-3.5" />;
}

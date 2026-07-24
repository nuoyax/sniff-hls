import { clsx } from '@/lib/cn';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-bg-subtle text-fg-muted border-border',
  accent: 'bg-accent/10 text-accent border-accent/30',
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Format a resolution height into a friendly label (1080p, 720p, etc.). */
export function qualityLabel(height?: number, bandwidth?: number): string {
  if (height) {
    const p = [4320, 2160, 1440, 1080, 720, 480, 360, 240].find((h) => height >= h);
    if (p) return `${p}p`;
    return `${height}p`;
  }
  if (bandwidth) {
    const mbps = bandwidth / 1_000_000;
    return mbps >= 1 ? `${mbps.toFixed(1)}Mbps` : `${Math.round(bandwidth / 1000)}kbps`;
  }
  return 'auto';
}

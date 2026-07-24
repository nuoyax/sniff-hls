// Badge management: reflect detection/download state on the action icon.
import { bapi } from '../platform/browser';
import { capabilities } from '../platform/featureDetect';

export type BadgeState = 'idle' | 'detected' | 'downloading' | 'error';

const COLORS: Record<BadgeState, string> = {
  idle: '#64748b',
  detected: '#4F46E5',
  downloading: '#16a34a',
  error: '#dc2626',
};

export function setBadge(tabId: number, count: number, state: BadgeState): void {
  if (!bapi.action) return;
  try {
    const text = count > 0 ? String(count > 99 ? '99+' : count) : '';
    bapi.action.setBadgeText({ text, tabId });
    bapi.action.setBadgeBackgroundColor({ color: COLORS[state], tabId });
    bapi.action.setBadgeTextColor?.({ color: '#ffffff', tabId });
  } catch {
    /* some browsers ignore per-tab badge */
  }
}

export function clearBadge(tabId: number): void {
  if (!bapi.action) return;
  try {
    bapi.action.setBadgeText({ text: '', tabId });
  } catch {
    /* noop */
  }
}

export function setTitle(tabId: number, title: string): void {
  try {
    bapi.action.setTitle?.({ title, tabId });
  } catch {
    /* noop */
  }
}

// Re-export so background.ts can import a single badge module
export { capabilities };

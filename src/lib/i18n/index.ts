// Minimal i18n: locale setting + flat dictionaries + React hook.
// Locales: 'auto' (follow browser) | 'en' | 'zh-CN'.
import { useEffect, useState } from 'react';
import { getSettings, subscribeSettings } from '../state/settingsStore';

export type Locale = 'en' | 'zh-CN';

type Dict = Record<string, string>;

const en: Dict = {
  // Header / common
  'app.name': 'Sniffls',
  'header.settings': 'Settings',
  'header.manager': 'Download Manager',
  'header.back': 'Back',
  // Settings page
  'settings.title': 'Sniffls — Settings',
  'settings.subtitle': 'Tune detection, downloads, and proxy.',
  'settings.language': 'Language',
  'settings.language.auto': 'Follow browser',
  'settings.reset': 'Reset to defaults',
  'settings.reset.done': 'Settings reset to defaults',
  'settings.save': 'Save',
  'settings.saved': 'Saved',
  'settings.unsaved': 'Unsaved changes',
  'section.general': 'General',
  'section.detection': 'Detection',
  'section.downloads': 'Downloads',
  'section.proxy': 'Proxy',
  'section.privacy': 'Privacy',
  'detect.auto.label': 'Auto-detect m3u8 on every page',
  'detect.auto.hint': 'Sniffs network requests for m3u8 URLs and shows a badge count.',
  'detect.dom.label': 'DOM scan on demand',
  'detect.dom.hint': 'When you click refresh, also scan the page HTML for embedded m3u8.',
  'downloads.format': 'Output format',
  'downloads.format.auto': 'Auto (MP4, fall back to TS)',
  'downloads.format.mp4': 'Always MP4',
  'downloads.format.ts': 'Always TS (raw)',
  'downloads.concurrency': 'Concurrent segments',
  'downloads.retries': 'Segment retries',
  'downloads.resume': 'Resume downloads',
  'downloads.resume.hint': 'Skip already-fetched segments when retrying an incomplete download',
  'downloads.quality': 'Default quality',
  'downloads.quality.highest': 'Highest bandwidth',
  'downloads.quality.lowest': 'Lowest bandwidth',
  'downloads.dir': 'Download directory',
  'downloads.dir.placeholder': 'Absolute path, e.g. D:\Videos',
  'downloads.dir.browse': 'Browse…',
  'downloads.notify': 'Notify when a download completes',
  'proxy.mode.none': 'No proxy / System',
  'proxy.host': 'host',
  'proxy.port': 'port',
  'proxy.apply': 'Apply',
  'proxy.clear': 'Clear',
  'proxy.applied': 'Proxy applied',
  'proxy.cleared': 'Proxy cleared',
  'proxy.failed': 'Failed',
  'proxy.note':
    'Note: extension network requests automatically use your browser/system proxy. Configure this only for a per-extension override.',
  'privacy.telemetry': 'Usage statistics',
  'privacy.telemetry.hint':
    'Off by default. When enabled, only anonymized feature-usage counters are reported — never URLs, page titles, or file contents.',
  'privacy.debug': 'Debug logging',
  // Popup
  'popup.scan': 'Scan page',
  'popup.manager': 'Download manager',
  'popup.autodetect.off': 'Auto-detect is off. Use the refresh button to scan this page.',
  'popup.empty.title': 'No m3u8 detected yet',
  'popup.empty.hint': 'Open a page with HLS video, or click refresh to scan the page.',
  'popup.download': 'Download',
  'popup.cancel': 'Cancel',
  'popup.done': '✓ done',
  'popup.failed': 'failed',
  'popup.detected': 'Detected',
  'popup.openManager': 'open manager',
  'popup.rename': 'Click to rename',
  'popup.confirm': 'Confirm',
  'popup.filename': 'filename',
  // Download manager
  'manager.title': 'Download Manager',
  'manager.subtitle': 'Live downloads and history.',
  'manager.clearHistory': 'Clear history',
  'manager.active': 'Active',
  'manager.active.empty': 'No active downloads.',
  'manager.history': 'History',
  'pager.prev': 'Prev',
  'pager.next': 'Next',
  'pager.page': 'Page',
  'manager.history.empty.title': 'No downloads yet',
  'manager.history.empty.hint': 'Your completed and failed downloads will appear here.',
};

const zh: Dict = {
  'app.name': 'Sniffls',
  'header.settings': '设置',
  'header.manager': '下载管理',
  'header.back': '返回',
  'settings.title': 'Sniffls — 设置',
  'settings.subtitle': '调整检测、下载与代理。',
  'settings.language': '语言',
  'settings.language.auto': '跟随浏览器',
  'settings.reset': '重置为默认配置',
  'settings.reset.done': '配置已重置为默认值',
  'settings.save': '保存',
  'settings.saved': '已保存',
  'settings.unsaved': '有未保存的修改',
  'section.general': '通用',
  'section.detection': '检测',
  'section.downloads': '下载',
  'section.proxy': '代理',
  'section.privacy': '隐私',
  'detect.auto.label': '自动检测每个页面的 m3u8',
  'detect.auto.hint': '嗅探网络请求中的 m3u8 地址，并在图标上显示数量角标。',
  'detect.dom.label': '按需 DOM 扫描',
  'detect.dom.hint': '点击刷新时，同时扫描页面 HTML 中内嵌的 m3u8。',
  'downloads.format': '输出格式',
  'downloads.format.auto': '自动（MP4，必要时回退 TS）',
  'downloads.format.mp4': '始终 MP4',
  'downloads.format.ts': '始终 TS（原始）',
  'downloads.concurrency': '并发分段数',
  'downloads.retries': '分片重试次数',
  'downloads.resume': '断点续传',
  'downloads.resume.hint': '重新下载未完成的视频时跳过已下载的分片',
  'downloads.quality': '默认画质',
  'downloads.quality.highest': '最高码率',
  'downloads.quality.lowest': '最低码率',
  'downloads.dir': '下载目录',
  'downloads.dir.placeholder': '绝对路径，如 D:\Videos',
  'downloads.dir.browse': '浏览…',
  'downloads.notify': '下载完成时通知',
  'proxy.mode.none': '不使用代理 / 系统',
  'proxy.host': '主机',
  'proxy.port': '端口',
  'proxy.apply': '应用',
  'proxy.clear': '清除',
  'proxy.applied': '代理已应用',
  'proxy.cleared': '代理已清除',
  'proxy.failed': '失败',
  'proxy.note': '注意：扩展的网络请求会自动使用浏览器/系统代理。仅需要在针对扩展单独覆盖时才配置此项。',
  'privacy.telemetry': '使用情况统计',
  'privacy.telemetry.hint': '默认关闭。开启后仅上报匿名的功能使用计数，绝不会包含 URL、页面标题或文件内容。',
  'privacy.debug': '调试日志',
  'popup.scan': '扫描页面',
  'popup.manager': '下载管理',
  'popup.autodetect.off': '自动检测已关闭。点击刷新按钮扫描当前页面。',
  'popup.empty.title': '尚未检测到 m3u8',
  'popup.empty.hint': '打开含 HLS 视频的页面，或点击刷新扫描页面。',
  'popup.download': '下载',
  'popup.cancel': '取消',
  'popup.done': '✓ 完成',
  'popup.failed': '失败',
  'popup.detected': '已检测',
  'popup.openManager': '打开管理页',
  'popup.rename': '点击重命名',
  'popup.confirm': '确认',
  'popup.filename': '文件名',
  'manager.title': '下载管理',
  'manager.subtitle': '实时下载与历史记录。',
  'manager.clearHistory': '清空历史',
  'manager.active': '进行中',
  'manager.active.empty': '暂无进行中的下载。',
  'manager.history': '历史记录',
  'pager.prev': '上一页',
  'pager.next': '下一页',
  'pager.page': '第',
  'manager.history.empty.title': '还没有下载',
  'manager.history.empty.hint': '已完成和失败的下载会显示在这里。',
};

const DICTS: Record<Locale, Dict> = { en, 'zh-CN': zh };

/** Resolve the 'auto' locale setting to a concrete locale via navigator.language. */
export function resolveLocale(setting: string): Locale {
  if (setting === 'en' || setting === 'zh-CN') return setting;
  const langs: readonly string[] =
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? navigator.languages
      : typeof navigator !== 'undefined'
        ? [navigator.language]
        : ['en'];
  for (const l of langs) {
    if (/^zh\b|^zh-/i.test(l)) return 'zh-CN';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}

export function translate(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? DICTS.en[key] ?? key;
}

export type Translator = (key: string) => string;

/** Subscribe to the locale setting; returns a t() bound to the active locale. */
export function useI18n(): { t: Translator; locale: Locale } {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (alive) setLocale(resolveLocale(s.locale));
      })
      .catch(() => {});
    const unsub = subscribeSettings((s) => {
      if (alive) setLocale(resolveLocale(s.locale));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return { t: (key: string) => translate(locale, key), locale };
}

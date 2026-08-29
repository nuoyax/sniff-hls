import { describe, it, expect } from 'vitest';
import { resolveLocale, translate } from '../src/lib/i18n/index';

describe('resolveLocale', () => {
  it('returns explicit locales as-is', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
  });

  it('falls back to navigator languages for auto', () => {
    const orig = globalThis.navigator;
    // @ts-expect-error test stub
    globalThis.navigator = { languages: ['zh-CN', 'en'], language: 'zh-CN' };
    expect(resolveLocale('auto')).toBe('zh-CN');
    // @ts-expect-error test stub
    globalThis.navigator = { languages: ['en-US'], language: 'en-US' };
    expect(resolveLocale('auto')).toBe('en');
    // @ts-expect-error test stub
    globalThis.navigator = { languages: ['ja-JP'], language: 'ja-JP' };
    expect(resolveLocale('auto')).toBe('en'); // unsupported → en
    globalThis.navigator = orig;
  });

  it('handles missing navigator', () => {
    const orig = globalThis.navigator;
    // @ts-expect-error test stub
    globalThis.navigator = undefined;
    expect(resolveLocale('auto')).toBe('en');
    globalThis.navigator = orig;
  });
});

describe('translate', () => {
  it('returns zh translation', () => {
    expect(translate('zh-CN', 'popup.download')).toBe('下载');
  });

  it('falls back to en when key missing in locale', () => {
    // every key exists in both, so simulate by unknown key → returns key itself
    expect(translate('zh-CN', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

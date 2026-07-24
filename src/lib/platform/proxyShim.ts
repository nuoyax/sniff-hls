// Proxy shim. Cross-browser proxy application.
// Chromium: chrome.proxy.settings.set({ value: {mode, ...}, scope })
// Firefox:  browser.proxy.settings.set (different value schema) OR browser.proxy.onRequest
// Note: extension fetch() already inherits the browser proxy automatically in most cases.
// This module is for users who want a per-extension proxy override.
import { bapi } from './browser';
import { capabilities } from './featureDetect';
import log from '../log';

export type ProxyMode = 'none' | 'system' | 'direct' | 'http' | 'https' | 'socks';

export interface ProxyConfig {
  mode: ProxyMode;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface ProxyResult {
  ok: boolean;
  message: string;
}

export async function applyProxy(cfg: ProxyConfig): Promise<ProxyResult> {
  if (!capabilities.proxy) {
    return { ok: false, message: 'Proxy API not available on this browser.' };
  }

  try {
    if (capabilities.target === 'firefox') {
      // Firefox proxy.settings value schema:
      // { proxyType: 'none'|'auto'|'manual'|..., http, ssl, socks, ... }
      if (cfg.mode === 'none' || cfg.mode === 'system' || cfg.mode === 'direct') {
        await bapi.proxy.settings.set({ value: { proxyType: 'system' } });
      } else {
        const scheme = cfg.mode === 'socks' ? 'socks' : cfg.mode;
        const value: any = {
          proxyType: 'manual',
          socksVersion: 5,
        };
        if (cfg.mode === 'socks') {
          value.socks = cfg.host;
          value.socksPort = cfg.port;
        } else {
          value.http = `${cfg.host}:${cfg.port}`;
          value.ssl = `${cfg.host}:${cfg.port}`;
        }
        await bapi.proxy.settings.set({ value });
      }
      log.info('proxy applied (firefox)', cfg.mode);
      return { ok: true, message: 'Proxy applied' };
    }

    // Chromium
    let value: any;
    if (cfg.mode === 'none' || cfg.mode === 'direct') {
      value = { mode: 'direct' };
    } else if (cfg.mode === 'system') {
      value = { mode: 'system' };
    } else {
      value = {
        mode: cfg.mode === 'socks' ? 'fixed_servers' : 'fixed_servers',
        rules: {
          scheme: cfg.mode === 'socks' ? 'socks' : cfg.mode,
          host: cfg.host,
          port: cfg.port,
        },
      };
    }
    await bapi.proxy.settings.set({ value, scope: 'regular' });
    log.info('proxy applied (chromium)', cfg.mode);
    return { ok: true, message: 'Proxy applied' };
  } catch (e) {
    log.error('proxy apply failed', e);
    return { ok: false, message: (e as Error).message };
  }
}

export async function clearProxy(): Promise<void> {
  try {
    if (capabilities.target === 'firefox') {
      await bapi.proxy.settings.clear({});
    } else if (bapi.proxy?.settings) {
      await bapi.proxy.settings.clear({ scope: 'regular' });
    }
  } catch (e) {
    log.warn('proxy clear failed', e);
  }
}

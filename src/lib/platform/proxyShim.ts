// Proxy shim. Cross-browser proxy application.
// Chromium: chrome.proxy.settings.set({ value: {mode, rules}, scope })
// Firefox:  browser.proxy.settings.set (different value schema)
// Note: chrome.proxy applies profile-wide, not truly per-extension. Extension
// fetch() already inherits the browser/system proxy in most cases.
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

/** Map UI mode → Chromium ProxyServer.scheme */
function chromiumScheme(mode: ProxyMode): 'http' | 'https' | 'socks4' | 'socks5' {
  if (mode === 'socks') return 'socks5';
  if (mode === 'https') return 'https';
  return 'http';
}

function normalizePort(port: unknown): number | undefined {
  const n = typeof port === 'number' ? port : Number(port);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return undefined;
  return Math.trunc(n);
}

export async function applyProxy(cfg: ProxyConfig): Promise<ProxyResult> {
  if (!capabilities.proxy) {
    return { ok: false, message: 'Proxy API not available on this browser.' };
  }

  try {
    if (capabilities.target === 'firefox') {
      if (cfg.mode === 'none' || cfg.mode === 'system' || cfg.mode === 'direct') {
        await bapi.proxy.settings.set({ value: { proxyType: 'system' } });
      } else {
        const port = normalizePort(cfg.port);
        if (!cfg.host?.trim() || port == null) {
          return { ok: false, message: 'Host and a valid port (1–65535) are required.' };
        }
        const value: any = {
          proxyType: 'manual',
          socksVersion: 5,
        };
        if (cfg.mode === 'socks') {
          value.socks = cfg.host.trim();
          value.socksPort = port;
        } else {
          const endpoint = `${cfg.host.trim()}:${port}`;
          value.http = endpoint;
          value.ssl = endpoint;
        }
        await bapi.proxy.settings.set({ value });
      }
      log.info('proxy applied (firefox)', cfg.mode);
      return { ok: true, message: 'Proxy applied' };
    }

    // Chromium — see https://developer.chrome.com/docs/extensions/reference/api/proxy
    let value: Record<string, unknown>;
    if (cfg.mode === 'none' || cfg.mode === 'direct') {
      value = { mode: 'direct' };
    } else if (cfg.mode === 'system') {
      value = { mode: 'system' };
    } else {
      const port = normalizePort(cfg.port);
      const host = cfg.host?.trim();
      if (!host || port == null) {
        return { ok: false, message: 'Host and a valid port (1–65535) are required.' };
      }
      // Must use rules.singleProxy (or proxyForHttp/…); a flat {scheme,host,port}
      // under rules causes TypeError: Invalid invocation.
      value = {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: chromiumScheme(cfg.mode),
            host,
            port,
          },
          bypassList: ['<local>'],
        },
      };
    }

    await bapi.proxy.settings.set({ value, scope: 'regular' });
    log.info('proxy applied (chromium)', cfg.mode, value);
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

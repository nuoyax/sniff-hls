// Unified browser API access + storage shim.
// WXT provides `browser` via `webext-polyfill`; we re-export it and add
// a small storage abstraction that hides the storage.session absence on
// older Firefox builds (falls back to prefixed storage.local).
import { capabilities } from './featureDetect';

declare const browser: any;

export function getBrowser(): any {
  if (typeof browser !== 'undefined') return browser;
  if (typeof chrome !== 'undefined') return chrome;
  throw new Error('No WebExtension runtime');
}

export const bapi = getBrowser();

type Area = 'local' | 'session' | 'sync';
type Changes = Record<string, { oldValue?: any; newValue?: any }>;

function areaOf(area: Area): any {
  if (area === 'session' && !capabilities.storageSession) {
    // Emulate session with a local namespace.
    return wrapLocalNamespace('session:');
  }
  return bapi.storage[area];
}

function wrapLocalNamespace(prefix: string) {
  return {
    async get(keys: string | string[] | Record<string, any> | null) {
      const all = (await bapi.storage.local.get(null)) || {};
      const out: Record<string, any> = {};
      for (const k of Object.keys(all)) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = all[k];
      }
      if (keys == null) return out;
      if (typeof keys === 'string') return keys in out ? { [keys]: out[keys] } : {};
      if (Array.isArray(keys)) {
        const o: Record<string, any> = {};
        for (const k of keys) if (k in out) o[k] = out[k];
        return o;
      }
      const o: Record<string, any> = {};
      for (const k of Object.keys(keys)) o[k] = k in out ? out[k] : (keys as any)[k];
      return o;
    },
    async set(items: Record<string, any>) {
      const mapped: Record<string, any> = {};
      for (const k of Object.keys(items)) mapped[prefix + k] = items[k];
      await bapi.storage.local.set(mapped);
    },
    async remove(keys: string | string[]) {
      const arr = Array.isArray(keys) ? keys : [keys];
      await bapi.storage.local.remove(arr.map((k) => prefix + k));
    },
  };
}

export const storage = {
  local: areaOf('local'),
  session: areaOf('session'),
  sync: areaOf('sync'),

  /** Subscribe to storage changes for a given area. Returns an unsubscribe fn. */
  onChanged(area: Area, cb: (changes: Changes, ns: string) => void): () => void {
    const listener = (changes: Changes, ns: string) => {
      if (area === 'session' && !capabilities.storageSession) {
        if (ns !== 'local') return;
        const filtered: Changes = {};
        for (const k of Object.keys(changes)) {
          if (k.startsWith('session:')) {
            filtered[k.slice(8)] = changes[k];
          }
        }
        if (Object.keys(filtered).length) cb(filtered, 'session');
        return;
      }
      if (ns !== area) return;
      cb(changes, ns);
    };
    bapi.storage.onChanged.addListener(listener);
    return () => bapi.storage.onChanged.removeListener(listener);
  },
};

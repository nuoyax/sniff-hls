// Unified browser API access + storage shim.
// WXT provides `browser` via `webext-polyfill`; we re-export it and add
// a small storage abstraction that hides the storage.session absence on
// older Firefox builds (falls back to prefixed storage.local).
import { capabilities } from './featureDetect';

declare const browser: any;
declare const chrome: any;

/**
 * Resolve the WebExtension API object.
 * Prefer whichever global actually exposes `storage.local` — a partial
 * `browser` global (runtime only) would otherwise crash on `storage.local`.
 */
export function getBrowser(): any {
  const g = globalThis as any;
  const candidates = [g.chrome, g.browser, typeof chrome !== 'undefined' ? chrome : null, typeof browser !== 'undefined' ? browser : null].filter(
    (x) => x && typeof x === 'object',
  );

  for (const api of candidates) {
    if (api.storage?.local) return api;
  }
  for (const api of candidates) {
    if (api.runtime?.id) return api;
  }
  if (candidates[0]) return candidates[0];
  throw new Error('No WebExtension runtime');
}

/** Lazy API handle — always re-check so a partial first resolve can recover. */
export const bapi: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const api = getBrowser();
      const val = api[prop as string];
      return typeof val === 'function' ? val.bind(api) : val;
    },
  },
);

type Area = 'local' | 'session' | 'sync';
type Changes = Record<string, { oldValue?: any; newValue?: any }>;

function areaOf(area: Area): any {
  const api = getBrowser();
  if (area === 'session' && !capabilities.storageSession) {
    // Emulate session with a local namespace.
    return wrapLocalNamespace('session:');
  }
  const store = api.storage?.[area];
  if (!store) {
    throw new Error(
      `storage.${area} is unavailable. Reload the extension and ensure the "storage" permission is granted.`,
    );
  }
  return store;
}

function wrapLocalNamespace(prefix: string) {
  return {
    async get(keys: string | string[] | Record<string, any> | null) {
      const all = (await getBrowser().storage.local.get(null)) || {};
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
      await getBrowser().storage.local.set(mapped);
    },
    async remove(keys: string | string[]) {
      const arr = Array.isArray(keys) ? keys : [keys];
      await getBrowser().storage.local.remove(arr.map((k) => prefix + k));
    },
  };
}

export const storage = {
  // Lazy getters — never touch storage at module-eval time (SW / UI race).
  get local() {
    return areaOf('local');
  },
  get session() {
    return areaOf('session');
  },
  get sync() {
    return areaOf('sync');
  },

  /** Subscribe to storage changes for a given area. Returns an unsubscribe fn. */
  onChanged(area: Area, cb: (changes: Changes, ns: string) => void): () => void {
    const api = getBrowser();
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
    api.storage.onChanged.addListener(listener);
    return () => api.storage.onChanged.removeListener(listener);
  },
};

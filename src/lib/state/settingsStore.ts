// Persisted user settings, validated with zod, with migration support.
import { z } from 'zod';
import { storage } from '../platform/browser';
import type { OutputFormat } from '../types';
import type { ProxyConfig as ProxyCfg } from '../platform/proxyShim';

export const SettingsSchema = z.object({
  schemaVersion: z.number().default(1),
  autoDetect: z.boolean().default(true),
  domScan: z.boolean().default(true),
  format: z.enum(['mp4', 'ts', 'auto']).default('auto'),
  concurrency: z.number().int().min(1).max(20).default(8),
  defaultQuality: z.enum(['highest', 'lowest']).default('highest'),
  subfolder: z.string().default('m3u8-extra'),
  proxy: z
    .object({
      mode: z.string().default('none'),
      host: z.string().optional(),
      port: z.number().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .default({ mode: 'none' }),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  notifyOnComplete: z.boolean().default(true),
  telemetry: z.boolean().default(false),
  debug: z.boolean().default(false),
  historyCap: z.number().int().min(0).max(5000).default(500),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

const KEY = 'settings';

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const res = await storage.local.get(KEY);
  const raw = res[KEY] || {};
  // merge with defaults so new fields are present after upgrade
  const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...raw });
  cache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
  return cache!;
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch, schemaVersion: cur.schemaVersion };
  const parsed = SettingsSchema.parse(next);
  cache = parsed;
  await storage.local.set({ [KEY]: parsed });
  return parsed;
}

export function subscribeSettings(cb: (s: Settings) => void): () => void {
  return storage.onChanged('local', (changes) => {
    if (changes[KEY]?.newValue) {
      cache = changes[KEY].newValue as Settings;
      cb(cache);
    }
  });
}

export function proxyConfigFromSettings(s: Settings): ProxyCfg {
  return s.proxy as ProxyCfg;
}

export type { OutputFormat };

// When master playlist detected, probe variant qualities for the popup UI.
import { fetchText } from '../engine/fetcher';
import { parsePlaylist, pickBestVariant } from '../engine/m3u8Parser';
import type { VariantInfo } from '../types';
import log from '../log';

export async function probeVariants(masterUrl: string): Promise<VariantInfo[]> {
  try {
    const text = await fetchText(masterUrl, { timeoutMs: 15_000 });
    const pl = parsePlaylist(text, masterUrl);
    if (!pl.isMaster) {
      // It's a media playlist; expose a single "variant" so UI can show a row.
      return [{ url: masterUrl, bandwidth: 0 }];
    }
    return pl.variants.slice().sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0));
  } catch (e) {
    log.warn('variant probe failed', masterUrl, e);
    return [];
  }
}

export { pickBestVariant };

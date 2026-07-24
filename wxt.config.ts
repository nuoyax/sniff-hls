import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
// The `manifest` field can be an object or a function (env) => manifest where
// env.browser lets us branch per target (chrome/edge/firefox/safari).
export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
    sizes: [16, 32, 48, 128],
  },
  manifest: (env) => {
    const isFirefox = env.browser === 'firefox';
    const isChromium = env.browser === 'chrome' || env.browser === 'edge';
    const isSafari = env.browser === 'safari';

    const permissions = [
      'storage',
      'webRequest',
      'downloads',
      'alarms',
      'notifications',
      'scripting',
      'tabs',
    ];
    // chrome.offscreen exists on Chromium 109+/Edge; absent on Firefox/Safari.
    if (isChromium) permissions.push('offscreen');

    const manifest: Record<string, unknown> = {
      name: 'Sniffls',
      description:
        'Detect and download m3u8 (HLS) video as MP4. Network + DOM sniffing, concurrent fetch, AES-128 decrypt, MP4 with .ts fallback.',
      version: '0.1.0',
      permissions,
      host_permissions: ['<all_urls>'],
      optional_permissions: ['proxy'],
      // Background SW type:module only applies to Chromium MV3.
      background: isChromium
        ? { service_worker: 'background.js', type: 'module' }
        : { scripts: ['background.js'] },
    };

    if (isChromium) {
      manifest.minimum_chrome_version = '109';
    }

    if (isFirefox) {
      manifest.browser_specific_settings = {
        gecko: {
          id: 'sniff-hls@local.wxt',
          strict_min_version: '115.0',
        },
      };
    }

    // Safari has no offscreen and no proxy; uses the hidden-page engine host.
    // No additional manifest fields needed beyond the shared set.
    if (isSafari) {
      // Safari rejects optional_permissions it doesn't understand; proxy is
      // unsupported, so drop it.
      manifest.optional_permissions = [];
    }

    return manifest;
  },
  vite: () => ({
    plugins: [],
  }),
});

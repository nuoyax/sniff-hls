# m3u8 Extra

> 🌐 [简体中文](./README.zh-CN.md) &nbsp;|&nbsp; English

<!-- Replace {repo} below with your GitHub repo URL, e.g. https://github.com/user/m3u8_extra -->

[![GitHub stars](https://img.shields.io/badge/⭐-Star_on_GitHub-4f46e5?style=for-the-badge)]({repo}/stargazers)
[![Donate with PayPal](https://img.shields.io/badge/💛-Donate_with_PayPal-0070ba?style=for-the-badge)](https://paypal.me/halo651891)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](#-license)

A cross-browser extension that **auto-detects m3u8 (HLS) streams** on any page and **downloads them as MP4** — directly into your browser's download list. No desktop app, no ffmpeg, no external tools.

Built with **WXT + React + TypeScript + Tailwind**. One codebase → **Chrome / Edge / Firefox / Safari** (Manifest V3).

> 💖 **Found it useful?** Give it a ⭐ on GitHub, or [buy the author a coffee via PayPal](https://paypal.me/halo651891) — every cup keeps the project brewing. ☕

---

## ✨ Features

- **Auto-detect** m3u8 on every page via network sniffing (`webRequest`) + on-demand DOM scan.
- **Download as MP4** — transmuxes `.ts` segments to fMP4 with `mux.js` (no re-encode, fast). **Automatic `.ts` fallback** when a stream is encrypted with an unsupported cipher or uses an unusual codec.
- **AES-128 decryption** via WebCrypto (explicit IV or sequence-derived, per RFC 8216).
- **Quality picker** — lists every rendition from a master playlist; defaults to highest bandwidth.
- **Concurrent segment fetcher** with retry + exponential backoff (configurable 1–20).
- **Download manager** with live progress, history, retry, and clear.
- **Badge counter** on the toolbar icon showing detected streams for the current tab.
- **Proxy support** for restricted networks — per-extension proxy override.
- **Cross-browser** — Chrome, Edge, Firefox, Safari.
- **Privacy-first** — telemetry OFF by default; URLs, page titles, and file contents never leave your browser.

---

## 🧠 How it works

![Architecture](docs/images/architecture.svg)

### Detection → Download flow

![Detection and download flow](docs/images/flow.svg)

<details>
<summary>ASCII version of the architecture diagram</summary>

```
┌──────────────────────────────────────────────────────────────┐
│  UI layer (React + Tailwind, WXT entrypoints)                  │
│  popup · options · download-manager · content script           │
└───────────▲───────────────────────────────────┬──────────────┘
            │ runtime messaging                  │ storage
┌───────────┴───────────────────────────────────▼──────────────┐
│  State layer  (session · settings · history stores)          │
└───────────▲───────────────────────────────────┬──────────────┘
            │                                     │
┌───────────┴────────────┐           ┌────────────▼───────────────┐
│  Detection layer (SW)   │           │  Download engine (DOM host) │
│  webRequest observer    │──detect──▶│  playlist fetcher + parser  │
│  DOM scanner (content)  │           │  segment pool (concurrent)  │
│  master quality probe   │           │  AES-128 decrypt (WebCrypto)│
└─────────────────────────┘           │  mux.js transmuxer (TS→fMP4) │
                                      │  blob assembler (+ts fallback)│
                                      └─────────────┬───────────────┘
                                                    │ blob URL
                                      ┌─────────────▼───────────────┐
                                      │  chrome.downloads.download   │
                                      └─────────────────────────────┘
        ┌──────────────────────────────────────────────────────────┐
        │  Cross-browser platform shim (offscreen vs extension page) │
        └──────────────────────────────────────────────────────────┘
```

</details>

### Why this architecture is fast
- **The MV3 service worker stays thin.** All heavy work (fetch pool, decrypt, transmux, Blob assembly) runs in a long-lived DOM context — a `chrome.offscreen` document on Chromium, a hidden extension page on Firefox/Safari — that survives the SW's 30s idle recycle. Downloads can run for minutes without SW involvement.
- **SW death is non-fatal.** Per-segment progress is checkpointed to `storage.session`; on SW wake it re-attaches to the running host.
- **Streaming transmux.** Segments are fed to `mux.js` one at a time as they arrive in order; no full rebuffer.
- **Bounded concurrency + backpressure.** A configurable pool fetches segments concurrently but emits them in playlist order; a byte budget prevents runaway memory on huge playlists.
- **One engine, two hosts.** Engine code depends only on `fetch` / `crypto.subtle` / `Blob` / `URL`; host selection is a one-line feature-detect.

---

## 🌍 Supported browsers

| Browser | Support | Engine host |
|---|---|---|
| Chrome 109+ | ✅ Full | `chrome.offscreen` document |
| Edge 109+ | ✅ Full | `chrome.offscreen` document |
| Firefox 115+ | ✅ Full | Hidden extension page (no offscreen API) |
| Safari 16+ | ⚠️ Best-effort | Hidden extension page (no offscreen/proxy) |

---

## 📦 Installation (offline / unpacked)

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ and npm (or pnpm/yarn).

### Build
```bash
git clone <your-repo-url> m3u8_extra
cd m3u8_extra
npm install
npm run build            # Chrome/Edge (Chromium MV3)
npm run build:firefox    # Firefox
npm run build:safari     # Safari (requires Xcode to package)
```
Build output lands in `.output/`:
- `.output/chrome-mv3/` — Chrome & Edge
- `.output/firefox-mv3/` — Firefox
- `.output/safari-mv3/` — Safari

---

### Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the `.output/chrome-mv3/` folder.
6. The m3u8 Extra icon appears in the toolbar. Pin it for easy access.

### Microsoft Edge

1. Run `npm run build` (same Chromium build as Chrome).
2. Open `edge://extensions`.
3. Toggle **Developer mode** (left sidebar).
4. Click **Load unpacked**.
5. Select the `.output/chrome-mv3/` folder.

### Firefox

> ⚠️ Temporary add-ons are removed when Firefox closes. For a permanent install, sign via [addons.mozilla.org](https://addons.mozilla.org/developers/) or use Firefox Developer/ESR edition with signed loading.

1. Run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select the file `.output/firefox-mv3/manifest.json`.
5. The extension loads immediately and survives until you restart Firefox.

To package a distributable `.xpi`:
```bash
npm run zip:firefox
# → .output/firefox-mv3.zip
```

### Safari

Safari App Extensions require Xcode. The WXT Safari build produces sources you wrap in an Xcode project:

1. Run `npm run build:safari`.
2. Open Xcode → create a **Safari Web Extension** target wrapping `.output/safari-mv3/`.
3. Build & run → enable the extension under **Safari → Settings → Extensions**.
4. Allow it in **Develop → [your extension]**.

> Safari limitations in MVP: no proxy support, no `offscreen` (uses the hidden-page host).

---

## 🚀 Usage

1. **Open a page** that plays HLS video. The toolbar badge shows the number of detected m3u8 streams.
2. **Click the m3u8 Extra icon.** The popup lists every detected stream with its quality renditions.
3. **Pick a quality** (if multiple) and click **Download**.
4. Watch progress in the popup, or open the **Download Manager** (toolbar icon → list icon) for live progress and history.
5. The file lands in your **browser's native download list**.

### Popup

![Popup preview — detected streams, quality picker, live download progress](docs/images/popup-preview.svg)

### Settings

![Options preview — detection, downloads, proxy](docs/images/options-preview.svg)

### Settings (Options page)
- **Auto-detect** on/off (network sniffing)
- **DOM scan** on/off (on-demand page scan)
- **Output format**: Auto (MP4 → TS fallback) / Always MP4 / Always TS
- **Concurrency**: 1–20 parallel segment fetches
- **Default quality**: highest / lowest bandwidth
- **Download subfolder**
- **Proxy**: HTTP / HTTPS / SOCKS5
- **Notifications**, **telemetry**, **debug logging**

---

## 🔐 Permissions explained

| Permission | Why |
|---|---|
| `webRequest` + `host_permissions: <all_urls>` | Sniff m3u8 network requests on any site; fetch segments cross-origin without CORS. |
| `storage` | Persist settings, history; `storage.session` for ephemeral per-tab detections. |
| `downloads` | Hand the final file to your browser's download list. |
| `offscreen` (Chromium only) | Host the download engine in a DOM context (Blob/URL.createObjectURL). |
| `scripting` + `tabs` | On-demand DOM scan; read the active tab's URL for naming. |
| `notifications` | Optional completion/error notifications. |
| `proxy` (optional) | Per-extension proxy override for restricted networks. |

> The `<all_urls>` permission triggers a "read and change all your data" prompt. This is unavoidable for the core feature (sniffing + downloading m3u8 from any site). The extension **never uploads** page data anywhere — see [Privacy](#-privacy).

---

## 🔒 Privacy

- **Telemetry is OFF by default.** Even when enabled, only anonymous feature-usage counters are collected — never URLs, page titles, or file contents.
- All detection and downloading happens locally in your browser. No data leaves your machine except the m3u8 segments you choose to download (fetched directly from the originating CDN).
- DRM-encrypted streams (Widevine/FairPlay/PlayReady, SAMPLE-AES) are **not** circumvented; they fall back to raw `.ts` when decryption is unsupported, or fail gracefully.

---

## ⚠️ Limitations

- **VOD only** in this MVP — live stream recording is planned.
- DRM-encrypted streams cannot be decrypted; they fall back to raw `.ts` or fail with a clear message.
- Safari: no proxy support; uses the hidden-page engine host.

---

## 🛠️ Development

```bash
npm install
npm run dev            # Chrome, hot-reload via WXT
npm run dev:firefox    # Firefox dev
npm test               # run engine unit tests (vitest)
npm run typecheck      # tsc --noEmit
npm run build          # production build (Chrome/Edge)
npm run zip            # package .zip for distribution
```

### Project structure
```
src/
├─ entrypoints/        # WXT entrypoints
│  ├─ background.ts        # SW: detection, routing, badge, job dispatch
│  ├─ popup/               # detected-streams popup UI
│  ├─ options/             # settings UI
│  ├─ download-manager/    # live + history UI
│  ├─ offscreen/           # Chromium engine host (offscreen doc)
│  ├─ download-runner/     # Firefox/Safari engine host (hidden page)
│  └─ content.ts           # on-demand DOM scanner
├─ lib/
│  ├─ detection/           # webRequestObserver, urlNormalizer, qualityProbe, badge
│  ├─ state/               # sessionStore, settingsStore, historyStore
│  ├─ engine/              # engine, m3u8Parser, segmentPool, aesDecryptor,
│  │                       # transmuxer, blobAssembler, hostManager, hostRuntime
│  ├─ platform/            # browser shim, featureDetect, downloadsShim, proxyShim, messaging
│  └─ types, errors, log
├─ components/         # React UI (Stich-style design system)
└─ assets/styles.css   # Tailwind + design tokens
tests/                 # engine + parser unit tests
```

---

## 🧪 Testing

Engine internals are unit-tested with Vitest:
- `tests/m3u8Parser.test.ts` — master/media playlists, AES-128 keys, byteranges, init segments.
- `tests/urlNormalizer.test.ts` — m3u8 detection, URL normalization, filename derivation.
- `tests/aesDecryptor.test.ts` — IV derivation, decryptor passthrough/error paths.

```bash
npm test
```

---

## 📄 License

MIT © m3u8 Extra contributors.

> ⚠️ Use responsibly. Only download content you have the right to access. Respect copyright and the terms of service of the websites you visit.

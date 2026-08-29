<p align="center">
  <img src="docs/images/logo.svg" alt="Sniffls" width="420" />
</p>

<h1 align="center">Sniffls</h1>

<p align="center">
  🌐 <a href="./README.zh-CN.md">简体中文</a> &nbsp;|&nbsp; English<br/>
  A cross-browser extension that <b>auto-detects m3u8 (HLS) streams</b> and <b>downloads them as MP4</b> — straight into your browser's download list. No desktop app, no ffmpeg, no external tools.
</p>

<p align="center">
  Built with <b>WXT + React + TypeScript + Tailwind</b>. One codebase → <b>Chrome / Edge / Firefox / Safari</b> (Manifest V3).
</p>

<p align="center">
<!-- Replace {repo} below with your GitHub repo URL, e.g. https://github.com/user/sniff-hls -->
  <a href="{repo}/stargazers"><img alt="GitHub stars" src="https://img.shields.io/badge/⭐-Star_on_GitHub-4f46e5?style=for-the-badge"></a>
  <a href="https://paypal.me/halo651891"><img alt="Donate with PayPal" src="https://img.shields.io/badge/Donate_with_PayPal-0070ba?style=for-the-badge&logo=paypal&logoColor=white"></a>
  <a href="#-license"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge"></a>
</p>

<p align="center">
  💖 Found it useful? Give it a ⭐ on GitHub, or <a href="https://paypal.me/halo651891">buy the author a coffee via PayPal</a> — every cup keeps the project brewing. ☕
</p>

---

## ✨ Features

- **Auto-detect** m3u8 on every page via network sniffing (`webRequest`) + on-demand DOM scan — including wrapper URLs that bury the real playlist in a `?url=` query.
- **Download as MP4** — transmuxes classic `.ts` HLS to fMP4 with `mux.js` (no re-encode). **CMAF/fMP4** playlists (`#EXT-X-MAP`) concat init + media; demuxed audio (`#EXT-X-MEDIA` + `AUDIO=`) is remuxed with [mediabunny](https://mediabunny.dev/). Automatic `.ts` fallback for classic TS when an unsupported cipher or unusual codec is used.
- **X (Twitter) videos** — amplify HLS on `video.twimg.com` (separate video/audio CMAF playlists) downloads as a single playable MP4 with audio. Open a post that plays video, wait for the badge, then download from the popup (pick quality if offered). If the CDN is blocked in your region, enable a proxy in Options or use the system/browser proxy.
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
        │  Cross-browser platform shim (downloads / proxy / storage) │
        └──────────────────────────────────────────────────────────┘
```

</details>

### Why this architecture is fast
- **The MV3 service worker stays thin.** All heavy work (fetch pool, decrypt, transmux, Blob assembly, and `chrome.downloads`) runs in a long-lived **hidden extension page** (`download-runner.html`) on every browser. Chromium's `chrome.offscreen` documents cannot call `chrome.downloads`, so they are not used as the download host. The runner survives the SW's 30s idle recycle; downloads can run for minutes without SW involvement.
- **SW death is non-fatal.** The SW talks to the runner over a persistent Port; per-segment progress is also checkpointed to `storage.session`. On wake the SW re-attaches to the running host.
- **Streaming transmux.** Segments are fed to `mux.js` one at a time as they arrive in order; no full rebuffer.
- **Bounded concurrency + backpressure.** A configurable pool fetches segments concurrently but emits them in playlist order; a byte budget prevents runaway memory on huge playlists.
- **One engine, one host.** Engine code depends only on `fetch` / `crypto.subtle` / `Blob` / `URL` / downloads; the same runner page is used on Chrome, Edge, Firefox, and Safari.

---

## 🌍 Supported browsers

| Browser | Support | Engine host |
|---|---|---|
| Chrome 109+ | ✅ Full | Hidden extension page (`download-runner`) |
| Edge 109+ | ✅ Full | Hidden extension page (`download-runner`) |
| Firefox 115+ | ✅ Full | Hidden extension page (`download-runner`) |
| Safari 16+ | ⚠️ Best-effort | Hidden extension page (no proxy API) |

---

## 📦 Installation (offline / unpacked)

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ and npm (or pnpm/yarn).

### Build
```bash
git clone <your-repo-url> sniff-hls
cd sniff-hls
npm install
npm run build            # Chrome/Edge (Chromium MV3)
npm run build:firefox    # Firefox
npm run build:safari     # Safari (requires Xcode to package)
```
Build output lands in `.output/`:
- `.output/chrome-mv3/` — Chrome & Edge
- `.output/firefox-mv3/` — Firefox
- `.output/safari-mv3/` — Safari

> 💡 Prefer a visual guide? Open **[`docs/install.html`](docs/install.html)** — a single-page tabbed installer (Chrome / Edge / Firefox / Safari) with copy-to-clipboard commands and per-browser load steps.

---

### Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the `.output/chrome-mv3/` folder.
6. The Sniffls icon appears in the toolbar. Pin it for easy access.

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

> Safari limitations in MVP: no proxy support (uses the same hidden-page download host as other browsers).

---

## 🚀 Usage

1. **Open a page** that plays HLS video. The toolbar badge shows the number of detected m3u8 streams.
2. **Click the Sniffls icon.** The popup lists every detected stream with its quality renditions.
3. **Pick a quality** (if multiple) and click **Download**.
4. Watch progress in the popup, or open the **Download Manager** (toolbar icon → list icon) for live progress and history.
5. The file lands in your **browser's native download list**.

> **Tip — X (Twitter):** play the video on x.com / twitter.com first so the amplify m3u8 is requested; Sniffls sniffs `video.twimg.com`. Then download from the popup.

### Popup

![Popup preview — detected streams, quality picker, live download progress](docs/images/popup-preview.svg)

### Download Manager

![Manager preview — history list with status, live progress, pagination](docs/images/manager-preview.svg)

### Settings

![Options preview — detection, downloads, proxy](docs/images/options-preview.svg)

### Settings (Options page)
- **Auto-detect** on/off (network sniffing)
- **DOM scan** on/off (on-demand page scan)
- **Output format**: Auto (MP4 → TS fallback) / Always MP4 / Always TS
- **Concurrency**: 1–20 parallel segment fetches
- **Default quality**: highest / lowest bandwidth
- **Download directory**: absolute path (e.g. `D:\Videos`) with folder picker
- **Proxy**: HTTP / HTTPS / SOCKS5 (applied via Save, persisted across restarts)
- **Save / Reset to defaults** bar — edits stay in a draft until saved
- **Language**: header switch (English / 简体中文, default English)
- **Notifications**, **usage statistics**, **debug logging**

---

## 🔐 Permissions explained

| Permission | Why |
|---|---|
| `webRequest` + `host_permissions: <all_urls>` | Sniff m3u8 network requests on any site; fetch segments cross-origin without CORS. |
| `storage` | Persist settings, history; `storage.session` for ephemeral per-tab detections. |
| `downloads` | Hand the final file to your browser's download list (called from the runner page). |
| `offscreen` (Chromium only) | Declared for Chromium compatibility; the download engine itself runs in `download-runner` because offscreen documents cannot use `chrome.downloads`. |
| `scripting` + `tabs` | On-demand DOM scan; read the active tab's URL for naming. |
| `notifications` | Optional completion/error notifications. |
| `proxy` (Chrome / Edge / Firefox) | Per-extension proxy override for restricted networks. Required permission on MV3 (Chrome omits `proxy` if listed only under `optional_permissions`). |

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
- Safari: no proxy support; same hidden-page engine host as other browsers.
- **X (Twitter):** works for public amplify HLS (CMAF). Private/protected media, DRM, or CDN blocks still fail — use proxy if `video.twimg.com` is unreachable. Live Spaces / non-HLS players are out of scope.

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
│  ├─ download-runner/     # download engine host (hidden page, all browsers)
│  ├─ offscreen/           # Chromium offscreen entry (not the download host)
│  └─ content.ts           # on-demand DOM scanner
├─ lib/
│  ├─ detection/           # webRequestObserver, urlNormalizer, qualityProbe, badge
│  ├─ state/               # sessionStore, settingsStore, historyStore
│  ├─ engine/              # engine, m3u8Parser, segmentPool, aesDecryptor,
│  │                       # transmuxer, blobAssembler, fmp4Merge (mediabunny),
│  │                       # containerDetect, hostManager, hostProtocol, hostRuntime
│  ├─ platform/            # browser shim, featureDetect, downloadsShim, proxyShim, messaging
│  └─ types, errors, log
├─ components/         # React UI (Stich-style design system)
└─ assets/styles.css   # Tailwind + design tokens
tests/                 # engine + parser unit tests
```

---

## 🧪 Testing

Engine internals are unit-tested with Vitest:
- `tests/m3u8Parser.test.ts` — master/media playlists, AES-128 keys, byteranges, init segments, demuxed AUDIO groups.
- `tests/urlNormalizer.test.ts` — m3u8 detection, wrapper `?url=` unwrap, URL normalization, filename derivation.
- `tests/containerDetect.test.ts` — MPEG-TS vs fMP4/CMAF detection.
- `tests/aesDecryptor.test.ts` — IV derivation, decryptor passthrough/error paths.

```bash
npm test
```

---

## 📜 Changelog

### 0.2.0 (2026-08-29)
- **New UI language system** — English / 简体中文 with a header language switch (right-click to follow browser); UI defaults to English.
- **Settings rework** — explicit Save / Reset-to-defaults bar; all options persist across browser restarts; applied proxy config now survives service-worker restarts.
- **Download directory** — replaces the old subfolder setting; accepts absolute paths (e.g. `D:\Videos`) with a folder picker.
- **Download manager** — shared page header, paginated history (20 per page), settings shortcut.
- **Popup** — settings now open in a new tab; breathing-halo empty state.
- **i18n infra** — zod-validated `locale` setting (`auto` / `en` / `zh-CN`) with unit tests.

---

## 📄 License

MIT © [contributors](https://github.com/nuoyax/sniff-hls/graphs/contributors).

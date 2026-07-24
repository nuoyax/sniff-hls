# Release Process

Sniffls uses tag-driven releases. Pushing a version tag triggers GitHub Actions to build all browser targets, zip them, and publish them to a GitHub Release.

## Prerequisites

- The repo is pushed to GitHub (a `{repo}` placeholder in the README star badge should be replaced with the real URL — see [README](./README.md)).
- GitHub Actions are enabled for the repo (on by default for public repos).

## Cutting a release

```bash
# 1. Make sure you're on a clean working tree at the commit you want to release.
git status

# 2. Bump the version. npm runs the `version` script, which calls
#    scripts/sync-version.js to keep README install refs in sync, then
#    stages README.md, README.zh-CN.md, package.json.
npm version patch   # 0.1.0 -> 0.1.1
# or: npm version minor   # 0.1.0 -> 0.2.0
# or: npm version major   # 0.1.0 -> 1.0.0

# 3. Push the commit and the tag.
git push --follow-tags
```

Pushing the `v*` tag triggers `.github/workflows/release.yml`.

## What the release workflow does

1. Checks out with full history (to compute a changelog since the previous tag).
2. `npm ci` → installs exact deps.
3. `npm test` → runs the vitest suite.
4. Reads `package.json` version.
5. Builds **all four targets**: chrome, edge, firefox, safari.
6. Zips **chrome** and **firefox** (the two with distinct manifests worth shipping as distinct artifacts). The Edge build is byte-identical to Chrome (both Chromium MV3), so the workflow copies the chrome zip to an edge-named zip for discoverability.
7. Generates release notes: header with version, a `git log` bullet list since the last tag, and an install table pointing at the attached zips.
8. Creates a **GitHub Release** (not draft) with the three zips attached, using [`softprops/action-gh-release`](https://github.com/softprops/action-gh-release).
   - A version containing a `-` (e.g. `0.2.0-beta.1`) is marked **prerelease**.

## Artifacts attached to each release

| Browser | File | Install |
|---|---|---|
| Chrome | `sniff-hls-<ver>-chrome.zip` | unzip → `chrome://extensions` → load unpacked |
| Edge | `sniff-hls-<ver>-edge.zip` | unzip → `edge://extensions` → load unpacked |
| Firefox | `sniff-hls-<ver>-firefox.zip` | `about:debugging` → load temporary add-on (select the unzipped `manifest.json`) |
| Safari | (build from source with Xcode) | `npm run build:safari`, wrap in a Safari Web Extension target |

## CI (non-release)

`.github/workflows/ci.yml` runs on every push to `master`/`main` and every PR:
typecheck → test → build chrome + firefox → upload the build output as a
workflow artifact (7-day retention) for inspection.

## Notes

- The `version` npm script modifies the READMEs; if you bump the version without `npm version` (e.g. editing `package.json` by hand), run `node scripts/sync-version.js` and commit the result.
- Firefox permanent distribution requires AMO signing; the release zip is unsigned (temporary install). Documented in the README.

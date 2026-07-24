// Sync the package version into the README "install" download snippets so the
// release notes / install instructions always cite the current version.
// Runs on `npm version` (the "version" lifecycle script) before the commit.
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version;

function patch(file, fromRe, replacement) {
  let src = readFileSync(file, 'utf8');
  const next = src.replace(fromRe, replacement);
  if (next !== src) writeFileSync(file, next, 'utf8');
}

// Example inline version refs in README install blocks (if any), plus a
// badge-style shield. We keep this conservative — only swap a version token
// when present, never insert new content.
const badgeRe = /!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-[^)]*\)/g;
const badgeNext = `![Version](https://img.shields.io/badge/version-${version}-4f46e5)`;

for (const f of ['README.md', 'README.zh-CN.md']) {
  try {
    patch(f, /sniff-hls-\d+\.\d+\.\d+/g, `sniff-hls-${version}`);
    // Only add a version badge if one already exists (idempotent).
    patch(f, badgeRe, badgeNext);
  } catch {
    /* file may be missing in some checkouts */
  }
}

console.log(`synced version ${version} into READMEs`);

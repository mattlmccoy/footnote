#!/usr/bin/env node
// Generate the per-reviewer HTML shells from footnote.config.json, replacing the hand-committed
// CCS.html / CJS.html / review-lab.html. Each named advisor gets an <id>.html shell that hardcodes
// window.ADVISOR; a single shared "general" reviewer gets review-lab.html. The generic advisor.html
// (URL-param driven) is committed separately and NOT generated here.
//
// Usage: node scripts/gen-shells.mjs   (reads ./footnote.config.json, writes shells into repo root)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeConfig, advisorShellConfig } from '../js/config.js';

// Pure: the HTML for one reviewer shell. Named shells omit `shared`; the shared lab shell keeps it.
export function shellHtml(advisor, cfg) {
  const adv = advisor.shared
    ? { id: advisor.id, name: advisor.name, shared: true }
    : { id: advisor.id, name: advisor.name };
  const title = (cfg.brand && cfg.brand.name) || 'Footnote';
  const logo = (cfg.brand && cfg.brand.logo) || 'brand/footnote-mark.png';
  const favicon = logo.replace(/\.png$/, '.svg');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.7.0/dist/tabler-icons.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<link rel="stylesheet" href="./css/reader.css">
</head>
<body>
<div class="app">
  <header class="topbar" id="topbar"></header>
  <div class="panes">
    <nav class="nav" id="nav"></nav>
    <section class="read" id="read"></section>
    <aside class="comments" id="comments"></aside>
  </div>
</div>
<script>window.ADVISOR = ${JSON.stringify(adv)};</script>
<script type="module" src="./js/advisor.js"></script>
</body>
</html>
`;
}

// The shared lab shell keeps its historical filename; named shells are <id>.html.
export function shellFilename(advisor) {
  return advisor.shared ? 'review-lab.html' : `${advisor.id}.html`;
}

// Every shell {filename, html} for a config.
export function shellsForConfig(cfg) {
  return advisorShellConfig(cfg).map(a => ({ filename: shellFilename(a), html: shellHtml(a, cfg) }));
}

// CLI: read config, write shells into the repo root.
function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const cfg = normalizeConfig(JSON.parse(readFileSync(join(root, 'footnote.config.json'), 'utf8')));
  for (const { filename, html } of shellsForConfig(cfg)) {
    writeFileSync(join(root, filename), html);
    console.log(`wrote ${filename}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

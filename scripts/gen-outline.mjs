#!/usr/bin/env node
// Regenerate the "Proposed outline" from a LaTeX source directory — a source-true extraction, never a
// hand-kept copy. Reads every .tex under <source-dir>, runs outlineFromFiles (→ parseLatexOutline), and
// writes the nested outline JSON to stdout (or --out <file>). Used by refresh-source AND the dissertation
// outline-sync workflow so an updated main.tex auto-regenerates outline.json. Reuses the SAME parser the
// browser import uses (one source of truth). --prev <outline.json> preserves curated synopses/intro/title.
// --built-from <sha> stamps outline.built_from_commit for provenance (the source commit it was generated from).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { outlineFromFiles, mergeOutlinePrev } from '../js/importdoc.js';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const prevIdx = args.indexOf('--prev');
const prevFile = prevIdx >= 0 ? args[prevIdx + 1] : null;
const bfIdx = args.indexOf('--built-from');
const builtFrom = bfIdx >= 0 ? args[bfIdx + 1] : null;
const optVal = i => [outIdx, prevIdx, bfIdx].some(oi => oi >= 0 && i === oi + 1);
const dir = args.find((a, i) => !a.startsWith('--') && !optVal(i));
if (!dir) { console.error('usage: gen-outline.mjs <source-dir> [--prev outline.json] [--built-from sha] [--out outline.json]'); process.exit(2); }

function walk(d, base, out) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) { if (e !== '.git' && e !== 'node_modules') walk(p, base, out); }
    else if (/\.tex$/i.test(e)) out.push({ path: relative(base, p), isText: true, text: readFileSync(p, 'utf8') });
  }
  return out;
}

const files = walk(dir, dir, []);
const outline = outlineFromFiles(files);
if (!outline || !outline.chapters.length) { console.error(`gen-outline: no chapters found in ${dir}`); process.exit(1); }
if (prevFile) {
  let prev = null;
  try { prev = JSON.parse(readFileSync(prevFile, 'utf8')); }
  catch (e) { console.error(`gen-outline: --prev ${prevFile} unreadable (${e.message}); generating without preservation`); }
  mergeOutlinePrev(outline, prev);
}
if (builtFrom) outline.built_from_commit = builtFrom;   // provenance: the source commit this was generated from
const json = JSON.stringify(outline, null, 2);
if (outFile) { writeFileSync(outFile, json); console.error(`gen-outline: wrote ${outFile} (${outline.chapters.length} chapters)`); }
else process.stdout.write(json + '\n');

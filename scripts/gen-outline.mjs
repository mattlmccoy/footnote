#!/usr/bin/env node
// Regenerate the "Proposed outline" from a LaTeX source directory — a source-true extraction, never a
// hand-kept copy. Reads every .tex under <source-dir>, runs outlineFromFiles (→ parseLatexOutline), and
// writes the nested outline JSON to stdout (or --out <file>). Used by refresh-source so an updated main.tex
// auto-regenerates outline.json. Reuses the SAME parser the browser import uses (one source of truth).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { outlineFromFiles } from '../js/importdoc.js';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const dir = args.find((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
if (!dir) { console.error('usage: gen-outline.mjs <source-dir> [--out outline.json]'); process.exit(2); }

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
const json = JSON.stringify(outline, null, 2);
if (outFile) { writeFileSync(outFile, json); console.error(`gen-outline: wrote ${outFile} (${outline.chapters.length} chapters)`); }
else process.stdout.write(json + '\n');

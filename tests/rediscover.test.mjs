import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rediscoverChapters } from '../js/importdoc.js';

// rediscoverChapters(files, existing): re-run chapter discovery from the CURRENT source and merge it onto
// the stored manifest, id-preserving — the durable fix for chapters.json going stale after import. `files`
// is folderTexIndex-shaped ([{ path, text, isText }]); `existing` is the stored chapters.json list.

const mainTex = [
  '\\documentclass{report}',
  '\\begin{document}',
  '\\include{chapters/ch_intro}',
  '\\include{chapters/ch_methods}',
  '\\appendix',
  '\\input{appendices/appA_data}',      // NEW appendix, not in `existing`
  '\\input{appendices/appB_extra}',     // RENAMED (existing id must be kept)
  '\\end{document}',
].join('\n');

const files = [
  { path: 'main.tex', isText: true, text: mainTex },
  { path: 'chapters/ch_intro.tex', isText: true, text: '\\chapter{Introduction}\nText. \\cref{app:data} here.' },
  { path: 'chapters/ch_methods.tex', isText: true, text: '\\chapter{Methods}\nBody. \\cref{app:extra}' },
  { path: 'appendices/appA_data.tex', isText: true, text: '\\chapter{Raw Data Tables}\\label{app:data}\nrows' },
  { path: 'appendices/appB_extra.tex', isText: true, text: '\\chapter{Extended and Extra Studies}\\label{app:extra}\nmore' },
];

const existing = [
  { id: 'ch_intro', title: 'Introduction', sourceFile: 'chapters/ch_intro.tex', n: 1 },
  { id: 'ch_methods', title: 'Methods', sourceFile: 'chapters/ch_methods.tex', n: 2 },
  // appB was imported earlier under an OLD title; its id must survive the rename so comments stay mapped.
  { id: 'appb-extra', title: 'Extra Studies', sourceFile: 'appendices/appB_extra.tex', kind: 'appendix', n: 1,
    home: 'ch_methods', citedBy: ['ch_methods'] },
];

test('rediscoverChapters preserves existing ids on unchanged-title units', () => {
  const out = rediscoverChapters(files, existing);
  const intro = out.find(u => u.sourceFile === 'chapters/ch_intro.tex');
  assert.equal(intro.id, 'ch_intro');            // NOT the fresh slug 'ch-intro'
  const methods = out.find(u => u.sourceFile === 'chapters/ch_methods.tex');
  assert.equal(methods.id, 'ch_methods');
});

test('rediscoverChapters keeps a renamed unit under its OLD id with the NEW title', () => {
  const out = rediscoverChapters(files, existing);
  const appB = out.find(u => u.sourceFile === 'appendices/appB_extra.tex');
  assert.equal(appB.id, 'appb-extra');                       // id preserved across the rename
  assert.equal(appB.title, 'Extended and Extra Studies');    // title refreshed from source
});

test('rediscoverChapters appends genuinely new units (with computed appendix attachment)', () => {
  const out = rediscoverChapters(files, existing);
  const appA = out.find(u => u.sourceFile === 'appendices/appA_data.tex');
  assert.ok(appA, 'the new appendix is present');
  assert.equal(appA.kind, 'appendix');
  // appA defines app:data; ch_intro \cref's it → home/citedBy computed from source
  assert.equal(appA.home, 'ch_intro');
  assert.deepEqual(appA.citedBy, ['ch_intro']);
});

test('rediscoverChapters returns 4 units total, 2 appendices, no duplicate ids', () => {
  const out = rediscoverChapters(files, existing);
  assert.equal(out.length, 4);
  assert.equal(out.filter(u => u.kind === 'appendix').length, 2);
  const ids = out.map(u => u.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('rediscoverChapters attaches via \\cref that lives in a SUBFILE (inlined include tree)', () => {
  // ch_methods \input's a section file that carries the \cref — attachment must still find it.
  const filesNested = files
    .map(f => f.path === 'chapters/ch_methods.tex'
      ? { ...f, text: '\\chapter{Methods}\nBody. \\input{sections/results}' }
      : f)
    .concat([{ path: 'sections/results.tex', isText: true, text: 'see \\cref{app:extra} for detail' }]);
  const out = rediscoverChapters(filesNested, existing);
  const appB = out.find(u => u.sourceFile === 'appendices/appB_extra.tex');
  assert.deepEqual(appB.citedBy, ['ch_methods']);   // found the cref inside sections/results.tex
});

test('rediscoverChapters never clobbers on an empty/entry-less parse (returns existing)', () => {
  assert.deepEqual(rediscoverChapters([], existing), existing);
  assert.deepEqual(rediscoverChapters([{ path: 'notes.txt', isText: true, text: 'hi' }], existing), existing);
});

import { chaptersChanged, rediscoverChaptersFromRepo } from '../js/importdoc.js';

test('chaptersChanged ignores key order + unrelated fields, detects real diffs', () => {
  const a = [{ id: 'x', title: 'T', kind: 'appendix', n: 1, home: 'ch', citedBy: ['ch'] }];
  const b = [{ n: 1, kind: 'appendix', citedBy: ['ch'], home: 'ch', title: 'T', id: 'x', _extra: 9 }];
  assert.equal(chaptersChanged(a, b), false);                 // same material fields, reordered
  assert.equal(chaptersChanged(a, [{ ...a[0], title: 'T2' }]), true);   // title changed
  assert.equal(chaptersChanged(a, [...a, { id: 'y', title: 'Y' }]), true); // unit added
});

test('rediscoverChaptersFromRepo pulls the .tex tree and re-discovers (injected fetch)', async () => {
  const blobs = {
    'main.tex': '\\include{ch_a}\n\\appendix\n\\input{appA}',
    'ch_a.tex': '\\chapter{Alpha}\n\\cref{app:a}',
    'appA.tex': '\\chapter{Appendix Alpha}\\label{app:a}',
    'notes.md': 'ignored',
  };
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const fetchImpl = async (url) => {
    if (/git\/trees\/main/.test(url)) return { ok: true, json: async () => ({ tree: Object.keys(blobs).map(path => ({ type: 'blob', path })) }) };
    const m = /contents\/([^?]+)/.exec(url); const path = decodeURIComponent(m[1]);
    return { ok: true, json: async () => ({ content: b64(blobs[path]) }) };
  };
  const out = await rediscoverChaptersFromRepo({ sourceRepo: 'o/r', existing: [], token: 't', fetchImpl });
  assert.deepEqual(out.map(u => u.id), ['ch-a', 'appa']);      // only .tex parsed; .md ignored
  const app = out.find(u => u.kind === 'appendix');
  assert.equal(app.home, 'ch-a');                             // attachment computed from pulled source
});

test('rediscoverChaptersFromRepo returns existing when no source repo', async () => {
  const ex = [{ id: 'a', title: 'A' }];
  assert.deepEqual(await rediscoverChaptersFromRepo({ sourceRepo: '', existing: ex, token: 't' }), ex);
});

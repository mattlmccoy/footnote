// tests/figures.test.mjs — Slice 1 of the Figure Review feature (docs/figure-review.md).
// Pure figure-index helpers, DOM-free so they run under `node --test`. The number/label regexes
// mirror the LIVE reader (figTableMaps js/app.js:811, figureLabel js/app.js:860) so a gallery-authored
// figure comment anchors identically to a reader-authored one. Fixtures are shape-faithful pandoc
// fragments (tests/fixtures/figures/*.html); a real-data run is owed per docs/figure-review.md §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  figNumFromCaption, figLabelFromCaption, extractFigures, parseFiguresFromFragment,
  figureRefsInFragment, groupFiguresByChapter, figureAnchor, attachCommentCounts, describeRegion,
} from '../js/figures.js';
import { newReview, addComment } from '../js/model.js';

const fx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/figures/${name}`, import.meta.url)), 'utf8');
const CH3 = fx('ch3.html'), CH4 = fx('ch4.html');

// ---- figNumFromCaption: mirror /^\s*Figure\s+(\d+(?:\.\d+)*)\./ (trailing period REQUIRED) ----
test('figNumFromCaption pulls the dotted number, requires the trailing period', () => {
  assert.equal(figNumFromCaption('Figure 3.1. Finite-element mesh.'), '3.1');
  assert.equal(figNumFromCaption('  Figure 12. A wide shot.'), '12');
  assert.equal(figNumFromCaption('Figure 3 without a period'), null);   // no '.' after number → no match (matches live)
  assert.equal(figNumFromCaption('Table 3.1. Not a figure.'), null);
  assert.equal(figNumFromCaption(''), null);
  assert.equal(figNumFromCaption(null), null);
});

// ---- figLabelFromCaption: mirror figureLabel's /^(Figure|Fig\.?|Table)\s*[\d.]+/i (label used in anchor.quote) ----
test('figLabelFromCaption returns the leading label token, faithful to the live regex', () => {
  assert.equal(figLabelFromCaption('Figure 3.1. Finite-element mesh.'), 'Figure 3.1.'); // [\d.]+ eats the trailing dot, like live
  assert.equal(figLabelFromCaption('Fig. 4. Something'), 'Fig. 4.');  // [\d.]+ eats the trailing dot, faithful to live figureLabel
  assert.equal(figLabelFromCaption('An unnumbered caption'), '');
  assert.equal(figLabelFromCaption(null), '');
});

// ---- extractFigures: raw <figure> blocks → {caption, imgSrc} ----
test('extractFigures pulls each figure block caption + img src, tags stripped', () => {
  const figs = extractFigures(CH3);
  assert.equal(figs.length, 2);
  assert.equal(figs[0].caption, 'Figure 3.1. Finite-element mesh of the build domain.');
  assert.equal(figs[0].imgSrc, 'data:image/png;base64,AAAAmesh_of_the_domain_QQQQ');
  assert.equal(figs[1].caption, 'Figure 3.2. Steady-state temperature field at t = 600 s.');
});

test('extractFigures returns [] when there are no figures / bad input', () => {
  assert.deepEqual(extractFigures('<p>no figures here</p>'), []);
  assert.deepEqual(extractFigures(''), []);
  assert.deepEqual(extractFigures(null), []);
});

// ---- parseFiguresFromFragment: the per-chapter figure rows ----
test('parseFiguresFromFragment builds numbered rows tagged with the chapter id', () => {
  const rows = parseFiguresFromFragment(CH3, 'ch_thermal');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.fignum), ['3.1', '3.2']);
  assert.equal(rows[0].chapterId, 'ch_thermal');
  assert.equal(rows[0].caption, 'Figure 3.1. Finite-element mesh of the build domain.');
  assert.equal(rows[0].imgSrcTail, 'data:image/png;base64,AAAAmesh_of_the_domain_QQQQ'.slice(-40)); // matches anchor.figure key
});

test('parseFiguresFromFragment skips a figure whose caption is unnumbered', () => {
  const html = '<figure><img src="x"><figcaption>An unnumbered decorative figure.</figcaption></figure>';
  assert.deepEqual(parseFiguresFromFragment(html, 'ch1'), []);   // no fignum → not an indexable figure
});

// ---- figureRefsInFragment: "where is Figure N referenced" (excludes the defining caption) ----
test('figureRefsInFragment maps a figure number to the section headings that cite it', () => {
  const refs = figureRefsInFragment(CH3);
  // 3.1 is cited from prose under "Thermal model" and under "Boundary conditions"; NOT counted from its own caption.
  assert.deepEqual(refs['3.1'], ['Thermal model', 'Boundary conditions']);
  assert.deepEqual(refs['3.2'], ['Thermal model', 'Boundary conditions']);
});

test('figureRefsInFragment does not count a figure caption as a reference to itself', () => {
  const html = '<h2>S</h2><figure><img src="x"><figcaption>Figure 1.1. Only defined, never cited.</figcaption></figure>';
  assert.equal(figureRefsInFragment(html)['1.1'], undefined);   // defined but never referenced
});

// ---- groupFiguresByChapter: cross-chapter, reading-order grouping ----
test('groupFiguresByChapter groups figures under each unit in reading order', () => {
  const units = [{ id: 'ch_thermal', n: 3, title: 'Thermal' }, { id: 'ch_val', n: 4, title: 'Validation' }];
  const frags = { ch_thermal: CH3, ch_val: CH4 };
  const groups = groupFiguresByChapter(units, frags);
  assert.deepEqual(groups.map(g => g.chapter.id), ['ch_thermal', 'ch_val']);
  assert.deepEqual(groups[0].figures.map(f => f.fignum), ['3.1', '3.2']);
  assert.deepEqual(groups[1].figures.map(f => f.fignum), ['4.1']);
});

test('groupFiguresByChapter still lists a chapter that has no figures (empty group), and tolerates a missing fragment', () => {
  const units = [{ id: 'ch_empty', n: 1, title: 'Intro' }, { id: 'ch_missing', n: 2, title: 'Gone' }];
  const groups = groupFiguresByChapter(units, { ch_empty: '<p>prose only</p>' });
  assert.deepEqual(groups.map(g => g.chapter.id), ['ch_empty', 'ch_missing']);
  assert.deepEqual(groups[0].figures, []);
  assert.deepEqual(groups[1].figures, []);   // no fragment → empty, not a throw
});

// ---- figureAnchor: MUST match wireFigures' anchor shape (js/app.js:875) for paint parity ----
test('figureAnchor produces the exact anchor shape addComment expects, matching the live reader', () => {
  const fig = { fignum: '3.1', caption: 'Figure 3.1. Finite-element mesh of the build domain.',
                imgSrcTail: 'AAAAmesh_of_the_domain_QQQQ'.slice(-40) };
  const a = figureAnchor(fig, 'Thermal model');
  assert.equal(a.kind, 'figure');
  assert.equal(a.figure, fig.imgSrcTail);          // back-compat key for markFigure painter
  assert.equal(a.fignum, '3.1');                   // new stable-ish key
  assert.equal(a.section, 'Thermal model');
  assert.equal(a.confirmed, true);
  assert.deepEqual(a.rects, []);
  // quote mirrors wireFigures: `${label}${quote?': '+quote:''}` with label from figLabelFromCaption
  assert.equal(a.quote, 'Figure 3.1.: Figure 3.1. Finite-element mesh of the build domain.'.slice(0, 200));
  // and it round-trips through the real model without loss
  const r = addComment(newReview('ch_thermal', ''), { anchor: a, kind: 'figure', tag: 'figure', body: 'log-scale the colorbar' });
  assert.equal(r.comments[0].kind, 'figure');
  assert.equal(r.comments[0].anchor.figure, fig.imgSrcTail);
});

// ---- attachCommentCounts: active figure-comment badge per figure ----
test('attachCommentCounts counts only ACTIVE figure comments, matched by fignum or img tail', () => {
  const figs = [
    { fignum: '3.1', imgSrcTail: 'tail-31' },
    { fignum: '3.2', imgSrcTail: 'tail-32' },
  ];
  const comments = [
    { kind: 'figure', status: 'open',     anchor: { fignum: '3.1' } },
    { kind: 'figure', status: 'open',     anchor: { figure: 'tail-31' } },   // matched by img tail
    { kind: 'figure', status: 'merged',   anchor: { fignum: '3.1' } },       // resolved → not counted
    { kind: 'figure', status: 'open',     anchor: { fignum: '9.9' } },       // no such figure
    { kind: 'text',   status: 'open',     anchor: { quote: 'prose' } },      // not a figure comment
  ];
  const out = attachCommentCounts(figs, comments);
  assert.equal(out[0].activeComments, 2);
  assert.equal(out[1].activeComments, 0);
  assert.notEqual(out, figs);                 // pure: new array
});

// ---- describeRegion: normalized drawn rects → a text the comment body can carry to Claude ----
test('describeRegion names the grid zone of a normalized region', () => {
  assert.match(describeRegion([{ x: 0.80, y: 0.08, w: 0.15, h: 0.20 }]), /upper.*right/i);
  assert.match(describeRegion([{ x: 0.02, y: 0.80, w: 0.20, h: 0.15 }]), /lower.*left/i);
  assert.match(describeRegion([{ x: 0.40, y: 0.40, w: 0.20, h: 0.20 }]), /center|middle/i);
});

test('describeRegion is empty for no region', () => {
  assert.equal(describeRegion([]), '');
  assert.equal(describeRegion(null), '');
});

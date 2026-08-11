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
  buildGallery, galleryHtml,
  figureKey, markReviewed, isReviewed, sweepProgress, flattenFigures, adjacentFigure, firstUnreviewedFigure,
  normalizedBBox,
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

// normalizedBBox: canvas-pixel drawn shapes → one 0..1 bounding box, feeding describeRegion (Slice 4 bridge)
test('normalizedBBox reduces drawn shapes to a normalized bounding box', () => {
  assert.deepEqual(normalizedBBox([{ type: 'rect', x: 80, y: 10, w: 30, h: 40 }], 100, 100),
    [{ x: 0.8, y: 0.1, w: 0.3, h: 0.4 }]);
  // freehand points + a rect → the union bbox, normalized and clamped to [0,1]
  const bb = normalizedBBox([
    { type: 'free', points: [[10, 20], [40, 60]] },
    { type: 'rect', x: 50, y: 10, w: 40, h: 20 },
  ], 100, 100)[0];
  assert.equal(bb.x, 0.1); assert.equal(bb.y, 0.1);
  assert.equal(Math.round(bb.w * 100), 80); assert.equal(Math.round(bb.h * 100), 50);
  // pipes into describeRegion to yield a human/Claude phrase
  assert.match(describeRegion(normalizedBBox([{ type: 'rect', x: 80, y: 5, w: 15, h: 20 }], 100, 100)), /upper.*right/i);
});

test('normalizedBBox is empty for no shapes / bad dims', () => {
  assert.deepEqual(normalizedBBox([], 100, 100), []);
  assert.deepEqual(normalizedBBox([{ type: 'rect', x: 1, y: 1, w: 1, h: 1 }], 0, 0), []);
  assert.deepEqual(normalizedBBox(null, 100, 100), []);
});

// ================= Slice 2: gallery view-model + renderer (pure) =================

const UNITS = [{ id: 'ch_thermal', n: 3, title: 'Thermal model' }, { id: 'ch_val', n: 4, title: 'Validation' }];
const FRAGS = { ch_thermal: CH3, ch_val: CH4 };

test('buildGallery composes figures, refs, thumbnails and active-comment counts per chapter', () => {
  const commentsByChapter = {
    ch_thermal: [
      { kind: 'figure', status: 'open', anchor: { fignum: '3.1' } },
      { kind: 'figure', status: 'merged', anchor: { fignum: '3.1' } },   // resolved → not counted
    ],
    ch_val: [],
  };
  const g = buildGallery(UNITS, FRAGS, commentsByChapter);
  assert.deepEqual(g.map(x => x.chapter.id), ['ch_thermal', 'ch_val']);
  const f31 = g[0].figures[0];
  assert.equal(f31.fignum, '3.1');
  assert.equal(f31.imgSrc, 'data:image/png;base64,AAAAmesh_of_the_domain_QQQQ');   // thumbnail source
  assert.deepEqual(f31.referencedIn, ['Thermal model', 'Boundary conditions']);    // from figureRefsInFragment
  assert.equal(f31.activeComments, 1);                                             // only the open one
  assert.equal(g[0].count, 2);                                                     // 3.1 + 3.2
  assert.equal(g[1].figures[0].fignum, '4.1');
  assert.equal(g[1].figures[0].activeComments, 0);
});

test('buildGallery tolerates missing fragments / comments and preserves reading order', () => {
  const g = buildGallery(UNITS, { ch_thermal: CH3 }, undefined);   // ch_val fragment + all comments missing
  assert.deepEqual(g.map(x => x.chapter.id), ['ch_thermal', 'ch_val']);
  assert.equal(g[1].figures.length, 0);
  assert.equal(g[0].figures[0].activeComments, 0);
});

test('galleryHtml renders per-chapter sections with wireable cards (data-fig-ch / data-fig-num)', () => {
  const g = buildGallery(UNITS, FRAGS, { ch_thermal: [{ kind: 'figure', status: 'open', anchor: { fignum: '3.1' } }] });
  const html = galleryHtml(g);
  assert.match(html, /data-fig-ch="ch_thermal"/);
  assert.match(html, /data-fig-num="3\.1"/);
  assert.match(html, /Thermal model/);                        // chapter header
  assert.match(html, /Finite-element mesh of the build domain/); // caption text
  assert.match(html, /Referenced in/i);                       // where-referenced line
  assert.match(html, /data:image\/png;base64,AAAA/);          // thumbnail img src
  // active-comment badge shows the count for 3.1 but 3.2 (no comments) has none
  assert.match(html, /figgal-badge[^>]*>\s*1\s*</);
});

test('galleryHtml escapes caption/heading content (no HTML injection)', () => {
  const gallery = [{
    chapter: { id: 'c1', n: 1, title: 'Intro <x>' },
    count: 1,
    figures: [{ fignum: '1.1', caption: 'A <b>bold</b> & "quoted" caption', imgSrc: 'data:x', imgSrcTail: 'x', referencedIn: [], activeComments: 0 }],
  }];
  const html = galleryHtml(gallery);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;quoted&quot;|&quot;/);
  assert.match(html, /Intro &lt;x&gt;/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);   // raw markup never emitted
});

// ================= Slice 3: sweep state + sequential nav + gallery review affordances =================

test('figureKey is a stable per-figure key from chapter id + number', () => {
  assert.equal(figureKey('ch_thermal', '3.1'), 'ch_thermal#3.1');
  assert.equal(figureKey('ch_val', '4'), 'ch_val#4');
});

test('markReviewed / isReviewed toggle a figure done-state immutably', () => {
  const a = markReviewed({}, 'ch_thermal#3.1', true);
  assert.equal(isReviewed(a, 'ch_thermal#3.1'), true);
  assert.equal(isReviewed(a, 'ch_thermal#3.2'), false);
  const b = markReviewed(a, 'ch_thermal#3.1', false);   // un-mark
  assert.equal(isReviewed(b, 'ch_thermal#3.1'), false);
  assert.notEqual(a, b);                                // pure: new object each time
  assert.equal(isReviewed(a, 'ch_thermal#3.1'), true);  // original untouched
  assert.equal(isReviewed(null, 'x'), false);           // safe on missing state
});

test('sweepProgress counts reviewed vs total across all chapters', () => {
  const g = buildGallery(UNITS, FRAGS, {});   // 3.1, 3.2, 4.1 → total 3
  assert.deepEqual(sweepProgress(g, {}), { total: 3, done: 0, remaining: 3 });
  const reviewed = markReviewed(markReviewed({}, 'ch_thermal#3.1', true), 'ch_val#4.1', true);
  assert.deepEqual(sweepProgress(g, reviewed), { total: 3, done: 2, remaining: 1 });
});

test('flattenFigures yields every figure in reading order with its key', () => {
  const g = buildGallery(UNITS, FRAGS, {});
  const flat = flattenFigures(g);
  assert.deepEqual(flat.map(f => f.key), ['ch_thermal#3.1', 'ch_thermal#3.2', 'ch_val#4.1']);
  assert.equal(flat[0].chapterId, 'ch_thermal');
  assert.equal(flat[0].fignum, '3.1');
});

test('adjacentFigure walks next/prev, clamps at the ends, and seeds from null', () => {
  const g = buildGallery(UNITS, FRAGS, {});
  assert.equal(adjacentFigure(g, null, 1).key, 'ch_thermal#3.1');           // no current → first
  assert.equal(adjacentFigure(g, null, -1).key, 'ch_val#4.1');              // no current, back → last
  assert.equal(adjacentFigure(g, 'ch_thermal#3.1', 1).key, 'ch_thermal#3.2');
  assert.equal(adjacentFigure(g, 'ch_thermal#3.2', 1).key, 'ch_val#4.1');
  assert.equal(adjacentFigure(g, 'ch_val#4.1', 1), null);                   // past the end
  assert.equal(adjacentFigure(g, 'ch_thermal#3.1', -1), null);             // before the start
});

test('firstUnreviewedFigure returns the next figure needing a look, or null when the sweep is done', () => {
  const g = buildGallery(UNITS, FRAGS, {});
  assert.equal(firstUnreviewedFigure(g, {}).key, 'ch_thermal#3.1');
  const some = markReviewed({}, 'ch_thermal#3.1', true);
  assert.equal(firstUnreviewedFigure(g, some).key, 'ch_thermal#3.2');
  let all = {}; flattenFigures(g).forEach(f => { all = markReviewed(all, f.key, true); });
  assert.equal(firstUnreviewedFigure(g, all), null);
});

test('galleryHtml marks reviewed cards, shows sweep progress, and renders draw + done actions per card', () => {
  const g = buildGallery(UNITS, FRAGS, {});
  const reviewed = markReviewed({}, 'ch_thermal#3.1', true);
  const html = galleryHtml(g, { reviewed });
  assert.match(html, /data-fig-key="ch_thermal#3\.1"/);
  assert.match(html, /data-act="draw"/);                 // the figure area itself = open the draw canvas (primary click)
  assert.match(html, /data-act="context"/);              // secondary "view in chapter" link
  assert.match(html, /data-act="done"/);                 // mark-reviewed toggle
  assert.match(html, /figgal-progress/);                 // sweep progress header present
  assert.match(html, /1 of 3 reviewed/i);
  // exactly one card is flagged done (the reviewed 3.1), the other two are not
  assert.equal((html.match(/figgal-done/g) || []).length, 1);
});

test('galleryHtml without a reviewed map still renders (back-compat) with no progress header and nothing marked done', () => {
  const html = galleryHtml(buildGallery(UNITS, FRAGS, {}));
  assert.match(html, /data-fig-num="3\.1"/);
  assert.doesNotMatch(html, /figgal-progress/);
  assert.equal((html.match(/figgal-done/g) || []).length, 0);
});

test('galleryHtml shows an empty state when the document has no figures, and skips figure-less chapters', () => {
  const empty = galleryHtml(buildGallery([{ id: 'c1', n: 1, title: 'Prose' }], { c1: '<p>no figures</p>' }, {}));
  assert.match(empty, /no figures/i);
  // a chapter with zero figures is not rendered as a section when others have figures
  const mixed = galleryHtml(buildGallery(
    [{ id: 'c1', n: 1, title: 'Prose only' }, { id: 'ch_val', n: 4, title: 'Validation' }],
    { c1: '<p>none</p>', ch_val: CH4 }, {}));
  assert.doesNotMatch(mixed, /Prose only/);
  assert.match(mixed, /Validation/);
});

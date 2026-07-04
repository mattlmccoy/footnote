import { test } from 'node:test'; import assert from 'node:assert/strict';
import { buildWorklist } from '../js/worklist.js';

const CH = [
  { id: 'ch_results', n: 3, title: 'Results', sourceFile: 'chapters/results.tex' },
  { id: 'ch_intro',   n: 1, title: 'Introduction', sourceFile: 'chapters/intro.tex' },
];
const CFG = { doc: { title: 'My Thesis' }, advisors: [{ id: 'CJS', name: 'Carolyn Seepersad' }] };

const rev = (comments) => ({ chapter: 'x', comments });
const cmt = (o) => ({ id: 'c1', kind: 'text', status: 'open', author: null,
  anchor: { quote: 'the melt-pool contrast was pronounced', synctex: null, section: '§3.2', figure: null },
  body: 'Overstates it.', edit: null, created_ts: '2026-07-01T00:00:00Z', ...o });

test('buildWorklist: groups by sourceFile and sorts groups by file', () => {
  const reviews = { ch_results: rev([cmt({})]), ch_intro: rev([cmt({ id: 'c2' })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  assert.deepEqual(wl.map(g => g.file), ['chapters/intro.tex', 'chapters/results.tex']);
  assert.equal(wl[1].title, 'Results');
});

test('buildWorklist: excludes declined comments', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a' }), cmt({ id: 'b', status: 'declined' })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  assert.equal(wl.length, 1);
  assert.deepEqual(wl[0].items.map(i => i.id), ['a']);
});

test('buildWorklist: maps advisor id to name, owner to You', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a', author: 'CJS' }), cmt({ id: 'b', author: null })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  const names = wl[0].items.map(i => i.reviewerName).sort();
  assert.deepEqual(names, ['Carolyn Seepersad', 'You']);
});

test('buildWorklist: unknown author id passes through verbatim', () => {
  const reviews = { ch_results: rev([cmt({ author: 'ZZZ' })]) };
  assert.equal(buildWorklist(CH, reviews, CFG)[0].items[0].reviewerName, 'ZZZ');
});

test('buildWorklist: open count excludes actioned', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a' }), cmt({ id: 'b', actioned: true })]) };
  const g = buildWorklist(CH, reviews, CFG)[0];
  assert.equal(g.items.length, 2);
  assert.equal(g.open, 1);
});

test('buildWorklist: chapter with no review is skipped', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({})]) }, CFG);
  assert.deepEqual(wl.map(g => g.file), ['chapters/results.tex']);
});

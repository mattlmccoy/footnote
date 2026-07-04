import { test } from 'node:test'; import assert from 'node:assert/strict';
import { buildWorklist, worklistToMarkdown, worklistToHtml } from '../js/worklist.js';

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

const META = { docTitle: 'My Thesis', generatedTs: '2026-07-03T12:00:00Z' };

test('worklistToMarkdown: empty worklist yields the caught-up line', () => {
  const md = worklistToMarkdown([], META);
  assert.match(md, /# Review worklist — My Thesis/);
  assert.match(md, /0 open items/);
  assert.match(md, /No open comments — you're all caught up\./);
});

test('worklistToMarkdown: renders file heading, search locator, comment, edit', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({
    edit: { op: 'replace', find: 'was pronounced', replacement: 'was measurable' } })]) }, CFG);
  const md = worklistToMarkdown(wl, META);
  assert.match(md, /## chapters\/results\.tex/);
  assert.match(md, /- \[ \] §3\.2 — You · 2026-07-01/);
  assert.match(md, /search: "the melt-pool contrast was pronounced"/);
  assert.match(md, /Comment: Overstates it\./);
  assert.match(md, /before: "was pronounced"  →  after: "was measurable"/);
});

test('worklistToMarkdown: actioned item uses a checked box', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({ actioned: true })]) }, CFG);
  assert.match(worklistToMarkdown(wl, META), /- \[x\] /);
});

test('worklistToMarkdown: shows line number only when synctex present', () => {
  const withLine = buildWorklist(CH, { ch_results: rev([cmt({
    anchor: { quote: 'foo', synctex: { line: 142 }, section: '§3.2' } })]) }, CFG);
  assert.match(worklistToMarkdown(withLine, META), /search: "foo"  · line 142/);
  const noLine = buildWorklist(CH, { ch_results: rev([cmt({})]) }, CFG);
  assert.doesNotMatch(worklistToMarkdown(noLine, META), /· line/);
});

test('worklistToMarkdown: empty-quote item locates by label, omits edit block', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({
    kind: 'figure', anchor: { quote: '', synctex: null, figure: 'Figure 3.2', section: '§3.2' } })]) }, CFG);
  const md = worklistToMarkdown(wl, META);
  assert.match(md, /Find in Overleaf → Figure 3\.2/);
  assert.doesNotMatch(md, /before:/);
});

const E = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('worklistToHtml: renders group header, checkbox, search chip, edit block', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({
    edit: { op: 'replace', find: 'was pronounced', replacement: 'was measurable' } })]) }, CFG);
  const html = worklistToHtml(wl, E);
  assert.match(html, /class="ovl-grp-h">chapters\/results\.tex <span class="ovl-n">· 1 open/);
  assert.match(html, /data-cid="c1" data-ch="ch_results"/);
  assert.match(html, /type="checkbox" class="ovl-cb"/);
  assert.match(html, /search: "the melt-pool contrast was pronounced"/);
  assert.match(html, /before <span class="ba">"was pronounced"<\/span> → after <span class="ba">"was measurable"/);
});

test('worklistToHtml: actioned item gets done class + checked box', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({ actioned: true })]) }, CFG);
  const html = worklistToHtml(wl, E);
  assert.match(html, /class="ovl-item done"/);
  assert.match(html, /class="ovl-cb" checked/);
});

test('worklistToHtml: escapes reviewer/comment via the provided escape fn', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({ body: '<script>x</script>' })]) }, CFG);
  const html = worklistToHtml(wl, E);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

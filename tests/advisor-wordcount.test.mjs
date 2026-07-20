import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The reviewer portal must show word counts, mirroring the author panel: a per-unit count on the home
// cards and a floating pill on the reading view. These assert the wiring is present so it can't silently
// drop, and that the reviewer stays AI-clean (it may only import term-neutral helpers).
const adv = readFileSync(new URL('../js/advisor.js', import.meta.url), 'utf8');
const importLines = adv.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n');

test('advisor imports the word-count helpers', () => {
  assert.match(importLines, /\bcountWords\b/, 'reading-view pill needs countWords');
  assert.match(importLines, /\bformatCount\b/, 'home cards need formatCount');
});

test('advisor loads counts.json and renders the reading-view pill', () => {
  assert.match(adv, /content\/counts\.json/, 'must read the engine counts file');
  assert.match(adv, /renderWordCountFab|wc-fab/, 'reading view must show a word-count pill');
});

test('the imported word-count / layout modules are AI-clean (reviewer gate)', () => {
  for (const f of ['wordcount.js', 'fablayout.js']) {
    const src = readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
    assert.ok(!/\b(claude|assistant)\b/i.test(src), `${f} carries assistant vocabulary; advisor can't import it`);
  }
});

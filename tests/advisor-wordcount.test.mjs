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

test('renderWordCountFab persists its fallback count into COUNTS so the panel matches the pill', () => {
  // the reported bug: pill showed 396 words while the panel showed an em dash + Total 0, because the
  // fallback count was computed only for the pill and never written where the panel reads it.
  const fn = adv.slice(adv.indexOf('function renderWordCountFab'), adv.indexOf('function renderWordCountFab') + 900);
  assert.match(fn, /COUNTS\[current\]\s*=/, 'the fallback count must be stored into COUNTS[current]');
});

test('the reviewer word-count pill is clickable and opens a breakdown panel (mirrors the author panel)', () => {
  assert.match(adv, /function openWordCountPanel/, 'reviewer needs a word-count panel');
  // the pill must actually wire a click to it — a display-only pill was the reported bug
  assert.match(adv, /fab\.onclick\s*=\s*openWordCountPanel/, 'the pill must open the panel on click');
  assert.ok(!/'wc-fab'[\s\S]{0,500}?cursor:default/.test(adv), 'the pill should not be cursor:default (implies non-interactive)');
});

test('the imported word-count / layout modules are AI-clean (reviewer gate)', () => {
  for (const f of ['wordcount.js', 'fablayout.js']) {
    const src = readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
    assert.ok(!/\b(claude|assistant)\b/i.test(src), `${f} carries assistant vocabulary; advisor can't import it`);
  }
});

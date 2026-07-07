import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatexChapters } from '../js/docparse.js';

// chapter mode: \appendix in main.tex before the appendix \include(s)
test('chapter mode: units after \\appendix are marked appendix with reset letters', () => {
  const main = '\\include{intro}\n\\include{methods}\n\\appendix\n\\include{appA}\n\\include{appB}';
  const files = { intro: '\\chapter{Introduction}', methods: '\\chapter{Methods}', appA: '\\chapter{Derivations}', appB: '\\chapter{Data}' };
  const out = parseLatexChapters(main, p => files[p] ?? null);
  assert.deepEqual(out.map(u => [u.title, u.n, u.kind || 'chapter']), [
    ['Introduction', 1, 'chapter'],
    ['Methods', 2, 'chapter'],
    ['Derivations', 1, 'appendix'],
    ['Data', 2, 'appendix'],
  ]);
});

// section mode: single file, \appendix before later \sections
test('section mode: sections after \\appendix are appendices', () => {
  const main = '\\section{Overview}\n\\section{Results}\n\\appendix\n\\section{Extra Tables}';
  const out = parseLatexChapters(main, () => null);
  assert.deepEqual(out.map(u => [u.title, u.n, u.kind || 'chapter']), [
    ['Overview', 1, 'chapter'],
    ['Results', 2, 'chapter'],
    ['Extra Tables', 1, 'appendix'],
  ]);
});

test('a document with no \\appendix has no appendix units (back-compatible)', () => {
  const main = '\\include{intro}\n\\include{methods}';
  const files = { intro: '\\chapter{Introduction}', methods: '\\chapter{Methods}' };
  const out = parseLatexChapters(main, p => files[p] ?? null);
  assert.equal(out.every(u => !u.kind), true);
  assert.deepEqual(out.map(u => u.n), [1, 2]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatexChapters, appendixBoundary } from '../js/docparse.js';

// ---- appendixBoundary: the single, policy-free boundary detector shared by parseLatexOutline (drops
//      at/after) and parseLatexChapters (keeps, labels A-E). Returns the index, or Infinity when none. ----
test('appendixBoundary finds \\appendix', () => {
  assert.equal(appendixBoundary('a\nb\n\\appendix\nc'), 4);
});
test('appendixBoundary finds \\begin{theappendices} (GaTech thesis env)', () => {
  const t = 'a\n\\begin{theappendices}\nc';
  assert.equal(appendixBoundary(t), t.indexOf('\\begin'));
});
test('appendixBoundary finds a bare \\begin{appendices}', () => {
  assert.equal(appendixBoundary('\\begin{appendices}'), 0);
});
test('appendixBoundary returns Infinity when there is no appendix boundary', () => {
  assert.equal(appendixBoundary('\\chapter{One}\n\\chapter{Two}'), Infinity);
});

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

// GaTech thesis class: appendices are wrapped in \begin{theappendices}...\end{theappendices}, with no
// bare \appendix command. The boundary detector must recognize the environment too, or the appendices get
// miscounted as trailing chapters (the real dissertation showed 14 chapters instead of 9 + 5 appendices).
test('chapter mode: \\include\'d units after \\begin{theappendices} are appendices with reset letters', () => {
  const main = '\\include{intro}\n\\include{methods}\n\\begin{theappendices}\n\\include{appA}\n\\include{appB}\n\\end{theappendices}';
  const files = { intro: '\\chapter{Introduction}', methods: '\\chapter{Methods}', appA: '\\chapter{Derivations}', appB: '\\chapter{Data}' };
  const out = parseLatexChapters(main, p => files[p] ?? null);
  assert.deepEqual(out.map(u => [u.title, u.n, u.kind || 'chapter']), [
    ['Introduction', 1, 'chapter'],
    ['Methods', 2, 'chapter'],
    ['Derivations', 1, 'appendix'],
    ['Data', 2, 'appendix'],
  ]);
});

test('single-file mode: \\chapter\'s after \\begin{theappendices} are appendices', () => {
  const main = '\\chapter{Real One}\nText.\n\\chapter{Real Two}\nMore.\n\\begin{theappendices}\n\\chapter{Appendix A}\nApp.\n\\end{theappendices}';
  const out = parseLatexChapters(main, () => null);
  assert.deepEqual(out.map(u => [u.title, u.n, u.kind || 'chapter']), [
    ['Real One', 1, 'chapter'],
    ['Real Two', 2, 'chapter'],
    ['Appendix A', 1, 'appendix'],
  ]);
});

test('a document with no \\appendix has no appendix units (back-compatible)', () => {
  const main = '\\include{intro}\n\\include{methods}';
  const files = { intro: '\\chapter{Introduction}', methods: '\\chapter{Methods}' };
  const out = parseLatexChapters(main, p => files[p] ?? null);
  assert.equal(out.every(u => !u.kind), true);
  assert.deepEqual(out.map(u => u.n), [1, 2]);
});

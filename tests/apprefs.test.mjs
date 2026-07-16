import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referencedLabels, appendixLabels } from '../js/apprefs.js';

test('referencedLabels: single \\cref', () => {
  assert.deepEqual(referencedLabels('See \\cref{app:derivations} for details.'), ['app:derivations']);
});

test('referencedLabels: comma list expands', () => {
  assert.deepEqual(referencedLabels('\\cref{app:a,app:b}'), ['app:a', 'app:b']);
});

test('referencedLabels: mixed ref/Cref/autoref/eqref, ignores \\cite and \\label', () => {
  const src = '\\ref{app:x} \\Cref{app:y} \\autoref{app:z} \\eqref{eq:1} \\cite{smith} \\label{app:defined}';
  assert.deepEqual(referencedLabels(src), ['app:x', 'app:y', 'app:z', 'eq:1']);
});

test('referencedLabels: none', () => {
  assert.deepEqual(referencedLabels('plain text, no refs'), []);
});

test('appendixLabels: extracts \\label definitions', () => {
  assert.deepEqual(appendixLabels('\\chapter{Data}\\label{app:data}\nx \\label{app:data:sub}'),
    ['app:data', 'app:data:sub']);
});

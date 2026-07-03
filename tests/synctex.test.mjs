import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSyncTeX, lookup } from '../js/synctex.js';

test('parseSyncTeX indexes input files + boxes', () => {
  const idx = parseSyncTeX(readFileSync(new URL('./fixtures/sample.synctex', import.meta.url),'utf8'));
  assert.equal(idx.files[1], '/chapters/ch_modeling.tex');
  assert.ok(idx.boxes.length >= 1);
});
test('lookup returns nearest file:line for a point on the page', () => {
  const idx = parseSyncTeX(readFileSync(new URL('./fixtures/sample.synctex', import.meta.url),'utf8'));
  const hit = lookup(idx, 1, 1.6, 1.9); // sp→pt scaled point inside the box
  assert.equal(hit.file, 'chapters/ch_modeling.tex'); assert.equal(hit.line, 142);
});

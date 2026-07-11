import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandMark } from '../js/brandmark.js';

test('brandMark returns the Footnote mark SVG tinted with the accent', () => {
  const svg = brandMark('#2c64c4');
  assert.match(svg, /^<svg/);
  assert.match(svg, /class="fn-mark"/);
  assert.match(svg, /fill="#2c64c4"/);   // the rounded-square uses the accent
});

test('brandMark accepts any accent color', () => {
  assert.match(brandMark('#b5643c'), /fill="#b5643c"/);
});

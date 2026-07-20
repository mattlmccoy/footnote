import { test } from 'node:test'; import assert from 'node:assert/strict';
import { helpFabRight } from '../js/fablayout.js';

test('with no word-count pill the help button sits at the screen edge', () => {
  assert.equal(helpFabRight(0), 22);
  assert.equal(helpFabRight(null), 22);
  assert.equal(helpFabRight(undefined), 22);
});

test('with a pill present the help button clears it, to its left', () => {
  // pill is 130px wide at right:22 -> its left edge is 152 in from the right; help sits a gap further
  assert.equal(helpFabRight(130), 22 + 130 + 10);
});

test('the offset tracks the pill as its label grows (2,244 words vs 12,480 words)', () => {
  assert.ok(helpFabRight(150) > helpFabRight(120));
});

test('a nonsense width falls back to the edge rather than flinging the button off-screen', () => {
  for (const w of [NaN, -50, 'wide', {}]) assert.equal(helpFabRight(w), 22);
});

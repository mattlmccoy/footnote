import { test } from 'node:test'; import assert from 'node:assert/strict';
import { wordDiff } from '../js/textdiff.js';

const added = d => d.filter(t => t.added).map(t => t.text.trim());
const rebuilt = d => d.map(t => t.text).join('');

test('wordDiff: identical text has no additions and rebuilds exactly', () => {
  const d = wordDiff('the cat sat', 'the cat sat');
  assert.equal(rebuilt(d), 'the cat sat');
  assert.equal(d.some(t => t.added), false);
});

test('wordDiff: an inserted word is flagged added', () => {
  const d = wordDiff('the cat sat', 'the big cat sat');
  assert.deepEqual(added(d), ['big']);
  assert.equal(rebuilt(d), 'the big cat sat');
});

test('wordDiff: a changed word is flagged added', () => {
  const d = wordDiff('the cat sat', 'the dog sat');
  assert.deepEqual(added(d), ['dog']);
  assert.equal(rebuilt(d), 'the dog sat');
});

test('wordDiff: appended words are flagged', () => {
  const d = wordDiff('one two', 'one two three four');
  assert.deepEqual(added(d), ['three', 'four']);
});

test('wordDiff: deletions do not appear (only new text is returned)', () => {
  const d = wordDiff('alpha beta gamma', 'alpha gamma');
  assert.equal(rebuilt(d), 'alpha gamma');
  assert.equal(d.some(t => t.added), false);   // nothing added, beta just gone
});

test('wordDiff: empty old means everything is added', () => {
  const d = wordDiff('', 'brand new line');
  assert.deepEqual(added(d), ['brand', 'new', 'line']);
});

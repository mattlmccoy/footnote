import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterComments, editComments, clusterHasConflict } from '../js/cluster.js';

const C = (id, quote, section = 's1', extra = {}) => ({ id, anchor: { quote, section }, ...extra });
const E = (id, quote, find = quote) => C(id, quote, 's1', { edit: { op: 'replace', find, replacement: 'x' } });

test('two comments on the same passage (identical quote + section) form one cluster', () => {
  const out = clusterComments([C('a', 'the quick brown fox'), C('b', 'the quick brown fox')]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].map(c => c.id), ['a', 'b']);
});

test('a nested quote (one contains the other) clusters', () => {
  const out = clusterComments([C('a', 'the quick brown fox jumps'), C('b', 'quick brown fox')]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].map(c => c.id).sort(), ['a', 'b']);
});

test('overlap is whitespace/case-insensitive', () => {
  const out = clusterComments([C('a', 'The  Quick Brown'), C('b', 'the quick brown')]);
  assert.equal(out.length, 1);
});

test('same quote in different sections does NOT cluster', () => {
  const out = clusterComments([C('a', 'intro line', 's1'), C('b', 'intro line', 's2')]);
  assert.equal(out.length, 2);
});

test('non-overlapping quotes stay separate (singletons)', () => {
  const out = clusterComments([C('a', 'alpha'), C('b', 'omega')]);
  assert.deepEqual(out.map(g => g.map(c => c.id)), [['a'], ['b']]);
});

test('clustering is transitive (A⊇B, B⊇C → one cluster)', () => {
  const out = clusterComments([C('a', 'one two three four'), C('b', 'two three four'), C('c', 'three four')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 3);
});

test('input order is preserved and every comment appears exactly once', () => {
  const out = clusterComments([C('a', 'x'), C('b', 'shared text'), C('c', 'y'), C('d', 'shared text')]);
  const ids = out.flat().map(c => c.id);
  assert.deepEqual(ids.slice().sort(), ['a', 'b', 'c', 'd']);
  assert.equal(out.find(g => g.length > 1).map(c => c.id).join(','), 'b,d');
});

test('empty / missing anchors do not throw and never cluster', () => {
  assert.deepEqual(clusterComments([]), []);
  const out = clusterComments([C('a', ''), { id: 'b' }]);
  assert.equal(out.length, 2);
});

// --------------------------------------------------------------- conflict escalation

test('editComments returns only the comments carrying a source edit', () => {
  const out = editComments([C('a', 'q'), E('b', 'q'), { id: 'c', source_edit: { find: 'z', replacement: 'w' } }]);
  assert.deepEqual(out.map(c => c.id), ['b', 'c']);
});

test('clusterHasConflict is true when 2+ comments in the group carry an edit', () => {
  assert.equal(clusterHasConflict([E('a', 'q'), E('b', 'q')]), true);
});

test('clusterHasConflict is false with 0 or 1 edit (plain discussion is not a conflict)', () => {
  assert.equal(clusterHasConflict([C('a', 'q'), C('b', 'q')]), false);
  assert.equal(clusterHasConflict([C('a', 'q'), E('b', 'q')]), false);
});

test('editComments tolerates an edit spec without a find (ignored)', () => {
  assert.deepEqual(editComments([{ id: 'a', edit: { op: 'replace' } }, E('b', 'q')]).map(c => c.id), ['b']);
});

test('an already-resolved edit no longer counts (keeping one clears the conflict)', () => {
  const kept = E('a', 'q');
  const dismissed = { ...E('b', 'q'), resolution: { state: 'declined', note: '' } };
  assert.deepEqual(editComments([kept, dismissed]).map(c => c.id), ['a']);
  assert.equal(clusterHasConflict([kept, dismissed]), false);   // one active edit left → no conflict
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentsAdd, recentsList, linkFor, newCount, recentsKey } from '../js/reviewerhome.js';

const E = (o) => ({ a: 'rev1', n: 'Dr. Patel', data: 'owner/proj-data', p: 'proj', k: 'KEY', ...o });

test('recentsKey is the stable localStorage key', () => {
  assert.equal(recentsKey(), 'footnote:reviews');
});

test('recentsAdd inserts a new entry at the front', () => {
  const out = recentsAdd([], E({ p: 'a', title: 'A' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'A');
});

test('recentsAdd dedupes by data+p and moves the match to the front, merging fields', () => {
  let list = [E({ p: 'a', title: 'A', ts: 1 }), E({ p: 'b', title: 'B', ts: 2 })];
  list = recentsAdd(list, E({ p: 'b', title: 'B2', ts: 5 }));
  assert.equal(list.length, 2);                 // no duplicate
  assert.equal(list[0].p, 'b');                 // moved to front
  assert.equal(list[0].title, 'B2');            // newer field wins
});

test('recentsAdd treats different data repos as distinct even with the same p', () => {
  let list = recentsAdd([], E({ data: 'author1/x', p: 'proj' }));
  list = recentsAdd(list, E({ data: 'author2/x', p: 'proj' }));
  assert.equal(list.length, 2);
});

test('recentsList drops invalid entries and sorts newest-first by ts', () => {
  const raw = [E({ p: 'a', ts: 1 }), { junk: true }, E({ p: 'b', ts: 9 }), E({ a: '', p: 'c', ts: 5 })];
  const out = recentsList(raw);
  assert.deepEqual(out.map(e => e.p), ['b', 'a']);   // 'c' dropped (no a), junk dropped
});

test('recentsList handles a null/non-array input', () => {
  assert.deepEqual(recentsList(null), []);
  assert.deepEqual(recentsList('nope'), []);
});

test('linkFor reconstructs the invite URL, encoding values', () => {
  const url = linkFor(E({ a: 'rev 1', n: 'Dr. Patel', data: 'o/r', p: 'proj', k: 'K/Y' }));
  assert.match(url, /^advisor\.html\?/);
  assert.match(url, /a=rev%201/);
  assert.match(url, /data=o%2Fr/);
  assert.match(url, /p=proj/);
  assert.match(url, /k=K%2FY/);
});

test('linkFor omits &p= for a legacy entry with no project', () => {
  const url = linkFor(E({ p: '' }));
  assert.doesNotMatch(url, /[?&]p=/);
});

test('newCount counts released units added since the entry was last opened', () => {
  assert.equal(newCount(E({ seenReleased: ['c1', 'c2'] }), ['c1', 'c2', 'c3', 'c4']), 2);
});

test('newCount is 0 when nothing new / unknown baseline', () => {
  assert.equal(newCount(E({ seenReleased: ['c1', 'c2'] }), ['c1', 'c2']), 0);
  assert.equal(newCount(E({ seenReleased: undefined }), ['c1']), 0);   // no baseline → don't badge
  assert.equal(newCount(E({ seenReleased: ['c1'] }), []), 0);
});

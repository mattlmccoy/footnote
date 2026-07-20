import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentsAdd, recentsList, linkFor, newCount, recentsKey, pickAuthorName } from '../js/reviewerhome.js';

test('pickAuthorName prefers the GitHub profile name (inherited)', () => {
  assert.equal(pickAuthorName('Matt McCoy', 'typed name', 'mattlmccoy'), 'Matt McCoy');
});

test('pickAuthorName falls back to the typed name when the profile has none', () => {
  assert.equal(pickAuthorName(null, 'Dr. M. McCoy', 'mattlmccoy'), 'Dr. M. McCoy');
  assert.equal(pickAuthorName('  ', 'Dr. M. McCoy', 'mattlmccoy'), 'Dr. M. McCoy');
});

test('pickAuthorName falls back to the login when neither name is set', () => {
  assert.equal(pickAuthorName(null, null, 'mattlmccoy'), 'mattlmccoy');
  assert.equal(pickAuthorName('', '', 'mattlmccoy'), 'mattlmccoy');
  assert.equal(pickAuthorName('   ', '  ', 'mattlmccoy'), 'mattlmccoy');
});

test('pickAuthorName trims the chosen name', () => {
  assert.equal(pickAuthorName('  Matt McCoy  ', null, 'x'), 'Matt McCoy');
  assert.equal(pickAuthorName(null, '  Typed  ', 'x'), 'Typed');
});

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

// ---- removing a document from the shelf (reviewer can delete, esp. a dead link) ----
import { recentsRemove, entryKey } from '../js/reviewerhome.js';

test('entryKey identifies a document by repo + project (matches recentsAdd dedup)', () => {
  assert.equal(entryKey({ data: 'me/thesis', p: '' }), 'me/thesis/');
  assert.equal(entryKey({ data: 'me/ws', p: 'metro' }), 'me/ws/metro');
});

test('recentsRemove drops exactly the matching document, keeps the rest and order', () => {
  const list = [
    { a: 'r', data: 'me/a', p: '', k: 'x', ts: 3 },
    { a: 'r', data: 'me/ws', p: 'metro', k: 'x', ts: 2 },
    { a: 'r', data: 'me/b', p: '', k: 'x', ts: 1 },
  ];
  const out = recentsRemove(list, entryKey({ data: 'me/ws', p: 'metro' }));
  assert.deepEqual(out.map(e => e.data), ['me/a', 'me/b']);
});

test('recentsRemove is a no-op for an unknown key and tolerates junk input', () => {
  const list = [{ a: 'r', data: 'me/a', p: '', k: 'x' }];
  assert.equal(recentsRemove(list, 'me/nope/').length, 1);
  assert.deepEqual(recentsRemove(null, 'k'), []);
  assert.deepEqual(recentsRemove('junk', 'k'), []);
});

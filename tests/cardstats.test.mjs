import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProgress } from '../js/cardstats.js';

test('readProgress reports full progress when all sections are read', () => {
  assert.deepEqual(readProgress({ read: { a: true, b: true, c: true }, secCount: 3 }),
    { doneN: 3, secN: 3, frac: 1, done: true });
});

test('readProgress reports partial progress', () => {
  assert.deepEqual(readProgress({ read: { a: true }, secCount: 4 }),
    { doneN: 1, secN: 4, frac: 0.25, done: false });
});

test('readProgress treats an unopened chapter (no secCount) as zero, never dividing by zero', () => {
  assert.deepEqual(readProgress({ read: {}, secCount: 0 }),
    { doneN: 0, secN: 0, frac: 0, done: false });
});

test('readProgress handles a missing read map', () => {
  assert.deepEqual(readProgress({ secCount: 3 }),
    { doneN: 0, secN: 3, frac: 0, done: false });
});

test('readProgress handles null/undefined review without throwing', () => {
  assert.deepEqual(readProgress(null), { doneN: 0, secN: 0, frac: 0, done: false });
  assert.deepEqual(readProgress(undefined), { doneN: 0, secN: 0, frac: 0, done: false });
});

test('readProgress marks done when read count meets or exceeds secCount', () => {
  assert.equal(readProgress({ read: { a: true, b: true, c: true, d: true }, secCount: 3 }).done, true);
});

// ---- chapter milestones: what just became "complete" (drives the celebration) ----
import { chapterMilestones, newMilestones } from '../js/cardstats.js';

const isRes = c => ['merged', 'declined', 'resolved'].includes(c.status);

test('chapterMilestones reports read-complete and all-comments-resolved', () => {
  const half = { read: { a: true }, secCount: 2, comments: [] };
  assert.deepEqual(chapterMilestones(half, isRes), { readDone: false, commentsDone: false });

  const readDone = { read: { a: true, b: true }, secCount: 2, comments: [{ status: 'open' }] };
  assert.equal(chapterMilestones(readDone, isRes).readDone, true);
  assert.equal(chapterMilestones(readDone, isRes).commentsDone, false);

  const allRes = { read: {}, secCount: 2, comments: [{ status: 'merged' }, { status: 'declined' }] };
  assert.equal(chapterMilestones(allRes, isRes).commentsDone, true);

  // a chapter with NO comments never counts as "all resolved" (nothing was accomplished)
  assert.equal(chapterMilestones({ read: {}, secCount: 1, comments: [] }, isRes).commentsDone, false);
});

test('newMilestones fires only on a false → true flip (never repeats, never on load)', () => {
  const none = { readDone: false, commentsDone: false };
  const read = { readDone: true, commentsDone: false };
  assert.deepEqual(newMilestones(none, read), { read: true, comments: false });
  assert.deepEqual(newMilestones(read, read), { read: false, comments: false });   // already celebrated
  assert.deepEqual(newMilestones(read, { readDone: true, commentsDone: true }), { read: false, comments: true });
  // un-checking then re-checking can celebrate again — that's a genuine new completion
  assert.deepEqual(newMilestones(read, none), { read: false, comments: false });
  assert.deepEqual(newMilestones(none, read), { read: true, comments: false });
});

// ---- one-shot card fill celebration: celebrate a chapter card the first time it reads complete ----
import { newlyCompleteCards, parseCelebrated, addCelebrated } from '../js/cardstats.js';

test('newlyCompleteCards = complete cards not celebrated before', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const done = { a: true, b: false, c: true };
  assert.deepEqual(newlyCompleteCards(items, id => done[id], new Set()), ['a', 'c']);
  assert.deepEqual(newlyCompleteCards(items, id => done[id], new Set(['a'])), ['c']);   // a already celebrated
  assert.deepEqual(newlyCompleteCards(items, id => done[id], new Set(['a', 'c'])), []); // all celebrated
});

test('parseCelebrated / addCelebrated round-trip a stored id list', () => {
  assert.deepEqual(parseCelebrated(null), []);
  assert.deepEqual(parseCelebrated('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseCelebrated('garbage'), []);
  assert.deepEqual(addCelebrated(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(addCelebrated(['a'], 'a'), ['a']);        // idempotent
});

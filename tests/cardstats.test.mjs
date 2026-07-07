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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChecklistDismissed, dismissChecklist, restoreChecklist } from '../js/relchecklist.js';

function fakeStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('a fresh project is not dismissed', () => {
  assert.equal(isChecklistDismissed(fakeStore(), 'repo:proj1'), false);
});

test('dismissChecklist persists, isChecklistDismissed then reports true', () => {
  const s = fakeStore();
  dismissChecklist(s, 'repo:proj1');
  assert.equal(isChecklistDismissed(s, 'repo:proj1'), true);
});

test('restoreChecklist clears the dismissal', () => {
  const s = fakeStore();
  dismissChecklist(s, 'repo:proj1');
  restoreChecklist(s, 'repo:proj1');
  assert.equal(isChecklistDismissed(s, 'repo:proj1'), false);
});

test('dismissal is isolated per project', () => {
  const s = fakeStore();
  dismissChecklist(s, 'repo:proj1');
  assert.equal(isChecklistDismissed(s, 'repo:proj2'), false);
});

test('a throwing store never crashes the caller', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(isChecklistDismissed(bad, 'x'), false);
  assert.doesNotThrow(() => dismissChecklist(bad, 'x'));
  assert.doesNotThrow(() => restoreChecklist(bad, 'x'));
});

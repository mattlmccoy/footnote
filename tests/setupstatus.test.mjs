import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingViewState } from '../js/setupstatus.js';

test('not imported yet', () => {
  assert.equal(readingViewState({ parsed: false, failed: false, built: 0, total: 0 }), 'unimported');
});

test('tree read failed (connection blocked) — NOT reported as not-built', () => {
  // the key case: content may all exist, but ghTree threw. Must not claim "none".
  assert.equal(readingViewState({ parsed: true, failed: true, built: 0, total: 14 }), 'unreachable');
});

test('all units built', () => {
  assert.equal(readingViewState({ parsed: true, failed: false, built: 14, total: 14 }), 'built');
});

test('some units built', () => {
  assert.equal(readingViewState({ parsed: true, failed: false, built: 9, total: 14 }), 'partial');
});

test('none built (tree read OK, no content)', () => {
  assert.equal(readingViewState({ parsed: true, failed: false, built: 0, total: 14 }), 'none');
});

test('failure takes precedence over a partial/complete count', () => {
  assert.equal(readingViewState({ parsed: true, failed: true, built: 14, total: 14 }), 'unreachable');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { nextIndex, tourSeen, markTourSeen } from '../js/tour.js';

test('nextIndex clamps and signals finish', () => {
  assert.strictEqual(nextIndex(0, -1, 5), 0);
  assert.strictEqual(nextIndex(2, +1, 5), 3);
  assert.strictEqual(nextIndex(4, +1, 5), -1);
  assert.strictEqual(nextIndex(3, 'skip', 5), -1);
});

test('tourSeen / markTourSeen round-trip via injected storage', () => {
  const mem = {}; const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  assert.strictEqual(tourSeen('t-owner-v1', store), false);
  markTourSeen('t-owner-v1', store);
  assert.strictEqual(tourSeen('t-owner-v1', store), true);
});

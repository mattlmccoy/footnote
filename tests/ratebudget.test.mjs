import { test } from 'node:test'; import assert from 'node:assert/strict';
import { observeBudget, budgetSnapshot, budgetLevel, budgetFactor, resetBudget } from '../js/ratebudget.js';

const hdrs = o => ({ get: k => o[String(k).toLowerCase()] ?? null });
const NOW = 1_700_000_000_000;
const RESET = Math.floor(NOW / 1000) + 1800;             // 30 min out

// ---------------- observing ----------------

test('before any response is seen the budget is UNKNOWN, not healthy', () => {
  resetBudget();
  const s = budgetSnapshot();
  assert.equal(s.known, false);
  assert.equal(s.remaining, null);
  assert.equal(budgetLevel(s, NOW), 'unknown');
});

test('observeBudget records limit/remaining/reset from a response', () => {
  resetBudget();
  observeBudget(hdrs({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4200', 'x-ratelimit-reset': String(RESET) }), NOW);
  const s = budgetSnapshot();
  assert.deepEqual([s.known, s.limit, s.remaining], [true, 5000, 4200]);
  assert.equal(s.reset, RESET * 1000);                   // exposed as ms epoch
});

test('observeBudget ignores a response with no rate headers (keeps the last real reading)', () => {
  resetBudget();
  observeBudget(hdrs({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '900', 'x-ratelimit-reset': String(RESET) }), NOW);
  observeBudget(hdrs({}), NOW + 1000);
  assert.equal(budgetSnapshot().remaining, 900);
});

test('observeBudget tolerates a null/absent headers object', () => {
  resetBudget();
  assert.doesNotThrow(() => { observeBudget(null, NOW); observeBudget(undefined, NOW); });
  assert.equal(budgetSnapshot().known, false);
});

// ---------------- levels ----------------

const snap = (remaining, reset = RESET * 1000) => ({ known: true, limit: 5000, remaining, reset, at: NOW });

test('budgetLevel tiers on the share of the limit left', () => {
  assert.equal(budgetLevel(snap(4500), NOW), 'ok');
  assert.equal(budgetLevel(snap(1000), NOW), 'low');       // 20%
  assert.equal(budgetLevel(snap(600), NOW), 'low');
  assert.equal(budgetLevel(snap(250), NOW), 'critical');   // 5%
  assert.equal(budgetLevel(snap(0), NOW), 'critical');
});

test('budgetLevel does not throttle when the window is about to refill', () => {
  const soon = NOW + 60_000;                                // resets in 60s
  assert.equal(budgetLevel(snap(10, soon), NOW), 'ok');
});

test('budgetLevel treats an elapsed window as refilled, not as starved', () => {
  const past = NOW - 1000;
  assert.equal(budgetLevel(snap(3, past), NOW), 'ok');
});

// ---------------- factors ----------------

test('budgetFactor widens polling only under real pressure', () => {
  assert.equal(budgetFactor('ok'), 1);
  assert.equal(budgetFactor('unknown'), 1);                 // ignorance must not throttle
  assert.ok(budgetFactor('low') > 1);
  assert.ok(budgetFactor('critical') > budgetFactor('low'));
});

test('budgetFactor is defined for an unrecognised level (never NaN into a timer)', () => {
  for (const l of [undefined, null, 'nonsense']) {
    const f = budgetFactor(l);
    assert.ok(Number.isFinite(f) && f >= 1, `bad factor for ${l}: ${f}`);
  }
});

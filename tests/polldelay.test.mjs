import { test } from 'node:test'; import assert from 'node:assert/strict';
import { livePollDelay, jobPollDelay } from '../js/polldelay.js';

// ---------------- live comment sync (owner + reviewer share this policy) ----------------

test('livePollDelay: an active session keeps the current 20s cadence', () => {
  assert.equal(livePollDelay({ idlePolls: 0 }), 20000);
});

test('livePollDelay: idleness ramps 20s -> 30s -> 45s -> 60s', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => livePollDelay({ idlePolls: i })), [20000, 30000, 45000, 60000]);
});

test('livePollDelay: never exceeds the cap however long the tab sits idle', () => {
  for (const i of [4, 10, 500]) assert.equal(livePollDelay({ idlePolls: i }), 60000);
  assert.equal(livePollDelay({ idlePolls: 99, max: 30000 }), 30000);   // max clamps DOWN; the ramp tops at 3x base
});

test('livePollDelay: while rate-limited it waits for the reset instead of hammering', () => {
  const now = 1_000_000;
  assert.equal(livePollDelay({ idlePolls: 0, rateLimitedUntil: now + 42_000, now }), 42_000);
  assert.equal(livePollDelay({ idlePolls: 0, rateLimitedUntil: now + 100, now }), 5000);   // floor
  assert.equal(livePollDelay({ idlePolls: 0, rateLimitedUntil: now - 1, now }), 20000);    // expired -> normal
});

// ---------------- cloud job progress ----------------

test('jobPollDelay: stays at 2.5s for the first ~30s, when the user is actually watching', () => {
  for (const p of [0, 1, 5, 12]) assert.equal(jobPollDelay({ polls: p }), 2500);
});

test('jobPollDelay: backs off after the snappy window, capped at 15s', () => {
  const d13 = jobPollDelay({ polls: 13 }), d14 = jobPollDelay({ polls: 14 });
  assert.ok(d13 > 2500 && d13 < 15000, `expected a ramp, got ${d13}`);
  assert.ok(d14 > d13);
  assert.equal(jobPollDelay({ polls: 50 }), 15000);
  assert.ok(jobPollDelay({ polls: 999 }) <= 15000);
});

test('jobPollDelay: a hidden tab drops to the slowest cadence immediately', () => {
  assert.equal(jobPollDelay({ polls: 0, hidden: true }), 15000);
  assert.equal(jobPollDelay({ polls: 99, hidden: true }), 15000);
});

test('jobPollDelay: never returns a value that would busy-loop', () => {
  for (const p of [0, 3, 13, 40]) assert.ok(jobPollDelay({ polls: p }) >= 2500);
});

// ---------------- budget pressure (assessment item #5) ----------------

test('livePollDelay: a budget factor widens the interval beyond the normal cap', () => {
  assert.equal(livePollDelay({ idlePolls: 0, factor: 1 }), 20000);
  assert.equal(livePollDelay({ idlePolls: 0, factor: 3 }), 60000);
  assert.equal(livePollDelay({ idlePolls: 3, factor: 3 }), 180000);   // past the normal 60s ceiling
});

test('livePollDelay: even critical pressure stays under a hard ceiling', () => {
  assert.equal(livePollDelay({ idlePolls: 3, factor: 8 }), 300000);   // 5 min, not 8 minutes
  assert.ok(livePollDelay({ idlePolls: 99, factor: 1000 }) <= 300000);
});

test('jobPollDelay: a budget factor widens it, under its own hard ceiling', () => {
  assert.equal(jobPollDelay({ polls: 0, factor: 1 }), 2500);
  assert.equal(jobPollDelay({ polls: 0, factor: 3 }), 7500);
  assert.equal(jobPollDelay({ polls: 50, factor: 8 }), 60000);        // 1 min ceiling
  assert.ok(jobPollDelay({ polls: 99, factor: 1000 }) <= 60000);
});

test('a missing or nonsense factor never produces NaN in a timer', () => {
  for (const f of [undefined, null, 0, -5, NaN]) {
    assert.ok(Number.isFinite(livePollDelay({ idlePolls: 1, factor: f })));
    assert.ok(Number.isFinite(jobPollDelay({ polls: 1, factor: f })));
    assert.ok(livePollDelay({ idlePolls: 1, factor: f }) >= 20000);
  }
});

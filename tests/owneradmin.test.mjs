// Lane D — owner admin pure helpers: one-click invite readiness, config health-check signals,
// reviewer status-board aggregation, and soft-delete/restore planning. All I/O stays in app.js;
// this module is pure so the decision logic is unit-tested (red→green).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inviteReadiness,
  healthSignals,
  reviewerStatus,
  restoreAdvisorPlan,
  renderBuiltStatus,
  emailTestOutcome,
} from '../js/owneradmin.js';

// ---- emailTestOutcome: a green run must never read as "failed" on a stale email_test read ----
test('emailTestOutcome never reports a successful run as failed while the result is stale (the bug)', () => {
  // fresh result, ok → success confirmed
  assert.deepEqual(emailTestOutcome({ conclusion:'success', emailTest:{ ok:true, ts:'T2' }, beforeTs:'T1' }),
    { failed:false, confirmed:true });
  // run succeeded but email_test hasn't propagated (ts unchanged) → NOT failed (was the "run concluded: success" bug)
  assert.equal(emailTestOutcome({ conclusion:'success', emailTest:{ ok:false, ts:'T1' }, beforeTs:'T1' }).failed, false);
  // run succeeded, no email_test at all yet → NOT failed
  assert.equal(emailTestOutcome({ conclusion:'success', emailTest:null, beforeTs:'T1' }).failed, false);
});
test('emailTestOutcome reports a real failure only on a failed run or a FRESH ok:false result', () => {
  // fresh result explicitly failed → failed with its error
  assert.deepEqual(emailTestOutcome({ conclusion:'success', emailTest:{ ok:false, ts:'T2', error:'535 auth' }, beforeTs:'T1' }),
    { failed:true, error:'535 auth' });
  // the workflow run itself failed → failed
  assert.equal(emailTestOutcome({ conclusion:'failure', emailTest:null, beforeTs:'' }).failed, true);
});

// ---- renderBuiltStatus: preflight "reading view built" must require EVERY released unit ----
test('renderBuiltStatus is green only when every released unit is built (no partial false-green)', () => {
  // all released units built → green
  assert.equal(renderBuiltStatus({ allUnitIds:['a','b','c'], releasedUnitIds:['a','b'], builtUnitIds:['a','b'] }), true);
  // one released unit NOT built → amber (this is the false-green the strictness fixes)
  assert.equal(renderBuiltStatus({ allUnitIds:['a','b','c'], releasedUnitIds:['a','b'], builtUnitIds:['a'] }), false);
});
test('renderBuiltStatus falls back to all units when nothing is released yet', () => {
  // nothing released, whole doc built → green (a rendered-but-not-yet-released doc still reads as built)
  assert.equal(renderBuiltStatus({ allUnitIds:['a','b'], releasedUnitIds:[], builtUnitIds:['a','b'] }), true);
  // nothing released, doc only partly built → amber
  assert.equal(renderBuiltStatus({ allUnitIds:['a','b'], releasedUnitIds:[], builtUnitIds:['a'] }), false);
  // no units at all → amber (nothing to be built)
  assert.equal(renderBuiltStatus({ allUnitIds:[], releasedUnitIds:[], builtUnitIds:[] }), false);
});

// ---- 1. One-click invite readiness ---------------------------------------
test('inviteReadiness: name required', () => {
  const r = inviteReadiness({ name: '', email: 'a@b.com', emailConfigured: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /name/i);
});

test('inviteReadiness: email + email configured → will auto-send', () => {
  const r = inviteReadiness({ name: 'Dr Vega', email: 'v@lab.edu', emailConfigured: true });
  assert.equal(r.ok, true);
  assert.equal(r.willSend, true);
  assert.match(r.message, /invite/i);
});

test('inviteReadiness: email given but email NOT configured → added, share link, no send', () => {
  const r = inviteReadiness({ name: 'Dr Vega', email: 'v@lab.edu', emailConfigured: false });
  assert.equal(r.ok, true);
  assert.equal(r.willSend, false);
  assert.equal(r.needsEmailSetup, true);
  assert.match(r.message, /link/i);
});

test('inviteReadiness: no email → added, share the link yourself, never needs email setup nag', () => {
  const r = inviteReadiness({ name: 'Dr Vega', email: '', emailConfigured: true });
  assert.equal(r.ok, true);
  assert.equal(r.willSend, false);
  assert.equal(r.needsEmailSetup, false);
  assert.match(r.message, /link/i);
});

test('inviteReadiness: rejects a clearly malformed email', () => {
  const r = inviteReadiness({ name: 'X', email: 'not-an-email', emailConfigured: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /email/i);
});

// ---- 2. Config health-check signals --------------------------------------
const allGood = {
  keySet: true,
  emailConfigured: true,
  renderBuilt: true,
  anyReleased: true,
  tokenCanWrite: true,
};

test('healthSignals: all green when everything is set', () => {
  const s = healthSignals(allGood);
  assert.equal(s.length, 5);
  assert.ok(s.every(x => x.status === 'green'), JSON.stringify(s));
  assert.equal(s.filter(x => x.status === 'amber').length, 0);
});

test('healthSignals: each missing signal turns amber with a concrete next step', () => {
  for (const k of Object.keys(allGood)) {
    const s = healthSignals({ ...allGood, [k]: false });
    const bad = s.find(x => x.key === k);
    assert.ok(bad, `signal ${k} present`);
    assert.equal(bad.status, 'amber', `${k} amber`);
    assert.ok(bad.next && bad.next.length > 5, `${k} has a next step`);
  }
});

test('healthSignals: stable key set (order-independent lookup)', () => {
  const keys = healthSignals(allGood).map(s => s.key).sort();
  assert.deepEqual(keys, ['anyReleased', 'emailConfigured', 'keySet', 'renderBuilt', 'tokenCanWrite']);
});

test('healthSignals: tokenCanWrite unknown → amber, not a false green', () => {
  const s = healthSignals({ ...allGood, tokenCanWrite: null });
  assert.equal(s.find(x => x.key === 'tokenCanWrite').status, 'amber');
});

// ---- 3. Reviewer status board --------------------------------------------
test('reviewerStatus: aggregates released units, comment count, last activity, invite state', () => {
  const rows = reviewerStatus({
    advisors: [
      { id: 'vega-ab12', name: 'Dr Vega', email: 'v@lab.edu', invited: true, invited_ts: '2026-07-01T00:00:00Z' },
      { id: 'ng-cd34', name: 'Sam Ng', email: '', invited: false },
    ],
    release: {
      'vega-ab12': { released: ['ch1', 'ch2'], responses_released: true },
      'ng-cd34': { released: [] },
    },
    inbox: {
      'vega-ab12': [{ chapter: 'ch1', c: { status: 'submitted' } }, { chapter: 'ch2', c: { status: 'submitted' } }],
      'ng-cd34': [],
    },
    presence: {
      'vega-ab12': { lastActive: '2026-07-05T10:00:00Z', drafts: 1 },
    },
  });
  assert.equal(rows.length, 2);
  const v = rows.find(r => r.id === 'vega-ab12');
  assert.equal(v.releasedCount, 2);
  assert.equal(v.commentCount, 2);
  assert.equal(v.lastActive, '2026-07-05T10:00:00Z');
  assert.equal(v.inviteStatus, 'invited');
  const n = rows.find(r => r.id === 'ng-cd34');
  assert.equal(n.releasedCount, 0);
  assert.equal(n.commentCount, 0);
  assert.equal(n.inviteStatus, 'no-email');
  assert.equal(n.lastActive, null);
});

test('reviewerStatus: invite states map correctly (pending / failed / invited / no-email)', () => {
  const rows = reviewerStatus({
    advisors: [
      { id: 'a', name: 'A', email: 'a@x.com', invited: false },
      { id: 'b', name: 'B', email: 'b@x.com', invite_error: 'SMTP 535' },
      { id: 'c', name: 'C', email: 'c@x.com', invited: true },
      { id: 'd', name: 'D', email: '' },
    ],
    release: {}, inbox: {}, presence: {},
  });
  const by = Object.fromEntries(rows.map(r => [r.id, r.inviteStatus]));
  assert.equal(by.a, 'pending');
  assert.equal(by.b, 'failed');
  assert.equal(by.c, 'invited');
  assert.equal(by.d, 'no-email');
});

test('reviewerStatus: does NOT invent an "opened the link" signal (only derivable fields)', () => {
  const rows = reviewerStatus({
    advisors: [{ id: 'a', name: 'A', email: 'a@x.com', invited: true }],
    release: {}, inbox: {}, presence: {},
  });
  assert.equal('opened' in rows[0], false);
});

// ---- 4. Soft-delete / restore planning -----------------------------------
test('restoreAdvisorPlan: re-adds a removed reviewer to advisors + release from a tombstone', () => {
  const tomb = {
    advisor: { id: 'vega-ab12', name: 'Dr Vega', email: 'v@lab.edu' },
    release: { name: 'Dr Vega', released: ['ch1'], responses_released: true },
  };
  const reg = { advisors: [{ id: 'other', name: 'Other' }] };
  const rel = { other: { released: [] } };
  const plan = restoreAdvisorPlan(tomb, reg, rel);
  assert.ok(plan.advisors.find(a => a.id === 'vega-ab12'), 'reviewer re-added');
  assert.ok(plan.release['vega-ab12'], 'release entry restored');
  assert.deepEqual(plan.release['vega-ab12'].released, ['ch1'], 'their unit access restored');
  // non-destructive to others
  assert.ok(plan.advisors.find(a => a.id === 'other'));
  assert.ok(plan.release.other);
});

test('restoreAdvisorPlan: is idempotent — restoring an already-present reviewer does not duplicate', () => {
  const tomb = { advisor: { id: 'vega-ab12', name: 'Dr Vega' }, release: { name: 'Dr Vega', released: [] } };
  const reg = { advisors: [{ id: 'vega-ab12', name: 'Dr Vega' }] };
  const rel = { 'vega-ab12': { released: ['ch1'] } };
  const plan = restoreAdvisorPlan(tomb, reg, rel);
  assert.equal(plan.advisors.filter(a => a.id === 'vega-ab12').length, 1, 'no duplicate advisor');
});

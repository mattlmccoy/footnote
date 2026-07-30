import { test } from 'node:test'; import assert from 'node:assert/strict';
import { builtMarker, staleness, sourceStatusLabel, sourceStatusShort, fmtWhen } from '../js/sourcestatus.js';

// ---------------- builtMarker: reduce content/built.json to the project's build ceiling ----------------
// built.json (ci_render write_build_manifest / stamp_built) = { unitId: { sha, ts } }. The reading view is
// only as current as its STALEST unit, so the project's build point is the unit with the oldest ts.

test('builtMarker: empty / missing manifest -> no build point', () => {
  assert.deepEqual(builtMarker({}), { sha: '', ts: '', builtCount: 0 });
  assert.deepEqual(builtMarker(null), { sha: '', ts: '', builtCount: 0 });
});

test('builtMarker: single unit -> that unit is the build point', () => {
  assert.deepEqual(builtMarker({ ch_a: { sha: 'aaa', ts: '2026-07-30T10:00:00Z' } }),
    { sha: 'aaa', ts: '2026-07-30T10:00:00Z', builtCount: 1 });
});

test('builtMarker: many units -> the STALEST (oldest ts) unit is the ceiling', () => {
  const m = {
    ch_a: { sha: 'newer', ts: '2026-07-30T12:00:00Z' },
    ch_b: { sha: 'older', ts: '2026-07-30T09:00:00Z' },
    ch_c: { sha: 'mid',   ts: '2026-07-30T11:00:00Z' },
  };
  assert.deepEqual(builtMarker(m), { sha: 'older', ts: '2026-07-30T09:00:00Z', builtCount: 3 });
});

test('builtMarker: units without a sha do not count as built', () => {
  const m = { ch_a: { sha: '', ts: '2026-07-30T09:00:00Z' }, ch_b: { sha: 'bbb', ts: '2026-07-30T10:00:00Z' } };
  assert.deepEqual(builtMarker(m), { sha: 'bbb', ts: '2026-07-30T10:00:00Z', builtCount: 1 });
});

// ---------------- staleness: owner-facing project summary (all inputs already fetched) ----------------

const base = { sourceRepo: 'me/thesis', builtSha: 'aaa', headSha: 'aaa', headDate: '2026-07-30T09:00:00Z', ahead: 0, rendered: true };

test('staleness: no source repo -> nosource, never a rebuild', () => {
  const s = staleness({ ...base, sourceRepo: '' });
  assert.equal(s.state, 'nosource');
  assert.equal(s.needsRebuild, false);
});

test('staleness: source HEAD unknown -> unknown, NOT healthy, no false rebuild', () => {
  const s = staleness({ ...base, headSha: '' });
  assert.equal(s.state, 'unknown');
  assert.equal(s.needsRebuild, false);   // we cannot know it needs one
});

test('staleness: source known but view not built yet -> notbuilt, needs rebuild', () => {
  const s = staleness({ ...base, rendered: false, builtSha: '' });
  assert.equal(s.state, 'notbuilt');
  assert.equal(s.needsRebuild, true);
});

test('staleness: built sha equals source HEAD -> uptodate', () => {
  const s = staleness({ ...base, builtSha: 'aaa', headSha: 'aaa', ahead: null });
  assert.equal(s.state, 'uptodate');
  assert.equal(s.needsRebuild, false);
  assert.equal(s.lastUpdated, '2026-07-30T09:00:00Z');
});

test('staleness: shas differ but compare says ahead 0 -> uptodate', () => {
  const s = staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: 0 });
  assert.equal(s.state, 'uptodate');
});

test('staleness: source ahead of built -> behind, with the commit count, needs rebuild', () => {
  const s = staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: 3 });
  assert.equal(s.state, 'behind');
  assert.equal(s.behind, 3);
  assert.equal(s.needsRebuild, true);
  assert.equal(s.lastUpdated, '2026-07-30T09:00:00Z');
});

test('staleness: shas differ, ahead uncomputable -> behind with null count, still needs rebuild', () => {
  const s = staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: null });
  assert.equal(s.state, 'behind');
  assert.equal(s.behind, null);
  assert.equal(s.needsRebuild, true);
});

// ---------------- staleness: timestamp fallback when the view is rendered but has no built.json ----------
// Real repos built by an older render pipeline have content/*.html but no manifest. That must read as
// rendered (up to date / behind by timestamps), never as "not built yet".

test('staleness: rendered without a manifest, source newer than the render -> behind (not "not built")', () => {
  const s = staleness({ sourceRepo: 'me/s', headSha: 'H', headDate: '2026-07-30T12:00:00Z',
    builtSha: '', rendered: true, renderedAt: '2026-07-30T09:00:00Z', sourceAt: '2026-07-30T12:00:00Z' });
  assert.equal(s.state, 'behind');
  assert.equal(s.needsRebuild, true);
  assert.equal(s.lastUpdated, '2026-07-30T12:00:00Z');
});

test('staleness: rendered without a manifest, render at/after the source -> uptodate', () => {
  const s = staleness({ sourceRepo: 'me/s', headSha: 'H', headDate: '2026-07-30T09:00:00Z',
    builtSha: '', rendered: true, renderedAt: '2026-07-30T12:00:00Z', sourceAt: '2026-07-30T09:00:00Z' });
  assert.equal(s.state, 'uptodate');
  assert.equal(s.needsRebuild, false);
});

test('staleness: rendered but no manifest and no timestamps -> unknown, never false-healthy', () => {
  const s = staleness({ sourceRepo: 'me/s', headSha: 'H', headDate: null, builtSha: '', rendered: true });
  assert.equal(s.state, 'unknown');
  assert.equal(s.needsRebuild, false);
});

// ---------------- sourceStatusLabel: owner copy (NO em dashes anywhere) ----------------

const noEmDash = s => assert.ok(!s.includes('—'), `label must not contain an em dash: ${s}`);

test('sourceStatusLabel: uptodate names the source date', () => {
  const l = sourceStatusLabel(staleness({ ...base, builtSha: 'aaa', headSha: 'aaa', ahead: 0 }));
  assert.equal(l, 'Up to date as of Jul 30, 2026');
  noEmDash(l);
});

test('sourceStatusLabel: behind with a count', () => {
  const l = sourceStatusLabel(staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: 3 }));
  assert.equal(l, '3 commits behind, source updated Jul 30, 2026');
  noEmDash(l);
});

test('sourceStatusLabel: one commit behind is singular', () => {
  const l = sourceStatusLabel(staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: 1 }));
  assert.equal(l, '1 commit behind, source updated Jul 30, 2026');
});

test('sourceStatusLabel: behind with unknown count still reads as pending', () => {
  const l = sourceStatusLabel(staleness({ ...base, builtSha: 'aaa', headSha: 'bbb', ahead: null }));
  assert.equal(l, 'Source updated Jul 30, 2026, rebuild pending');
  noEmDash(l);
});

test('sourceStatusLabel: notbuilt / unknown / nosource each read honestly, never as healthy', () => {
  assert.equal(sourceStatusLabel(staleness({ ...base, rendered: false, builtSha: '' })), 'Not built yet');
  assert.equal(sourceStatusLabel(staleness({ ...base, headSha: '' })), 'Source status unavailable');
  assert.equal(sourceStatusLabel(staleness({ ...base, sourceRepo: '' })), 'No linked source repo');
});

// ---------------- sourceStatusShort: terse label for the space-constrained reading topbar ----------------

test('sourceStatusShort: terse per state, no dates, no em dashes', () => {
  const short = st => sourceStatusShort(st);
  const noEm = s => assert.ok(!s.includes('—'), s);
  const up = short(staleness({ ...base, builtSha: 'a', headSha: 'a', ahead: 0 }));
  assert.equal(up, 'up to date'); noEm(up);
  assert.equal(short(staleness({ ...base, builtSha: 'a', headSha: 'b', ahead: 3 })), '3 behind');
  assert.equal(short(staleness({ ...base, builtSha: 'a', headSha: 'b', ahead: 1 })), '1 behind');
  assert.equal(short(staleness({ ...base, builtSha: 'a', headSha: 'b', ahead: null })), 'behind');
  assert.equal(short(staleness({ ...base, rendered: false, builtSha: '' })), 'not built');
  assert.equal(short(staleness({ ...base, headSha: '' })), 'source ?');
  assert.equal(short(staleness({ ...base, sourceRepo: '' })), 'no source');
});

// ---------------- fmtWhen: deterministic short date, no locale surprises ----------------

test('fmtWhen: ISO -> "Mon D, YYYY"', () => {
  assert.equal(fmtWhen('2026-07-30T09:00:00Z'), 'Jul 30, 2026');
  assert.equal(fmtWhen('2026-01-05T23:59:00Z'), 'Jan 5, 2026');
});

test('fmtWhen: missing / bad input -> empty string, never "Invalid Date"', () => {
  assert.equal(fmtWhen(''), '');
  assert.equal(fmtWhen(null), '');
  assert.equal(fmtWhen('not-a-date'), '');
});

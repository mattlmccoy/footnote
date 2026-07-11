// tests/sourceinfo.test.mjs
// The browser must recognize an EXTERNAL source repo the same way the cloud does — including one recorded
// ONLY in the committed <prefix>source.json marker (the rfam case: phd-dissertation as source of truth,
// dissertation-tracker-data as the Review repo). Pure helpers, unit-tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceMarkerRepo, repoOwner, resolveSourceInfo } from '../js/config.js';

test('sourceMarkerRepo extracts sourceRepo from a parsed source.json (else empty)', () => {
  assert.equal(sourceMarkerRepo({ sourceRepo: 'mattlmccoy/phd-dissertation' }), 'mattlmccoy/phd-dissertation');
  assert.equal(sourceMarkerRepo({ sourceRepo: '  a/b  ' }), 'a/b');
  assert.equal(sourceMarkerRepo({}), '');
  assert.equal(sourceMarkerRepo(null), '');
  assert.equal(sourceMarkerRepo('nope'), '');
});

test('repoOwner returns the owner segment of owner/repo', () => {
  assert.equal(repoOwner('mattlmccoy/phd-dissertation'), 'mattlmccoy');
  assert.equal(repoOwner('org/x'), 'org');
  assert.equal(repoOwner(''), '');
  assert.equal(repoOwner('noslash'), '');
});

test('resolveSourceInfo: source living inside the Review/Workspace repo is NOT external', () => {
  // uploaded-into-workspace: srcPrefix set, source is under the data repo
  const r = resolveSourceInfo({ sourceRepo: 'me/ws', dataRepo: 'me/ws', srcPrefix: 'p/source/' }, '');
  assert.equal(r.external, false);
  // legacy: sourceRepo empty, no marker
  assert.equal(resolveSourceInfo({ sourceRepo: '', dataRepo: 'me/data', srcPrefix: '' }, '').external, false);
});

test('resolveSourceInfo: external via project.sourceRepo', () => {
  const r = resolveSourceInfo({ sourceRepo: 'me/src', dataRepo: 'me/data', srcPrefix: '' }, '');
  assert.equal(r.external, true);
  assert.equal(r.repo, 'me/src');
  assert.equal(r.owned, true);   // same owner as the data repo → Owner key covers it
});

test('resolveSourceInfo: rfam — external via the source.json MARKER even when project.sourceRepo is empty', () => {
  // the exact rfam shape: browser has no project.sourceRepo; the marker names phd-dissertation
  const r = resolveSourceInfo(
    { sourceRepo: '', dataRepo: 'mattlmccoy/dissertation-tracker-data', srcPrefix: '' },
    'mattlmccoy/phd-dissertation');
  assert.equal(r.external, true);
  assert.equal(r.repo, 'mattlmccoy/phd-dissertation');
  assert.equal(r.owned, true);   // Matt owns both → Owner key reaches the source
});

test('resolveSourceInfo: a THIRD-PARTY source (different owner) is external AND not owned', () => {
  const r = resolveSourceInfo({ sourceRepo: 'someoneelse/paper', dataRepo: 'me/data', srcPrefix: '' }, '');
  assert.equal(r.external, true);
  assert.equal(r.owned, false);
});

test('resolveSourceInfo: a marker pointing back at the data repo is not external', () => {
  const r = resolveSourceInfo({ sourceRepo: '', dataRepo: 'me/data', srcPrefix: '' }, 'me/data');
  assert.equal(r.external, false);
});

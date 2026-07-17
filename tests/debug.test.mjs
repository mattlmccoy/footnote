// tests/debug.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySync } from '../js/debug.js';
import { rollupProject } from '../js/debug.js';
import { parseScopes, diffScopes, REQUIRED_SCOPES } from '../js/debug.js';
import { queueAge } from '../js/debug.js';

// job ids encode the ms timestamp in base36: 'j_' + Date.now().toString(36)
const jid = ms => 'j_' + ms.toString(36);

test('classifySync: not rendered → nyr', () => {
  assert.deepEqual(classifySync({ rendered: false, builtFrom: '', mainSha: 'abc', ahead: null, fileTouched: null }),
    { state: 'nyr', label: 'not rendered', fill: 0 });
  assert.equal(classifySync({ rendered: true, builtFrom: '', mainSha: 'abc', ahead: null, fileTouched: null }).state, 'nyr');
});

test('classifySync: built_from equals main HEAD → insync', () => {
  assert.deepEqual(classifySync({ rendered: true, builtFrom: 'abc123', mainSha: 'abc123', ahead: null, fileTouched: null }),
    { state: 'insync', label: 'in sync', fill: 100 });
});

test('classifySync: ahead 0 → insync even if shas differ', () => {
  assert.equal(classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 0, fileTouched: false }).state, 'insync');
});

test('classifySync: behind and the doc file changed → behind-touched', () => {
  const v = classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 3, fileTouched: true });
  assert.equal(v.state, 'behind-touched');
  assert.equal(v.label, '3 behind');
  assert.ok(v.fill > 0 && v.fill < 100);
});

test('classifySync: behind but the doc file was untouched → behind-untouched', () => {
  const v = classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 2, fileTouched: false });
  assert.equal(v.state, 'behind-untouched');
  assert.equal(v.label, '2 behind · file untouched');
});

test('classifySync: main HEAD unknown → unknown', () => {
  assert.equal(classifySync({ rendered: true, builtFrom: 'aaa', mainSha: '', ahead: null, fileTouched: null }).state, 'unknown');
});

test('classifySync: rendered + behind but ahead uncomputed (compare failed) → unknown', () => {
  assert.equal(classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: null, fileTouched: null }).state, 'unknown');
});

test('rollupProject: counts docs, behind, open; worst status wins', () => {
  const docs = [{ state: 'insync' }, { state: 'behind-untouched' }, { state: 'behind-touched' }];
  assert.deepEqual(rollupProject(docs, 4), { docCount: 3, behind: 2, open: 4, worst: 'behind-touched' });
});

test('rollupProject: a missing/nyr doc is the worst', () => {
  assert.equal(rollupProject([{ state: 'insync' }, { state: 'nyr' }], 0).worst, 'nyr');
});

test('rollupProject: all in sync → worst is insync, behind 0', () => {
  assert.deepEqual(rollupProject([{ state: 'insync' }, { state: 'insync' }], 0),
    { docCount: 2, behind: 0, open: 0, worst: 'insync' });
});

test('rollupProject: no docs → empty rollup', () => {
  assert.deepEqual(rollupProject([], 0), { docCount: 0, behind: 0, open: 0, worst: 'insync' });
});

test('parseScopes: comma list → trimmed array; empty → []; null → null', () => {
  assert.deepEqual(parseScopes('repo, workflow'), ['repo', 'workflow']);
  assert.deepEqual(parseScopes(''), []);
  assert.equal(parseScopes(null), null);
});

test('REQUIRED_SCOPES is the classic owner-login set', () => {
  assert.deepEqual(REQUIRED_SCOPES, ['repo', 'workflow']);
});

test('diffScopes: all present → ok; missing flagged', () => {
  assert.deepEqual(diffScopes(['repo', 'workflow'], REQUIRED_SCOPES), { ok: true, missing: [] });
  assert.deepEqual(diffScopes(['repo'], REQUIRED_SCOPES), { ok: false, missing: ['workflow'] });
});

test('diffScopes: unknown scopes (fine-grained token, null) → indeterminate', () => {
  assert.deepEqual(diffScopes(null, REQUIRED_SCOPES), { ok: null, missing: [] });
});

test('queueAge: empty queue', () => {
  assert.deepEqual(queueAge([], 1000), { count: 0, oldest: null });
});

test('queueAge: picks the oldest by id timestamp', () => {
  const now = 10_000;
  const jobs = [{ id: jid(9000), type: 'render' }, { id: jid(6000), type: 'apply-edits' }];
  assert.deepEqual(queueAge(jobs, now), { count: 2, oldest: { type: 'apply-edits', ageMs: 4000 } });
});

test('queueAge: job whose id has no parseable ts still counts, age null', () => {
  assert.deepEqual(queueAge([{ id: 'weird', type: 'export' }], 5000), { count: 1, oldest: { type: 'export', ageMs: null } });
});

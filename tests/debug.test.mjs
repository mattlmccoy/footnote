// tests/debug.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySync } from '../js/debug.js';
import { rollupProject } from '../js/debug.js';
import { parseScopes, diffScopes, REQUIRED_SCOPES } from '../js/debug.js';
import { queueAge } from '../js/debug.js';
import { buildSnapshot } from '../js/debug.js';
import { collectProject } from '../js/debug.js';

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

const SAMPLE = {
  now: '2026-07-16T14:22:00Z',
  build: { deployedSha: 'e17f1b2', deployedTime: 'Jul 15, 2026 8:27 PM', pageStale: false },
  github: { login: 'mattlmccoy', tokenValid: true, scopes: ['repo', 'workflow'], rateRemaining: 4731, net: 'ok' },
  pipeline: { mode: 'local', queueCount: 1, oldestType: 'apply-edits', oldestAgeMin: 4 },
  projects: [{
    id: 'rfam-dissertation', docCount: 9, behind: 1, open: 3,
    docs: [{ id: 'ch_introduction', rendered: true, builtFrom: 'a1b2c3d', state: 'insync', open: 0 }],
  }],
  // secrets present by NAME only — values must never be handed to buildSnapshot
  secretNames: ['SMTP_USER', 'ADVISOR_KEY'],
};

test('buildSnapshot: includes build, github, pipeline, and per-doc lines', () => {
  const s = buildSnapshot(SAMPLE);
  assert.match(s, /deployed e17f1b2/);
  assert.match(s, /mattlmccoy/);
  assert.match(s, /repo, workflow/);
  assert.match(s, /rfam-dissertation/);
  assert.match(s, /ch_introduction/);
  assert.match(s, /in sync|insync/);
});

test('buildSnapshot: NEVER leaks the token or any secret value', () => {
  const withToken = { ...SAMPLE, github: { ...SAMPLE.github, token: 'ghp_SECRETVALUE123' } };
  const s = buildSnapshot(withToken);
  assert.doesNotMatch(s, /ghp_SECRETVALUE123/, 'token value must be redacted');
  assert.doesNotMatch(s, /ghp_/, 'no token prefix may appear');
});

// Minimal fake GitHub: routes by URL substring. Content endpoints return base64 JSON like the real API.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, resp] of routes) {
      if (url.includes(needle)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => resp };
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}
const b64 = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

test('collectProject: assembles per-doc verdicts (in-sync + behind-touched)', async () => {
  const project = { id: 'p1', name: 'P1', dataRepo: 'me/data', sourceRepo: 'me/src', dataPrefix: '', srcPrefix: '' };
  const chapters = [{ id: 'ch1', n: 1, title: 'One', sourceFile: 'ch1.tex' },
                    { id: 'ch2', n: 2, title: 'Two', sourceFile: 'ch2.tex' }];
  const routes = [
    ['contents/chapters.json', { content: b64(chapters) }],
    ['git/trees/main', { tree: [{ type: 'blob', path: 'content/ch1.html' }, { type: 'blob', path: 'content/ch2.html' }] }],
    ['contents/reviews/ch1.json', { content: b64({ built_from_commit: 'MAINSHA', comments: [] }) }],
    ['contents/reviews/ch2.json', { content: b64({ built_from_commit: 'OLD', comments: [{ status: 'submitted' }] }) }],
    ['commits/main', { sha: 'MAINSHA' }],
    ['compare/OLD...MAINSHA', { ahead_by: 3, files: [{ filename: 'ch2.tex' }] }],
    ['branches', [{ name: 'main' }]],
  ];
  const out = await collectProject('tok', { owner: 'me', dataRepo: 'me/hub', hubRepo: 'me/hub' }, [project], 'p1', fakeFetch(routes));
  assert.equal(out.id, 'p1');
  const d1 = out.docs.find(d => d.id === 'ch1'), d2 = out.docs.find(d => d.id === 'ch2');
  assert.equal(d1.state, 'insync');
  assert.equal(d2.state, 'behind-touched');
  assert.equal(d2.open, 1);
  assert.equal(out.rollup.behind, 1);
});

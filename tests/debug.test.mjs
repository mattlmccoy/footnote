// tests/debug.test.mjs
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
  assert.equal(classifySync({ rendered: true, builtFrom: '', mainSha: 'abc', ahead: null, fileTouched: null }).state, 'unknown');
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

test('collectProject: a failed chapters fetch surfaces an error (not false-healthy)', async () => {
  const project = { id: 'p1', name: 'P1', dataRepo: 'me/data', sourceRepo: 'me/src', dataPrefix: '' };
  const failFetch = async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) });
  const out = await collectProject('badtok', { owner: 'me', dataRepo: 'me/hub', hubRepo: 'me/hub' }, [project], 'p1', failFetch);
  assert.ok(out.error, 'a non-404 chapters failure must surface as a project error');
  assert.equal(out.docs.length, 0);
});

test('collectProject: a genuine 404 chapters (no chapters yet) is NOT an error', async () => {
  const project = { id: 'p1', name: 'P1', dataRepo: 'me/data', sourceRepo: 'me/src', dataPrefix: '' };
  const notFound = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
  const out = await collectProject('tok', { owner: 'me', dataRepo: 'me/hub', hubRepo: 'me/hub' }, [project], 'p1', notFound);
  assert.equal(out.error, undefined);
  assert.equal(out.docs.length, 0);
});

import { effectiveHubCfg } from '../js/debug.js';

test('effectiveHubCfg: localStorage hub wins; owner from login; workspaceRepo mirrors hub', () => {
  const out = effectiveHubCfg({ owner: 'your-github-username' }, 'mattlmccoy', 'mattlmccoy/footnote-projects');
  assert.equal(out.owner, 'mattlmccoy');
  assert.equal(out.hubRepo, 'mattlmccoy/footnote-projects');
  assert.equal(out.workspaceRepo, 'mattlmccoy/footnote-projects');
});

test('effectiveHubCfg: no localStorage hub → cfg.hubRepo if present', () => {
  const out = effectiveHubCfg({ owner: 'x', hubRepo: 'x/hub' }, 'me', '');
  assert.equal(out.hubRepo, 'x/hub');
});

test('effectiveHubCfg: neither → default <owner>/footnote-projects from the login', () => {
  const out = effectiveHubCfg({ owner: 'your-github-username' }, 'mattlmccoy', '');
  assert.equal(out.hubRepo, 'mattlmccoy/footnote-projects');
});

test('effectiveHubCfg: empty login falls back to cfg.owner', () => {
  const out = effectiveHubCfg({ owner: 'realowner' }, '', '');
  assert.equal(out.owner, 'realowner');
  assert.equal(out.hubRepo, 'realowner/footnote-projects');
});


test('classifySync: rendered, no built_from ref → falls back to timestamps (source newer = stale)', () => {
  const v = classifySync({ rendered: true, builtFrom: '', mainSha: '',
    renderedAt: '2026-07-01T00:00:00Z', sourceAt: '2026-07-16T00:00:00Z' });
  assert.equal(v.state, 'stale');
  assert.equal(v.label, 'source newer');
});

test('classifySync: rendered after the source last changed → up to date', () => {
  const v = classifySync({ rendered: true, builtFrom: '', mainSha: '',
    renderedAt: '2026-07-17T18:36:33Z', sourceAt: '2026-07-16T11:48:53Z' });
  assert.equal(v.state, 'insync');
  assert.equal(v.label, 'up to date');
  assert.equal(v.fill, 100);
});

test('classifySync: missing HTML beats every other signal (still not rendered)', () => {
  const v = classifySync({ rendered: false, builtFrom: 'abc', mainSha: 'abc',
    renderedAt: '2026-07-17T00:00:00Z', sourceAt: '2026-07-01T00:00:00Z' });
  assert.equal(v.state, 'nyr');
});

test('classifySync: rendered but no source file to compare → unknown, not "not rendered"', () => {
  const v = classifySync({ rendered: true, builtFrom: '', mainSha: '', renderedAt: '2026-07-17T00:00:00Z', sourceAt: null });
  assert.equal(v.state, 'unknown');
  assert.equal(v.label, 'no source ref');
});

// jobs.json is an append-only LOG of completed work, not a pending queue. The engine's own
// definition of outstanding work (data-template/ci_apply.py) is `status != "done"` — mirror it,
// or a healthy history of 57 done jobs reads as "57 pending" (a false alarm).
test('queueAge: done jobs are history, not pending', () => {
  const jobs = [{ id: jid(1000), type: 'apply-edits', status: 'done' },
                { id: jid(2000), type: 'merge', status: 'done' }];
  assert.deepEqual(queueAge(jobs, 9000), { count: 0, oldest: null });
});

test('queueAge: counts only the not-done jobs', () => {
  const jobs = [{ id: jid(1000), type: 'apply-edits', status: 'done' },
                { id: jid(5000), type: 'merge', status: 'queued' }];
  assert.deepEqual(queueAge(jobs, 9000), { count: 1, oldest: { type: 'merge', ageMs: 4000 } });
});

test('queueAge: prefers the requested_ts field over decoding the id', () => {
  const jobs = [{ id: 'exp_ch_introduction', type: 'export', requested_ts: '2026-06-26T02:13:43.003Z' }];
  const now = Date.parse('2026-06-26T02:14:43.003Z');
  assert.deepEqual(queueAge(jobs, now), { count: 1, oldest: { type: 'export', ageMs: 60000 } });
});

import { editBranchFor, humanAge, fmtRate } from '../js/debug.js';

// Verified against the real source repo: review-edits/{citations-audit,lit-citations,__outline__,outline}
test('editBranchFor: matches review-edits/<docId>, else null', () => {
  const branches = ['main', 'review-edits/__outline__', 'review-edits/citations-audit'];
  assert.equal(editBranchFor(branches, '__outline__'), 'review-edits/__outline__');
  assert.equal(editBranchFor(branches, 'ch_modeling'), null);
  assert.equal(editBranchFor(null, 'ch_modeling'), null);
});

test('humanAge: min / h / d, null passthrough', () => {
  assert.equal(humanAge(4 * 60 * 1000), '4 min');
  assert.equal(humanAge(3 * 3600 * 1000), '3 h');
  assert.equal(humanAge(2 * 86400 * 1000), '2 d');
  assert.equal(humanAge(30 * 1000), '<1 min');
  assert.equal(humanAge(null), null);
});

const NOW = 1_700_000_000_000;
const RESET = NOW + 28 * 60_000;   // 28 minutes out

test('fmtRate: says LEFT vs USED so the number cannot be misread as consumption', () => {
  // the bare "4,731 / 5,000" form was ambiguous — it never said which direction it counted
  assert.equal(fmtRate(4731, 5000, RESET, NOW), '4,731 left of 5,000 · 269 used · resets in 28 min');
});

test('fmtRate: omits the reset clause when the reset time is unknown', () => {
  assert.equal(fmtRate(4731, 5000, null, NOW), '4,731 left of 5,000 · 269 used');
});

test('fmtRate: an imminent or elapsed reset reads sensibly, never as a negative wait', () => {
  assert.match(fmtRate(12, 5000, NOW + 20_000, NOW), /resets in <1 min$/);
  assert.match(fmtRate(12, 5000, NOW - 60_000, NOW), /resets now$/);
});

test('fmtRate: an unmeasured budget stays "?" and is never rendered as healthy', () => {
  assert.equal(fmtRate(null, 5000, RESET, NOW), '?');
  assert.equal(fmtRate(undefined, 5000, RESET, NOW), '?');
});

test('fmtRate: thousands separators with a denominator', () => {
  assert.equal(fmtRate(4731, 5000), '4,731 left of 5,000 · 269 used');
  assert.equal(fmtRate(4731, null), '4,731');
  assert.equal(fmtRate(null, 5000), '?');
});

// content/built.json (written by ci_render write_build_manifest) = {unitId: {sha, ts}}.
// It makes classifySync's exact-commit path live instead of falling back to timestamps.
import { builtShaFor } from '../js/debug.js';

test('builtShaFor: reads the per-unit sha from the manifest', () => {
  const m = { ch_a: { sha: 'abc1234', ts: '2026-07-19T00:00:00Z' } };
  assert.equal(builtShaFor(m, 'ch_a'), 'abc1234');
});

test('builtShaFor: unknown unit / missing manifest → empty (never a fake ref)', () => {
  assert.equal(builtShaFor({ ch_a: { sha: 'x' } }, 'ch_b'), '');
  assert.equal(builtShaFor(null, 'ch_a'), '');
  assert.equal(builtShaFor({ ch_a: {} }, 'ch_a'), '');
});

// Bounded concurrency: the per-doc collection was sequential (14 docs ≈ 7.4s measured). Running it
// concurrently is ~12x faster, but firing 60 requests at once risks GitHub's secondary rate limits,
// so the fan-out is capped.
import { mapLimit } from '../js/debug.js';

test('mapLimit: preserves input order regardless of completion order', async () => {
  const delays = [30, 5, 20, 1];
  const out = await mapLimit(delays, 2, async (ms, i) => { await new Promise(r => setTimeout(r, ms)); return i; });
  assert.deepEqual(out, [0, 1, 2, 3]);
});

test('mapLimit: never exceeds the concurrency cap', async () => {
  let live = 0, peak = 0;
  await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--;
  });
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded cap 3`);
  assert.ok(peak > 1, 'should actually run concurrently');
});

test('mapLimit: empty input → empty output', async () => {
  assert.deepEqual(await mapLimit([], 4, async x => x), []);
});

test('mapLimit: a rejecting item does not lose the others (null in its slot)', async () => {
  const out = await mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; });
  assert.deepEqual(out, [1, null, 3]);
});

// ---- the budget shown comes from real response headers, not the lagging /rate_limit endpoint ----
import { collectGitHub } from '../js/debug.js';
// debug.js imports ratebudget through a cache-busted specifier ('./ratebudget.js?v=<hash>'), which is a
// DISTINCT module instance from an unstamped import — and ratebudget holds STATE. Resolve the exact
// specifier debug.js uses so this test resets the same singleton debug.js reads.
const _dbgSrc = readFileSync(new URL('../js/debug.js', import.meta.url), 'utf8');
const { resetBudget } = await import('../js/' + _dbgSrc.match(/from '\.\/(ratebudget\.js[^']*)'/)[1]);

const ghRes = (body, headers = {}) => ({
  ok: true, status: 200,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
});

test('collectGitHub reads the budget from response headers (authoritative + free)', async () => {
  resetBudget();
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    return ghRes({ login: 'matt' }, {
      'x-oauth-scopes': 'repo, workflow',
      'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4321',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 900),
    });
  };
  const g = await collectGitHub('tok', fake);
  assert.equal(g.rateRemaining, 4321, 'must use the header value the request actually saw');
  assert.equal(g.rateLimit, 5000);
  assert.ok(g.rateReset > Date.now());
  // /rate_limit lags behind the headers by ~100 requests, so it must not be consulted at all
  assert.ok(!seen.some(u => /\/rate_limit\b/.test(u)), 'should not call the lagging /rate_limit endpoint');
});

test('collectGitHub reports an unmeasured budget as null, never a healthy-looking number', async () => {
  resetBudget();
  const fake = async () => ghRes({ login: 'matt' }, {});          // no rate headers at all
  const g = await collectGitHub('tok', fake);
  assert.equal(g.rateRemaining, null);
  assert.equal(g.rateLimit, null);
});

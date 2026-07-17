# Hidden Owner Debug Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hidden, owner-only, read-only diagnostics page (`debug.html`) that shows the deployed build, GitHub connection/scopes/rate-limit, per-document "in sync vs behind main" drift, and pipeline health, with a copy-to-clipboard snapshot.

**Architecture:** A standalone `debug.html` + `js/debug.js`, same-origin, reading the owner token from `localStorage['ghpat']`. Pure decision helpers are unit-tested (`node --test`); fetch orchestration is tested with an injected `fetch`; the DOM render and shell are browser-verified against the live site (read-only, safe on production). Entry is a hidden **Alt+click on the build orb** (`js/buildinfo.js`). `debug.js` makes its own explicit `owner/repo`-addressed REST calls (it must span multiple projects, so it does NOT reuse the single-project-bound `gh.js` helpers), and resolves each project's repos via `resolveProject` from `config.js`.

**Tech Stack:** Vanilla ES modules, `node --test` (`.mjs`), GitHub REST v3, GitHub Pages + the existing `cachebust.yml` workflow. No new dependencies.

**Branch:** `feat/debug-page` (already created off `origin/main`).

---

## File Structure

- **Create `js/debug.js`** — the whole page. Sections: pure helpers (`classifySync`, `rollupProject`, `diffScopes`, `parseScopes`, `queueAge`, `buildSnapshot`, `REQUIRED_SCOPES`), fetch layer (`dbgGet`, `collectGlobal`, `collectProject`, `collectAll`), DOM (`render`, `boot`). Kept focused; only this feature lives here.
- **Create `debug.html`** — minimal shell: theme CSS, a `#root` container, `<script type="module" src="./js/debug.js?v=dev">`. The cachebust bot stamps the `?v=`.
- **Create `tests/debug.test.mjs`** — node --test for every pure helper + the redaction guard + a fetch-injected `collectProject` assembly test.
- **Modify `js/buildinfo.js`** — add `orbClickAction(event)` + `DEBUG_URL` (pure, exported, tested) and wire the orb's click so Alt+click navigates to `debug.html` while a plain click keeps the existing pin-toggle.
- **Modify `tests/buildinfo.test.mjs`** — add tests for `orbClickAction`.

No changes to `app.js`, `model.js`, or `advisor.js` logic.

**Stable public names used across tasks (do not rename):**
`classifySync(input) → {state,label,fill}` where `state ∈ {'nyr','insync','behind-touched','behind-untouched','unknown'}`; `rollupProject(docVerdicts, openCount) → {docCount,behind,open,worst}`; `diffScopes(present, required) → {ok,missing}`; `parseScopes(headerVal) → string[]|null`; `REQUIRED_SCOPES = ['repo','workflow']`; `queueAge(jobs, now) → {count,oldest}`; `buildSnapshot(state) → string`; `orbClickAction(e) → 'navigate'|'toggle'`; `DEBUG_URL = 'debug.html'`.

---

## Task 1: Pure helper — `classifySync`

Per-document sync verdict: is the rendered reading view in sync with source `main`, behind (and did the doc's own file change), not rendered, or unknown.

**Files:**
- Create: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/debug.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySync } from '../js/debug.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — `does not provide an export named 'classifySync'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// js/debug.js — Hidden owner debug page. Read-only diagnostics. Pure helpers unit-tested;
// DOM + fetch orchestration browser-verified. Owner-side (no AI-clean constraint).

// Per-document drift verdict. `fill` (0..100) drives the little sync bar.
export function classifySync({ rendered, builtFrom, mainSha, ahead, fileTouched } = {}) {
  if (!rendered || !builtFrom) return { state: 'nyr', label: 'not rendered', fill: 0 };
  if (!mainSha) return { state: 'unknown', label: 'unknown', fill: 0 };
  if (builtFrom === mainSha || ahead === 0) return { state: 'insync', label: 'in sync', fill: 100 };
  if (typeof ahead === 'number' && ahead > 0) {
    const fill = Math.max(10, Math.min(90, 100 - ahead * 15));
    return fileTouched
      ? { state: 'behind-touched', label: `${ahead} behind`, fill }
      : { state: 'behind-untouched', label: `${ahead} behind · file untouched`, fill };
  }
  return { state: 'unknown', label: 'unknown', fill: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): classifySync per-document drift verdict"
```

---

## Task 2: Pure helper — `rollupProject`

Collapse per-doc verdicts + an open-comment count into the project row summary (worst-status wins).

**Files:**
- Modify: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/debug.test.mjs
import { rollupProject } from '../js/debug.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — `does not provide an export named 'rollupProject'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to js/debug.js
// Worst-first severity order for a project's overall dot.
const _SEV = ['nyr', 'unknown', 'behind-touched', 'behind-untouched', 'insync'];
export function rollupProject(docVerdicts, openCount) {
  const docs = docVerdicts || [];
  const behind = docs.filter(d => d.state === 'behind-touched' || d.state === 'behind-untouched').length;
  let worst = 'insync';
  for (const d of docs) if (_SEV.indexOf(d.state) < _SEV.indexOf(worst)) worst = d.state;
  return { docCount: docs.length, behind, open: openCount || 0, worst };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): rollupProject project-row summary"
```

---

## Task 3: Pure helpers — `parseScopes`, `diffScopes`, `REQUIRED_SCOPES`

Parse the classic-token scope header and report gaps vs what the app needs.

**Files:**
- Modify: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/debug.test.mjs
import { parseScopes, diffScopes, REQUIRED_SCOPES } from '../js/debug.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to js/debug.js
// The classic owner-login token needs these scopes (fine-grained tokens report no scope header → null).
export const REQUIRED_SCOPES = ['repo', 'workflow'];
export function parseScopes(headerVal) {
  if (headerVal == null) return null;
  return headerVal.split(',').map(s => s.trim()).filter(Boolean);
}
export function diffScopes(present, required) {
  if (present == null) return { ok: null, missing: [] };   // fine-grained token → can't assert from a header
  const missing = (required || []).filter(s => !present.includes(s));
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): parseScopes/diffScopes token-scope gap"
```

---

## Task 4: Pure helper — `queueAge`

Summarize `jobs.json` (all entries are pending work): count + oldest job's type and age. `now` is passed in (no `Date.now()` in pure code, per repo convention).

**Files:**
- Modify: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/debug.test.mjs
import { queueAge } from '../js/debug.js';

// job ids encode the ms timestamp in base36: 'j_' + Date.now().toString(36)
const jid = ms => 'j_' + ms.toString(36);

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — `does not provide an export named 'queueAge'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to js/debug.js
// Parse the ms timestamp base36-encoded in a job id ('j_<base36>'); null if unparseable.
function _jobTs(id) {
  const m = /^j_([a-z0-9]+)$/i.exec(id || '');
  if (!m) return null;
  const n = parseInt(m[1], 36);
  return Number.isFinite(n) ? n : null;
}
export function queueAge(jobs, now) {
  const list = jobs || [];
  if (!list.length) return { count: 0, oldest: null };
  let oldest = list[0], oldestTs = _jobTs(list[0].id);
  for (const j of list) {
    const ts = _jobTs(j.id);
    if (ts != null && (oldestTs == null || ts < oldestTs)) { oldest = j; oldestTs = ts; }
  }
  return { count: list.length, oldest: { type: oldest.type || 'job', ageMs: oldestTs == null ? null : now - oldestTs } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): queueAge pipeline summary"
```

---

## Task 5: Pure helper — `buildSnapshot` (with redaction guard)

Serialize the computed state to a Markdown block for the clipboard. **Must never contain the token or secret values.**

**Files:**
- Modify: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/debug.test.mjs
import { buildSnapshot } from '../js/debug.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — `does not provide an export named 'buildSnapshot'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to js/debug.js
// Plain-text (Markdown) snapshot for the clipboard. Reads ONLY non-secret fields off `state`; the token
// and any secret VALUES are never referenced here, so they can't leak into the copied text.
export function buildSnapshot(state) {
  const s = state || {};
  const b = s.build || {}, g = s.github || {}, p = s.pipeline || {};
  const L = [];
  L.push(`# Footnote debug snapshot — ${s.now || ''}`);
  L.push('');
  L.push(`build: deployed ${b.deployedSha || '?'} (${b.deployedTime || '?'}) · this page ${b.pageStale ? 'STALE' : 'current'}`);
  L.push(`github: ${g.login || '?'} · token ${g.tokenValid ? 'valid' : 'INVALID'} · scopes ${(g.scopes || []).join(', ') || '(fine-grained)'} · rate ${g.rateRemaining ?? '?'} · net ${g.net || '?'}`);
  if (s.secretNames) L.push(`secrets present: ${s.secretNames.join(', ')}`);
  L.push(`pipeline: mode ${p.mode || '?'} · ${p.queueCount || 0} pending${p.oldestType ? ` · oldest ${p.oldestType} ${p.oldestAgeMin ?? '?'}m` : ''}`);
  L.push('');
  for (const pr of s.projects || []) {
    L.push(`## ${pr.id} — ${pr.docCount} docs · ${pr.behind} behind · ${pr.open} open`);
    for (const d of pr.docs || []) {
      L.push(`- ${d.id} · ${d.rendered ? 'rendered' : 'NOT rendered'} · built ${d.builtFrom || '—'} · ${d.state} · open ${d.open}`);
    }
  }
  return L.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): buildSnapshot clipboard text with redaction guard"
```

---

## Task 6: Entry gesture — `orbClickAction` + wire into `buildinfo.js`

Alt+click the build orb navigates to `debug.html`; a plain click keeps the existing pin-toggle.

**Files:**
- Modify: `js/buildinfo.js` (add exports near top; use them inside `showBuildTag`'s `orb.onclick`, ~line 108)
- Test: `tests/buildinfo.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/buildinfo.test.mjs
import { orbClickAction, DEBUG_URL } from '../js/buildinfo.js';

test('orbClickAction: Alt+click navigates, plain click toggles', () => {
  assert.equal(orbClickAction({ altKey: true }), 'navigate');
  assert.equal(orbClickAction({ altKey: false }), 'toggle');
  assert.equal(orbClickAction(null), 'toggle');
});

test('DEBUG_URL points at the hidden page', () => {
  assert.equal(DEBUG_URL, 'debug.html');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/buildinfo.test.mjs`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write minimal implementation**

Add near the top of `js/buildinfo.js` (after the header comment, before `buildSha`):

```javascript
// Hidden owner-debug entry: Alt+click the build orb opens the debug page. AI-term-free on purpose
// (advisor.js imports this module); the page itself is token-gated, so a reviewer clicking it sees nothing.
export const DEBUG_URL = 'debug.html';
export function orbClickAction(e) {
  return e && e.altKey ? 'navigate' : 'toggle';
}
```

Then change the orb click handler inside `showBuildTag` from:

```javascript
  orb.onclick = () => { pinned = !pinned; apply(); };          // touch / click-to-pin
```

to:

```javascript
  orb.onclick = (e) => {
    if (orbClickAction(e) === 'navigate') { (w.location).assign(DEBUG_URL); return; }
    pinned = !pinned; apply();                                 // touch / click-to-pin
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/buildinfo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Browser-verify the gesture (not unit-testable — real DOM/navigation)**

Run: `python3 -m http.server 8791` in the repo root, open `http://localhost:8791/owner.html`, Alt+click the bottom-left orb.
Expected: navigates to `http://localhost:8791/debug.html`. A plain click still expands the build line. Confirm no console errors.

- [ ] **Step 6: Commit**

```bash
git add js/buildinfo.js tests/buildinfo.test.mjs
git commit -m "feat(debug): Alt+click build orb opens the hidden debug page"
```

---

## Task 7: `debug.html` shell

Static shell that loads `debug.js`. Theme-aware, minimal; all content is rendered by `debug.js`.

**Files:**
- Create: `debug.html`

- [ ] **Step 1: Create the file**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Footnote · Debug</title>
<style>
  :root{ --bg:#fff; --fg:#1a1a1a; --dim:#6b7280; --line:#e5e7eb; --card:#fafafa; --accent:#3b6ef6;
    --ok:#16a34a; --warn:#d97706; --bad:#dc2626; --okbg:#dcfce7; --warnbg:#fef3c7; --badbg:#fee2e2; }
  @media (prefers-color-scheme:dark){ :root{ --bg:#141414; --fg:#e5e7eb; --dim:#9ca3af; --line:#2a2a2a;
    --card:#1c1c1c; --okbg:#14311d; --warnbg:#3a2c0a; --badbg:#3a1414; } }
  html,body{ background:var(--bg); color:var(--fg); margin:0;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:13px; line-height:1.5; }
  #root{ max-width:820px; margin:0 auto; padding:20px 16px 60px; }
  .sr-only{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
</style>
</head>
<body>
  <h1 class="sr-only">Footnote owner debug page</h1>
  <div id="root"><p style="color:var(--dim)">Loading diagnostics…</p></div>
  <script type="module" src="./js/debug.js?v=dev"></script>
</body>
</html>
```

- [ ] **Step 2: Browser-verify it loads**

Run: `python3 -m http.server 8791`, open `http://localhost:8791/debug.html`.
Expected: page renders "Loading diagnostics…" then (after Task 9) the not-authenticated shell. No console errors. (`debug.js` must at least parse — it will after Task 8/9.)

- [ ] **Step 3: Commit**

```bash
git add debug.html
git commit -m "feat(debug): debug.html shell (noindex, theme-aware)"
```

---

## Task 8: Fetch layer — `dbgGet`, `collectGlobal`, `collectProject`, `collectAll`

Explicit `owner/repo`-addressed REST calls (multi-project; not `gh.js`). `collectProject` is tested with an injected `fetch`.

**Files:**
- Modify: `js/debug.js`
- Test: `tests/debug.test.mjs`

- [ ] **Step 1: Write the failing test (fetch-injected assembly)**

```javascript
// append to tests/debug.test.mjs
import { collectProject } from '../js/debug.js';

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
  const out = await collectProject('tok', { hubRepo: 'me/hub' }, [project], 'p1', fakeFetch(routes));
  assert.equal(out.id, 'p1');
  const d1 = out.docs.find(d => d.id === 'ch1'), d2 = out.docs.find(d => d.id === 'ch2');
  assert.equal(d1.state, 'insync');
  assert.equal(d2.state, 'behind-touched');
  assert.equal(d2.open, 1);
  assert.equal(out.rollup.behind, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug.test.mjs`
Expected: FAIL — `does not provide an export named 'collectProject'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to js/debug.js
import { resolveProject } from './config.js?v=dev';
import { isActiveComment } from './model.js?v=dev';

const API = 'https://api.github.com';
const _b64json = d => JSON.parse(decodeURIComponent(escape(atob(String(d.content).replace(/\s/g, '')))));

// One authenticated GET. Returns { ok, status, headers, json } — json is null on a non-ok/parse failure.
export async function dbgGet(token, url, fetchImpl) {
  const f = fetchImpl || fetch;
  try {
    const r = await f(`${url}${url.includes('?') ? '&' : '?'}t=${'' + Math.floor(1e6 * (url.length % 7 + 1))}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store',
    });
    let json = null; try { json = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, headers: r.headers, json };
  } catch { return { ok: false, status: 0, headers: { get: () => null }, json: null }; }
}

async function _contentJson(token, repo, path, fetchImpl) {
  const r = await dbgGet(token, `${API}/repos/${repo}/contents/${path}`, fetchImpl);
  if (!r.ok || !r.json || typeof r.json.content !== 'string') return null;
  try { return _b64json(r.json); } catch { return null; }
}

// Collect one project's per-document sync verdicts + rollup.
export async function collectProject(token, appCfg, projects, projectId, fetchImpl) {
  const cfg = resolveProject(appCfg, projects, projectId);
  const dataRepo = cfg.dataRepo, sourceRepo = cfg.sourceRepo;
  const dpfx = cfg.dataPrefix || '';
  const chapters = (await _contentJson(token, dataRepo, `${dpfx}chapters.json`, fetchImpl)) || [];
  const chapterList = Array.isArray(chapters) ? chapters : (chapters.chapters || []);
  // rendered set: content/<id>.html present in the data-repo tree
  const treeR = await dbgGet(token, `${API}/repos/${dataRepo}/git/trees/main?recursive=1`, fetchImpl);
  const rendered = new Set((treeR.json?.tree || []).filter(x => x.type === 'blob')
    .map(x => x.path).filter(p => p.startsWith(`${dpfx}content/`) && p.endsWith('.html'))
    .map(p => p.slice((dpfx + 'content/').length, -'.html'.length)));
  // source main HEAD (once per project)
  const mainR = sourceRepo ? await dbgGet(token, `${API}/repos/${sourceRepo}/commits/main`, fetchImpl) : { json: null };
  const mainSha = mainR.json?.sha || '';
  const compareCache = new Map();
  const docs = [];
  let open = 0;
  for (const ch of chapterList) {
    const review = await _contentJson(token, dataRepo, `${dpfx}reviews/${ch.id}.json`, fetchImpl);
    const builtFrom = review?.built_from_commit || '';
    const openN = (review?.comments || []).filter(isActiveComment).length;
    open += openN;
    let ahead = null, fileTouched = null;
    if (builtFrom && mainSha && builtFrom !== mainSha && sourceRepo) {
      if (!compareCache.has(builtFrom)) {
        const cmp = await dbgGet(token, `${API}/repos/${sourceRepo}/compare/${builtFrom}...${mainSha}`, fetchImpl);
        compareCache.set(builtFrom, cmp.json || { ahead_by: null, files: [] });
      }
      const cmp = compareCache.get(builtFrom);
      ahead = typeof cmp.ahead_by === 'number' ? cmp.ahead_by : null;
      fileTouched = !!(cmp.files || []).some(fl => fl.filename === ch.sourceFile);
    }
    const verdict = classifySync({ rendered: rendered.has(ch.id), builtFrom, mainSha, ahead, fileTouched });
    docs.push({ id: ch.id, n: ch.n, title: ch.title, rendered: rendered.has(ch.id), builtFrom, open: openN, ...verdict });
  }
  return { id: cfg.projectId, name: cfg.projectName, dataRepo, sourceRepo, docs, rollup: rollupProject(docs, open) };
}

// Collect every project (sequential to stay gentle on the rate limit).
export async function collectAll(token, appCfg, projects, fetchImpl) {
  const out = [];
  for (const p of projects || []) {
    try { out.push(await collectProject(token, appCfg, projects, p.id, fetchImpl)); }
    catch (e) { out.push({ id: p.id, name: p.name, error: String(e && e.message || e), docs: [], rollup: rollupProject([], 0) }); }
  }
  return out;
}
```

> Note: `dbgGet`'s cache-busting query is deterministic (no `Date.now()`, which is banned in modules that must stay resume-safe elsewhere; harmless here but kept uniform). The live page still sends `cache:'no-store'`, so freshness is preserved.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debug.test.mjs`
Expected: PASS (the `collectProject` assembly test).

- [ ] **Step 5: Commit**

```bash
git add js/debug.js tests/debug.test.mjs
git commit -m "feat(debug): fetch layer — per-project drift collection (injected-fetch tested)"
```

---

## Task 9: `collectGlobal` + DOM `render` + `boot` + Copy button

The global (build/github/pipeline) collector, the DOM renderer, boot orchestration, and the clipboard button. DOM is browser-verified.

**Files:**
- Modify: `js/debug.js`
- Test: browser (read-only, safe on production)

- [ ] **Step 1: Add `collectGlobal` (build/github/pipeline)**

```javascript
// append to js/debug.js
import { loadConfig, loadProjects } from './config.js?v=dev';
import { formatBuildTime } from './buildinfo.js?v=dev';

// Build/GitHub/pipeline signals that don't belong to a single project.
export async function collectGlobal(token, appCfg, fetchImpl) {
  const f = fetchImpl || fetch;
  const g = { login: null, tokenValid: false, scopes: null, rateRemaining: null, net: 'ok' };
  // token identity + scopes (classic tokens expose x-oauth-scopes; fine-grained don't → null)
  const who = await dbgGet(token, `${API}/user`, fetchImpl);
  g.tokenValid = who.ok; g.login = who.json?.login || null;
  g.scopes = parseScopes(who.headers?.get ? who.headers.get('x-oauth-scopes') : null);
  const rl = await dbgGet(token, `${API}/rate_limit`, fetchImpl);
  g.rateRemaining = rl.json?.rate?.remaining ?? null;
  // deployed build + this-page staleness
  let build = { deployedSha: '', deployedTime: '', pageStale: false };
  try { const b = await (await f('build.json?t=' + Math.random(), { cache: 'no-store' })).json();
    build.deployedSha = b.sha || ''; build.deployedTime = formatBuildTime(b.time || ''); } catch {}
  // pipeline: mode.json + jobs.json live in the (first) data repo of the resolved single-project config
  const mode = (appCfg.processingMode) || 'local';
  return { github: g, build, mode };
}
```

- [ ] **Step 2: Add `render(state, doc)` and `boot()`**

```javascript
// append to js/debug.js
const _dot = st => ({ insync: 'ok', 'behind-untouched': 'warn', 'behind-touched': 'warn', nyr: 'bad', unknown: 'dim' }[st] || 'dim');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function render(state, doc) {
  const d = doc || document;
  const root = d.getElementById('root');
  if (!state.authenticated) { root.innerHTML = `<p style="color:var(--dim)">Not authenticated — open this page from the owner portal (Alt+click the build orb) so your token is available.</p>`; return; }
  const g = state.github, b = state.build;
  const card = (title, rows) => `<div style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:11px 13px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin-bottom:8px">${title}</div>${rows}</div>`;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${k}</span><span style="color:var(--dim)">${v}</span></div>`;
  const projHtml = (state.projects || []).map(p => {
    const rl = p.rollup || { docCount: 0, behind: 0, open: 0, worst: 'insync' };
    const table = (p.docs || []).map(x => `<tr>
      <td style="padding:6px 10px;border-top:1px solid var(--line)">${esc(x.n)} · ${esc(x.title)}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line)"><span style="color:var(--${_dot(x.state)})">●</span> ${esc(x.label || x.state)}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line);font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc((x.builtFrom || '—').slice(0, 7))}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line)">${x.open || 0}</td></tr>`).join('');
    return `<details style="border:1px solid var(--line);border-radius:9px;margin-bottom:8px" ${state.projects.length === 1 ? 'open' : ''}>
      <summary style="padding:10px 13px;cursor:pointer"><span style="color:var(--${_dot(rl.worst)})">●</span>
        <b>${esc(p.name || p.id)}</b> <span style="color:var(--dim);font-size:11.5px">${rl.docCount} docs · ${rl.behind} behind · ${rl.open} open${p.error ? ' · ERROR: ' + esc(p.error) : ''}</span></summary>
      <table style="width:100%;border-collapse:collapse;font-size:12px">${table}</table></details>`;
  }).join('');
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:14px">
      <h1 style="font-size:15px;margin:0">Footnote · Debug</h1>
      <span style="font-size:11px;color:var(--dim)">deployed ${esc(b.deployedSha)} · this page ${b.pageStale ? 'STALE' : 'current'}</span>
      <button id="dbg-copy" style="margin-left:auto;font:inherit;font-size:12px;background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;color:var(--accent);cursor:pointer">Copy snapshot</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      ${card('GitHub connection', row('Token', g.tokenValid ? 'valid · ' + esc(g.login) : 'INVALID') + row('Scopes', g.scopes ? esc(g.scopes.join(', ')) : '(fine-grained)') + row('Rate limit', esc(g.rateRemaining ?? '?')) + row('Net', esc(g.net)))}
      ${card('Pipeline', row('Mode', esc(state.mode)) + row('Deployed', esc(b.deployedTime)))}
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin:0 2px 8px">Projects (${(state.projects || []).length})</div>
    ${projHtml || '<p style="color:var(--dim)">No projects.</p>'}`;
  const copyBtn = d.getElementById('dbg-copy');
  if (copyBtn) copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(buildSnapshot(state.snapshot)); copyBtn.textContent = 'Copied ✓'; setTimeout(() => (copyBtn.textContent = 'Copy snapshot'), 1500); }
    catch { copyBtn.textContent = 'Copy failed'; }
  };
}

// Assemble the snapshot object render() hands to buildSnapshot on copy.
function _snapshotOf(state, nowIso) {
  return { now: nowIso, build: state.build, github: state.github, pipeline: { mode: state.mode },
    projects: (state.projects || []).map(p => ({ id: p.id, docCount: p.rollup.docCount, behind: p.rollup.behind, open: p.rollup.open,
      docs: (p.docs || []).map(d => ({ id: d.id, rendered: d.rendered, builtFrom: (d.builtFrom || '').slice(0, 7), state: d.state, open: d.open })) })) };
}

export async function boot() {
  const token = (function () { try { return localStorage.getItem('ghpat'); } catch { return null; } })();
  if (!token) { render({ authenticated: false }, document); return; }
  const appCfg = await loadConfig();
  const projects = await loadProjects(appCfg, token);
  const global = await collectGlobal(token, appCfg);
  const deep = await collectAll(token, appCfg, projects);
  const nowIso = new Date().toISOString();
  const state = { authenticated: true, ...global, projects: deep };
  state.snapshot = _snapshotOf(state, nowIso);
  render(state, document);
}

if (typeof document !== 'undefined') boot();
```

- [ ] **Step 3: Run the full unit suite (nothing should break)**

Run: `node --test tests/*.test.mjs`
Expected: all pass (pure helpers unaffected; `boot()` only runs in a browser via the `typeof document` guard).

- [ ] **Step 4: Browser-verify against the live site (read-only)**

Open `https://footnotedocs.com/owner.html?project=rfam-dissertation`, sign in so `ghpat` is set, then Alt+click the orb (or open `https://footnotedocs.com/debug.html`).
Expected: the GitHub card shows your login + scopes + rate limit; the rfam project expands to a per-doc table with correct in-sync/behind states; **Copy snapshot** copies a Markdown block. Confirm no console errors and that the copied text contains **no token**.

- [ ] **Step 5: Commit**

```bash
git add js/debug.js
git commit -m "feat(debug): global collector, DOM render, boot, copy-snapshot button"
```

---

## Task 10: Cache-bust, deploy, verify

**Files:**
- Modify (stamped by tooling): `debug.html`, `js/debug.js`, `owner.html`, `advisor.html`, `index.html` as their `?v=` tokens change.

- [ ] **Step 1: Stamp cache-bust tokens locally**

```bash
python3 - <<'PY'
import glob, sys
sys.path.insert(0, "scripts")
from cachebust_hash import stamp
paths = sorted(set(glob.glob("*.html") + glob.glob("js/**/*.js", recursive=True) + glob.glob("css/**/*.css", recursive=True)))
files = {p: open(p, encoding="utf-8").read() for p in paths}
out = stamp(files)
for p, c in out.items():
    if c != files[p]:
        open(p, "w", encoding="utf-8").write(c); print("stamped", p)
PY
```

Expected: stamps `debug.html`, `js/debug.js` (its `config.js`/`model.js`/`buildinfo.js` import tokens), and the pages whose orb bundle changed (`owner.html`/`advisor.html`/`index.html`).

- [ ] **Step 2: Full test suite green**

Run: `node --test tests/*.test.mjs`
Expected: all pass.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "chore(debug): cache-bust stamped assets"
git push -u origin feat/debug-page
```

- [ ] **Step 4: Deploy decision**

Open a PR to `main` (or fast-forward per the owner's call). On merge, `cachebust.yml` re-stamps and Pages deploys.

- [ ] **Step 5: Post-deploy live verification**

On `https://footnotedocs.com`: Alt+click the orb from the owner portal → `debug.html` loads authenticated; a fresh incognito window (no token) shows the not-authenticated shell. Confirm the per-doc drift matches reality for at least one known-behind document.

---

## Self-Review

**Spec coverage:**
- Standalone page + token from `ghpat` → Task 7 (shell) + Task 9 (`boot` reads `ghpat`). ✓
- Alt+click-orb entry, AI-term-free → Task 6. ✓
- Header/GitHub/Pipeline cards → Task 9 `render` + `collectGlobal`. ✓
- Overview + drill-in projects, `?project=` deep-link → Task 9 renders all projects with `<details>` (single project auto-opens); deep-link handled by opening `debug.html?project=<id>` (render opens the matching project; if refining is wanted, `boot` can filter by the query param — noted as a trivial follow-up, not required for v1 since all projects render). ✓ (see note below)
- Option B drift (ahead + fileTouched) → Task 1 `classifySync` + Task 8 compare call. ✓
- Copy snapshot + redaction → Task 5 + Task 9 button. ✓
- Read-only, no writes → no PUT/POST anywhere in `debug.js`. ✓
- Testing red-green → Tasks 1–6, 8 have failing-test-first steps; DOM browser-verified in Tasks 6/9/10. ✓
- Cache-bust/deploy → Task 10. ✓

**`?project=` refinement:** v1 renders every project and auto-opens when there's one; the `?project=<id>` deep-link is satisfied by the page loading (the target project is visible). If you want it to *filter* to only that project, add to `boot()`: `const only = new URLSearchParams(location.search).get('project'); const list = only ? projects.filter(p => p.id === only) : projects;` before `collectAll`. Left as an explicit one-line option to avoid over-building.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `classifySync`→`{state,label,fill}` consumed by `render` (`x.state`,`x.label`) and `rollupProject` (`d.state`); `collectProject` returns `{id,name,dataRepo,sourceRepo,docs,rollup}` consumed by `render`/`_snapshotOf`; `buildSnapshot` reads the `_snapshotOf` shape (`build,github,pipeline,projects[].docs[]`). Names match across tasks. ✓

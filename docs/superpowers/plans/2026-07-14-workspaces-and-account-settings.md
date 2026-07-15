# Workspaces + Account Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-grouping layer to the launcher, an account-level Settings page (incl. an account-wide Overleaf token), and clearer storage wording ("Shared repo" vs "Individual repo" with ⓘ) — without changing how documents are stored, rendered, or reviewed.

**Architecture:** A `workspace` label per document in the existing `projects.json` + a small `account.json` (workspaces list + Overleaf-seal tracking). Pure modules (`workspaces.js`, `account.js`, `storagecopy.js`) hold all grouping/labeling logic (unit-tested); `hub.js` renders groups + Settings + the New-Project picker (browser-gated). No data-model change; storage rename is UI wording only. `advisor.js` untouched.

**Tech Stack:** vanilla ES modules + `node:test`; GitHub Contents API via the owner token; `vendor/seal.js` (libsodium) + `ghsecrets` for sealing `OVERLEAF_TOKEN`.

**Spec:** `docs/superpowers/footnote/specs/2026-07-14-workspaces-and-account-settings-design.md`

**Baseline (keep green):** `npm test` = 547 passed. Run from the worktree root `/Users/mattmccoy/code/put_github_repos_here/footnote-ws`. Branch `feat/workspaces-account-settings` off origin/main. The cache-bust bot rewrites `?v=<sha>` on JS import lines — resolve those on rebase keeping newer shas + new symbols.

---

## File Structure

**New (pure, unit-tested):**
- `js/workspaces.js` — grouping logic: `groupByWorkspace`, `workspaceNames`, `moveDocPatch`, `defaultWorkspaceName`.
- `js/account.js` — account config: `normalizeAccount`, `overleafSealTargets`, `overleafExpiryDue`, `addWorkspace`, `removeWorkspace`.
- `js/storagecopy.js` — the storage labels + ⓘ copy (single source of truth for wording).

**New tests:** `tests/workspaces.test.mjs`, `tests/account.test.mjs`, `tests/storagecopy.test.mjs`.

**Modified:**
- `js/config.js` — add `loadAccount` / `writeAccount` (thin fetch wrappers, mirror `loadProjects`/`writeProjectPatch`).
- `js/hub.js` — grouped shelf render + card badges (M2); Settings page (M3); New-Project workspace picker + storage relabel + ⓘ (M4).

**Unchanged:** `advisor.js` (AI-clean), the storage data model, render/review/round-trip, the reviewer portal.

---

## Milestone M1 — Pure modules (the testable spine)

### Task M1.1: `workspaces.js` — grouping

**Files:** Create `js/workspaces.js`; Test `tests/workspaces.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/workspaces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByWorkspace, workspaceNames, moveDocPatch, defaultWorkspaceName } from '../js/workspaces.js';

const P = (id, workspace) => ({ id, name: id, workspace, doc: { noun: 'paper' } });

test('groupByWorkspace: one implicit group when no labels (flat, backward-compat)', () => {
  const groups = groupByWorkspace([P('a'), P('b')], { defaultWorkspace: 'My documents' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'My documents');
  assert.deepEqual(groups[0].docs.map(d => d.id), ['a', 'b']);
  assert.equal(groups[0].isOnlyGroup, true);   // caller renders flat (no header) when true
});

test('groupByWorkspace: multiple labels -> ordered groups; unlabeled -> default', () => {
  const projects = [P('a', 'PhD'), P('b', 'Consulting'), P('c')];
  const groups = groupByWorkspace(projects, { workspaces: ['PhD', 'Consulting'], defaultWorkspace: 'My documents' });
  assert.deepEqual(groups.map(g => g.name), ['PhD', 'Consulting', 'My documents']);   // config order, default last
  assert.deepEqual(groups.map(g => g.docs.map(d => d.id)), [['a'], ['b'], ['c']]);
  assert.equal(groups[0].isOnlyGroup, false);
});

test('workspaceNames: config order unioned with any labels present, default excluded', () => {
  const names = workspaceNames([P('a', 'PhD'), P('b', 'Extra')], { workspaces: ['PhD', 'Consulting'] });
  assert.deepEqual(names, ['PhD', 'Consulting', 'Extra']);
});

test('moveDocPatch + defaultWorkspaceName', () => {
  assert.deepEqual(moveDocPatch('Consulting'), { workspace: 'Consulting' });
  assert.deepEqual(moveDocPatch(''), { workspace: '' });                 // back to default
  assert.equal(defaultWorkspaceName({ defaultWorkspace: 'X' }, 'me/hub'), 'X');
  assert.equal(defaultWorkspaceName({}, 'me/footnote-projects'), 'My documents');
});
```

- [ ] **Step 2: Run it — Expected: FAIL (module missing)**

Run: `node --test tests/workspaces.test.mjs`

- [ ] **Step 3: Implement**

```javascript
// js/workspaces.js
// Pure grouping helpers for the launcher shelf. A "workspace" is a label on a document (project.workspace);
// documents with no label fall into the default workspace. NO I/O — hub.js supplies projects + accountCfg.

export function defaultWorkspaceName(accountCfg, hubRepo) {
  const name = ((accountCfg || {}).defaultWorkspace || '').trim();
  return name || 'My documents';
}

// Ordered, deduped workspace names to OFFER (config order first, then any labels actually present),
// excluding the default (which is implicit).
export function workspaceNames(projects, accountCfg) {
  const cfg = (accountCfg || {}).workspaces || [];
  const out = [];
  const push = n => { const v = (n || '').trim(); if (v && !out.includes(v)) out.push(v); };
  cfg.forEach(push);
  (projects || []).forEach(p => push(p.workspace));
  return out;
}

// Group projects into [{name, docs, isOnlyGroup}] for rendering. Config order first, the default group last;
// empty groups are omitted EXCEPT the default when it is the only group (so a fresh account renders one flat
// shelf). isOnlyGroup=true tells the caller to render without group chrome (today's flat shelf).
export function groupByWorkspace(projects, accountCfg) {
  const def = defaultWorkspaceName(accountCfg, '');
  const order = workspaceNames(projects, accountCfg);
  const buckets = new Map(order.map(n => [n, []]));
  const defaultDocs = [];
  for (const p of projects || []) {
    const w = (p.workspace || '').trim();
    if (w && buckets.has(w)) buckets.get(w).push(p);
    else defaultDocs.push(p);
  }
  const groups = [];
  for (const n of order) if (buckets.get(n).length) groups.push({ name: n, docs: buckets.get(n) });
  if (defaultDocs.length || groups.length === 0) groups.push({ name: def, docs: defaultDocs });
  const only = groups.length === 1;
  return groups.map(g => ({ ...g, isOnlyGroup: only }));
}

export function moveDocPatch(workspaceName) {
  return { workspace: (workspaceName || '').trim() };
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `node --test tests/workspaces.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add js/workspaces.js tests/workspaces.test.mjs
git commit -m "feat(workspaces): pure grouping helpers (groupByWorkspace/workspaceNames/moveDocPatch)"
```

### Task M1.2: `account.js` — account config

**Files:** Create `js/account.js`; Test `tests/account.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/account.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccount, overleafSealTargets, overleafExpiryDue, addWorkspace, removeWorkspace } from '../js/account.js';

test('normalizeAccount fills defaults', () => {
  assert.deepEqual(normalizeAccount(null), { workspaces: [], defaultWorkspace: 'My documents', overleaf: { sealedRepos: [], setAt: '' } });
  const a = normalizeAccount({ workspaces: ['A'], overleaf: { sealedRepos: ['me/r'], setAt: '2026-01-01' } });
  assert.deepEqual(a.workspaces, ['A']);
  assert.deepEqual(a.overleaf.sealedRepos, ['me/r']);
});

test('overleafSealTargets: repos that hold an Overleaf-linked doc (shared repo OR the doc own repo)', () => {
  const projects = [
    { id: 'a', workspace: 'W', dataRepo: 'me/hub', sourceRepo: '', overleaf: { bridgeRepo: 'me/a-ol' } },  // shared -> seal hub
    { id: 'b', dataRepo: 'me/b-data', sourceRepo: 'me/b-src' },                                              // not overleaf-linked
    { id: 'c', dataRepo: 'me/c-data', overleaf: { projectId: 'x' } },                                        // individual -> seal its data repo
  ];
  const cfg = { owner: 'me', hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
  assert.deepEqual(overleafSealTargets(projects, cfg).sort(), ['me/c-data', 'me/hub']);
});

test('overleafExpiryDue: ~1 year', () => {
  assert.equal(overleafExpiryDue('2025-07-01', new Date('2026-07-14')), true);   // >1yr
  assert.equal(overleafExpiryDue('2026-06-01', new Date('2026-07-14')), false);
  assert.equal(overleafExpiryDue('', new Date('2026-07-14')), false);            // never set -> not "due"
});

test('addWorkspace / removeWorkspace', () => {
  assert.deepEqual(addWorkspace({ workspaces: ['A'] }, 'B').workspaces, ['A', 'B']);
  assert.deepEqual(addWorkspace({ workspaces: ['A'] }, 'A').workspaces, ['A']);   // dedupe
  assert.deepEqual(removeWorkspace({ workspaces: ['A', 'B'] }, 'A').workspaces, ['B']);
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `node --test tests/account.test.mjs`

- [ ] **Step 3: Implement**

```javascript
// js/account.js
// Pure helpers for the account.json config (workspaces list + Overleaf-seal tracking). NO I/O.

export function normalizeAccount(raw) {
  const a = raw || {};
  const ol = a.overleaf || {};
  return {
    workspaces: Array.isArray(a.workspaces) ? a.workspaces.filter(Boolean) : [],
    defaultWorkspace: (a.defaultWorkspace || 'My documents'),
    overleaf: { sealedRepos: Array.isArray(ol.sealedRepos) ? ol.sealedRepos.filter(Boolean) : [], setAt: ol.setAt || '' },
  };
}

// The repos the account Overleaf token must be sealed into: for each Overleaf-linked doc, the repo that holds
// its source — the shared/workspace repo for a consolidated doc, else the doc's own data repo.
export function overleafSealTargets(projects, appCfg) {
  const ws = appCfg.workspaceRepo || appCfg.hubRepo;
  const out = new Set();
  for (const p of projects || []) {
    if (!(p.overleaf && (p.overleaf.bridgeRepo || p.overleaf.projectId))) continue;
    out.add(p.workspace !== undefined && (p.sourceRepo === '' || p.sourceRepo === ws || !p.sourceRepo) && (p.dataRepo === ws)
      ? ws
      : (p.dataRepo || ws));
  }
  return [...out].filter(Boolean);
}

export function overleafExpiryDue(setAt, now) {
  if (!setAt) return false;
  const set = new Date(setAt); if (isNaN(set)) return false;
  const days = (now - set) / (1000 * 60 * 60 * 24);
  return days >= 365;
}

export function addWorkspace(account, name) {
  const a = normalizeAccount(account); const n = (name || '').trim();
  if (n && !a.workspaces.includes(n)) a.workspaces = [...a.workspaces, n];
  return a;
}
export function removeWorkspace(account, name) {
  const a = normalizeAccount(account);
  a.workspaces = a.workspaces.filter(w => w !== name);
  return a;
}
```

> NOTE: `overleafSealTargets`'s consolidated-vs-individual test is simplified; align the predicate with `config.projectStorage(appCfg, p).source.inWorkspace` during implementation if the heuristic proves fragile — prefer reusing `projectStorage` over re-deriving. Keep the test as the contract.

- [ ] **Step 4: Run it — Expected: PASS**

Run: `node --test tests/account.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add js/account.js tests/account.test.mjs
git commit -m "feat(account): pure account-config helpers (normalize/sealTargets/expiry/workspaces)"
```

### Task M1.3: `storagecopy.js` — the wording (single source of truth)

**Files:** Create `js/storagecopy.js`; Test `tests/storagecopy.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/storagecopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageLabel, storageInfo, storageBadge } from '../js/storagecopy.js';

test('labels + info are the approved wording', () => {
  assert.equal(storageLabel('shared'), 'Shared repo');
  assert.equal(storageLabel('individual'), 'Individual repo');
  assert.match(storageInfo('shared'), /folder inside one repo/i);
  assert.match(storageInfo('individual'), /dedicated GitHub repos/i);
  assert.deepEqual(storageBadge('shared'), { glyph: '◧', label: 'shared repo', kind: 'shared' });
  assert.deepEqual(storageBadge('individual'), { glyph: '◇', label: 'individual repo', kind: 'individual' });
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

- [ ] **Step 3: Implement**

```javascript
// js/storagecopy.js
// Single source of truth for storage-mode wording (used by New Project, the card badges, and the ⓘ).
// "workspace" is now the GROUPING; storage is Shared repo vs Individual repo.
const LABEL = { shared: 'Shared repo', individual: 'Individual repo' };
const INFO = {
  shared: 'Lives as a folder inside one repo alongside your other documents. Fewer repos to manage; best when you have several papers.',
  individual: 'Gets its own dedicated GitHub repos — fully self-contained. Pick this to keep a document separate, or when it’s already its own Overleaf/GitHub project.',
};
export function storageLabel(kind) { return LABEL[kind] || LABEL.shared; }
export function storageInfo(kind) { return INFO[kind] || INFO.shared; }
export function storageBadge(kind) {
  return kind === 'individual'
    ? { glyph: '◇', label: 'individual repo', kind: 'individual' }
    : { glyph: '◧', label: 'shared repo', kind: 'shared' };
}
```

- [ ] **Step 4: Run it — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add js/storagecopy.js tests/storagecopy.test.mjs
git commit -m "feat(storagecopy): approved storage wording + ⓘ copy (single source of truth)"
```

### Task M1.4: `config.js` — `loadAccount` / `writeAccount`

**Files:** Modify `js/config.js`; Test: covered by the M2 browser gate (thin fetch wrapper; mirrors `loadProjects`).

- [ ] **Step 1: Add the two functions** (mirror `loadProjects`/`writeProjectPatch` exactly — same repo, `account.json`):

```javascript
// account.json in the hub repo = the account-level config (workspaces list + Overleaf-seal tracking).
export async function loadAccount(appCfg, token, fetchImpl) {
  if (!token || !appCfg.hubRepo) return null;
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null); if (!f) return null;
  try {
    const r = await f(`https://api.github.com/repos/${appCfg.hubRepo}/contents/account.json?t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r || !r.ok) return null;
    const d = await r.json();
    if (typeof d.content !== 'string') return null;
    return JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, '')))));
  } catch { return null; }
}

export async function writeAccount(appCfg, account, token, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null); if (!f) throw new Error('no fetch');
  const url = `https://api.github.com/repos/${appCfg.hubRepo}/contents/account.json`;
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha; try { const cur = await f(`${url}?t=${Date.now()}`, { headers: h, cache: 'no-store' }); if (cur && cur.ok) sha = (await cur.json()).sha; } catch {}
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(account, null, 2))));
  const r = await f(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'account: update workspaces/settings', content, ...(sha ? { sha } : {}) }) });
  if (!r || !r.ok) throw new Error(`account.json write ${r ? r.status : 'no response'}`);
}
```

- [ ] **Step 2: Verify parse**

Run: `node --check js/config.js` — Expected: OK. `npm test` — Expected: 547 still pass (no behavior change).

- [ ] **Step 3: Commit**

```bash
git add js/config.js
git commit -m "feat(config): loadAccount/writeAccount for the account.json registry"
```

---

## Milestone M2 — Grouped shelf + card badges (`js/hub.js`, browser-gated)

### Task M2.1: Render groups; single group = today's flat shelf

**Files:** Modify `js/hub.js` (the shelf render, ~lines 285–312).

- [ ] **Step 1:** Add imports (use current `?v=` shas; new modules use `?v=0000000` placeholder):

```javascript
import { groupByWorkspace, workspaceNames, moveDocPatch, defaultWorkspaceName } from './workspaces.js?v=0000000';
import { storageBadge } from './storagecopy.js?v=0000000';
import { loadAccount } from './config.js?v=eadc2bc';   // add to the existing config import
```

- [ ] **Step 2:** In the shelf render, after `list = await loadProjects(...)`, load the account + build a `bookCard(p, i)` helper (extract the existing `<a class="fn-book">…` markup) and render groups:

```javascript
const account = await loadAccount({ ...cfg, hubRepo: hub() }, tok()).catch(() => null);
const groups = groupByWorkspace(list, account);
const shelfHtml = groups.map((g, gi) => {
  const cards = g.docs.map((p, i) => bookCard(p, /* global index for spine */ list.indexOf(p))).join('');
  const addTile = `<button class="fn-book fn-book-new" data-ws="${esc(g.name)}">…＋ New document…</button>`;
  const header = g.isOnlyGroup ? '' :
    `<div class="fn-wshead"><span class="fn-wsname">${esc(g.name)}</span><span class="fn-wscount">${g.docs.length} doc${g.docs.length===1?'':'s'}</span></div>`;
  return `${header}<div class="fn-shelf">${cards}${addTile}</div>`;
}).join('');
// + a `＋ New workspace` control below when there is >1 group or any workspace configured.
```

- [ ] **Step 3: Browser gate** (serve origin/main+branch locally with a fetch-stub harness, as in the audit): with NO labels → renders one flat `.fn-shelf`, NO `.fn-wshead` (byte-compatible with today). With two labels → two `.fn-wshead` sections in config order + default last. No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/hub.js
git commit -m "feat(hub): group the shelf by workspace (flat when single workspace)"
```

### Task M2.2: Card badges (shared/individual + Overleaf)

- [ ] **Step 1:** In `bookCard`, compute `const st = projectStorage({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, p);` and add badges: `storageBadge(st.source.inWorkspace ? 'shared' : 'individual')` + an Overleaf badge when `p.overleaf`. Add minimal CSS (`.fn-badge`, `.fn-badge.shared/.individual/.ol`) to `index.html`/the launcher stylesheet.
- [ ] **Step 2: Browser gate:** a shared-repo doc shows `◧ shared repo`; an individual doc shows `◇ individual repo`; an Overleaf-linked doc shows `🔗 Overleaf`.
- [ ] **Step 3: Commit**

```bash
git add js/hub.js index.html
git commit -m "feat(hub): storage + Overleaf badges on book cards"
```

### Task M2.3: Move a document between workspaces (card `⋯`)

- [ ] **Step 1:** In the manage menu (`openManageMenu`), add "Move to workspace ▸" listing `workspaceNames(list, account)` + the default + "New workspace…"; on pick, `await writeProjectPatch({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, p.id, moveDocPatch(name), tok()); render();`. Creating a new workspace also `writeAccount(addWorkspace(account, name))`.
- [ ] **Step 2: Browser gate:** move a doc → its `projects.json` entry gains `workspace:"<name>"` (network tab) → it re-renders under the new group.
- [ ] **Step 3: Commit**

```bash
git add js/hub.js
git commit -m "feat(hub): move a document between workspaces from the card menu"
```

---

## Milestone M3 — Account Settings page (`js/hub.js`, browser-gated)

### Task M3.1: `⚙` entry + Settings scaffold

- [ ] **Step 1:** Add a `⚙` button to the launcher top bar (near `fn-signout`), opening a `renderAccountSettings()` sheet/page with three sections: GitHub access (status of `ghpat`), Overleaf (M3.2), Workspaces (M3.3).
- [ ] **Step 2: Browser gate:** `⚙` opens the page; GitHub section shows connected/not-set from `tok()`.
- [ ] **Step 3: Commit** `feat(hub): account Settings page scaffold (gear entry)`

### Task M3.2: Account Overleaf token — seal into the right repos

- [ ] **Step 1:** Import `getPublicKey, putSecret` from `ghsecrets`, `sealToBase64` from `vendor/seal.js`, `overleafSealTargets, overleafExpiryDue, normalizeAccount` from `account.js`, `writeAccount` from `config.js`. The Overleaf section: a token input + "Seal for my workspaces" → for each repo in `overleafSealTargets(list, {...cfg,hubRepo:hub(),workspaceRepo:hub()})`: `const pk = await getPublicKey(tok(), repo); await putSecret(tok(), pk, sealToBase64, 'OVERLEAF_TOKEN', val, repo);` (confirm `getPublicKey/putSecret` take a repo arg; if not, extend them minimally — they already target the data repo). Then `writeAccount(..., { ...account, overleaf:{ sealedRepos: targets, setAt: new Date().toISOString() } })`. Show the 1-year reminder when `overleafExpiryDue(account.overleaf.setAt, new Date())`.
- [ ] **Step 2: Browser gate (stub seal):** entering a token + Seal calls the seal path for each target repo (stubbed 200) and writes `account.json.overleaf`; the expiry note renders when `setAt` is >1yr old. Token never rendered back.
- [ ] **Step 3: Commit** `feat(hub): account-wide Overleaf token — seal into Overleaf-linked repos + expiry reminder`

### Task M3.3: Workspaces manager

- [ ] **Step 1:** List `account.workspaces` with rename / delete (delete → reassign that group's docs to default via `writeProjectPatch(..., { workspace: '' })` for each, then `writeAccount(removeWorkspace(...))`) + "＋ add". Create/rename/reorder persist via `writeAccount`.
- [ ] **Step 2: Browser gate:** add a workspace → appears in the New-Project picker + shelf grouping; delete a non-empty workspace → its docs move to default.
- [ ] **Step 3: Commit** `feat(hub): workspaces manager in Settings (create/rename/delete→reassign)`

---

## Milestone M4 — New Project: workspace picker + storage relabel + ⓘ

### Task M4.1: Relabel storage + add ⓘ

**Files:** Modify `js/hub.js` `newProjectSheet` (the storage segmented control).

- [ ] **Step 1:** Import `storageLabel, storageInfo`. Replace the segmented control labels "Keep it in my workspace" / "Its own repos" with `storageLabel('shared')` / `storageLabel('individual')`, each with an `ⓘ` button that toggles a tooltip showing `storageInfo(kind)`.
- [ ] **Step 2: Browser gate:** the control reads "Shared repo" / "Individual repo"; clicking each ⓘ reveals the approved copy.
- [ ] **Step 3: Commit** `feat(hub): New Project storage relabel (Shared/Individual repo) + ⓘ`

### Task M4.2: Workspace picker on New Project (+ per-group ＋)

- [ ] **Step 1:** Add a "Workspace ▾" select at the top of `newProjectSheet` populated from `workspaceNames(list, account)` + the default + "New workspace…"; default the selection to the group whose `＋ New document` was clicked (`data-ws`) or the most-recent. On create, include **`workspaceLabel: <picked>`** in the `addProject` fields — NOT `workspace` (that is the storage boolean; the grouping label is the separate `workspaceLabel` string; picking the default writes `''`). A new workspace also `writeAccount(addWorkspace)`.
- [ ] **Step 2: Browser gate:** create a doc with a workspace picked → its `projects.json` entry has `workspace:"<name>"` → renders under that group. `advisor.js` re-grep AI-clean.
- [ ] **Step 3: Commit** `feat(hub): New Project workspace picker (assigns the grouping label)`

---

## Milestone M5 — Final

- [ ] `npm test` → 547 + new pure tests, all green.
- [ ] `advisor.js` AI-grep clean: `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` → empty.
- [ ] Full browser walkthrough: single-workspace = unchanged flat shelf; multi-workspace grouping; Settings seals a token; New Project picker + ⓘ; move-between-workspaces.
- [ ] Rebase onto origin/main (resolve `?v=` cachebust on new imports, keep newer shas + new symbols); push `feat/workspaces-account-settings`.
- [ ] Report to Matt for review/merge (advisors LIVE — do NOT self-merge).

## Self-Review notes (author)
- Spec coverage: model + label (M1.1), account.json (M1.2/M1.4), wording+ⓘ (M1.3/M4.1), grouped shelf single-vs-multi (M2.1), badges (M2.2), move (M2.3), Settings GitHub/Overleaf/workspaces (M3), New-Project picker (M4.2). Backward-compat (M2.1 flat), Overleaf expiry (M1.2/M3.2).
- Type consistency: `groupByWorkspace(projects, accountCfg) -> [{name,docs,isOnlyGroup}]`, `workspaceNames -> string[]`, `moveDocPatch(name) -> {workspace}`, `overleafSealTargets(projects, appCfg) -> string[]`, `storageBadge(kind) -> {glyph,label,kind}` — used consistently.
- No placeholders except the two explicitly-flagged implementation checks (`getPublicKey/putSecret` repo-arg; `overleafSealTargets` predicate vs `projectStorage`), each with a concrete resolution + the test as contract.
- DOM tasks are browser-gated (the pure logic they depend on is unit-tested in M1).

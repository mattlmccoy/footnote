# Storage-Model Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make source/data storage location honest and consistent across the Footnote UI, and let New Project create either a consolidated-workspace or a fully-independent-repo project.

**Architecture:** One pure descriptor `projectStorage(cfg, project)` in `js/config.js` becomes the single display source of truth (no surface binds to raw `project.sourceRepo`). A pure `newProjectPlan(style, mode, name, cfg)` centralizes the New Project storage-style × source matrix. DOM surfaces (edit modal, hub card, New Project sheet) read those pure results; DOM is verified via the fetch-stubbed harness, pure logic via `node --test`.

**Tech Stack:** Vanilla ES modules, `node --test` (tests/), no build step.

**Spec:** `docs/superpowers/footnote/specs/2026-07-07-storage-model-reconciliation-design.md`

---

## File Structure

- `js/config.js` — add `projectStorage`; refactor `sourceLabel` onto it. (pure)
- `js/importdoc.js` — add `newProjectPlan`. (pure; reuses existing `planNewProjectRepos`/suggestions)
- `js/hub.js` — edit-modal source branch + "point external" reveal; card source line; New Project storage-style control + `newProjectPlan` wiring; conditional hints; Overleaf copy per style. (DOM)
- `tests/config-projectstorage.test.mjs` — new. `tests/importdoc.test.mjs` — extend. `tests/config.test.mjs` — parity + sourceLabel regression (extend existing if present, else new file).

---

## Task 1: `projectStorage` descriptor (pure)

**Files:**
- Modify: `js/config.js` (add after `resolveProject`, near `sourceLabel` ~line 176)
- Test: `tests/config-projectstorage.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

```js
// tests/config-projectstorage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStorage } from '../js/config.js';

const APP = { owner: 'me', dataRepo: 'me/footnote-projects', hubRepo: 'me/footnote-projects', workspaceRepo: 'me/footnote-projects' };

test('consolidated upload: source uploaded in workspace, data workspace', () => {
  const s = projectStorage(APP, { id: 'metro', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: '' });
  assert.equal(s.source.mode, 'uploaded');
  assert.equal(s.source.inWorkspace, true);
  assert.equal(s.source.repo, 'me/footnote-projects');
  assert.equal(s.source.prefix, 'metro/source/');
  assert.equal(s.data.dedicated, false);
  assert.equal(s.data.prefix, 'metro/');
  assert.equal(s.independent, false);
});

test('consolidated external: external source, workspace data', () => {
  const s = projectStorage(APP, { id: 'x', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: 'me/paper-src' });
  assert.equal(s.source.mode, 'external');
  assert.equal(s.source.inWorkspace, false);
  assert.equal(s.source.repo, 'me/paper-src');
  assert.equal(s.source.prefix, '');
  assert.equal(s.data.dedicated, false);
  assert.equal(s.independent, false);
});

test('fully independent: external source, dedicated data', () => {
  const s = projectStorage(APP, { id: 'diss', workspace: false, dataRepo: 'me/diss-data', sourceRepo: 'me/phd-dissertation' });
  assert.equal(s.source.mode, 'external');
  assert.equal(s.source.repo, 'me/phd-dissertation');
  assert.equal(s.data.dedicated, true);
  assert.equal(s.data.repo, 'me/diss-data');
  assert.equal(s.data.prefix, '');
  assert.equal(s.independent, true);
});

test('independent upload: uploaded to own source repo root, dedicated data', () => {
  const s = projectStorage(APP, { id: 'thesis', workspace: false, dataRepo: 'me/thesis-footnote-data', sourceRepo: 'me/thesis-source', uploaded: true });
  assert.equal(s.source.mode, 'uploaded');
  assert.equal(s.source.inWorkspace, false);
  assert.equal(s.source.repo, 'me/thesis-source');
  assert.equal(s.source.prefix, '');
  assert.equal(s.data.dedicated, true);
  assert.equal(s.independent, true);
});

test('no workspace repo configured: workspace flag degrades to legacy', () => {
  const s = projectStorage({ owner: 'me', dataRepo: 'me/d' }, { id: 'x', workspace: true, dataRepo: 'me/d', sourceRepo: 'me/src' });
  assert.equal(s.data.dedicated, true);   // no ws repo → treated as its own data repo
  assert.equal(s.source.prefix, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config-projectstorage.test.mjs`
Expected: FAIL — `projectStorage` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `js/config.js`:

```js
// Display twin of resolveProject: reports WHERE a project's source and comments actually live, so no
// UI binds to the raw project.sourceRepo string. mode 'uploaded' = Footnote committed it (in <id>/source/
// for workspace, or a dedicated source repo root); 'external' = a read-only repo the user points at.
// `independent` === data.dedicated (the project owns its comments repo, e.g. the dissertation shape).
export function projectStorage(appCfg, project) {
  const p = project || {};
  const wsRepo = appCfg.workspaceRepo || appCfg.hubRepo;
  const workspace = !!p.workspace && !!wsRepo;
  const sourceInWs = workspace && (!p.sourceRepo || p.sourceRepo === wsRepo);
  const dataRepo = workspace ? wsRepo : p.dataRepo;
  const sourceRepo = sourceInWs ? wsRepo : (p.sourceRepo || appCfg.sourceRepo || '');
  // uploaded when it lives in the workspace (<id>/source/) OR the project was flagged as an upload into
  // its own dedicated source repo (independent upload). Otherwise it's an external repo the user points at.
  const uploaded = sourceInWs || (!!p.uploaded && !!sourceRepo);
  return {
    source: {
      repo: sourceRepo,
      prefix: sourceInWs ? `${p.id}/source/` : '',
      mode: uploaded ? 'uploaded' : 'external',
      inWorkspace: sourceInWs,
    },
    data: {
      repo: dataRepo,
      prefix: workspace ? `${p.id}/` : '',
      dedicated: !workspace,
    },
    independent: !workspace,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config-projectstorage.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add js/config.js tests/config-projectstorage.test.mjs
git commit -m "feat(config): projectStorage descriptor — single display truth for source/data location"
```

---

## Task 2: Refactor `sourceLabel` onto `projectStorage` (regression-locked)

**Files:**
- Modify: `js/config.js` (`sourceLabel`, ~line 187)
- Test: `tests/config-projectstorage.test.mjs` (extend)

Current `sourceLabel(cfg, parsed)` takes a RESOLVED cfg (has `srcPrefix`/`sourceRepo`), returns `{repo}` | `{text}`. Keep that exact contract; just express it via the same mode logic so the two can't drift.

- [ ] **Step 1: Write the failing test** (append)

```js
import { sourceLabel } from '../js/config.js';

test('sourceLabel: external resolved cfg → {repo}', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: 'me/src', srcPrefix: '' }, true), { repo: 'me/src' });
});
test('sourceLabel: uploaded (srcPrefix set) → {text: uploaded}', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: 'me/ws', srcPrefix: 'x/source/' }, true), { text: 'uploaded' });
});
test('sourceLabel: nothing connected, parsed → empty text', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: '', srcPrefix: '' }, true), { text: '' });
});
```

- [ ] **Step 2: Run — expect PASS already** (current `sourceLabel` should satisfy these)

Run: `node --test tests/config-projectstorage.test.mjs`
Expected: PASS — these lock existing behavior before refactor.

- [ ] **Step 3: Refactor `sourceLabel` body** (keep signature + outputs identical)

Replace the body of `sourceLabel` with:

```js
export function sourceLabel(cfg, parsed) {
  const uploaded = !!(cfg && cfg.srcPrefix);
  if (cfg && cfg.sourceRepo && !uploaded) return { repo: cfg.sourceRepo };
  if (uploaded) return { text: 'uploaded' };
  return { text: parsed ? '' : 'point Footnote at your LaTeX, or upload it' };
}
```

(This is behavior-identical; the refactor is that both `sourceLabel` and `projectStorage` now use the same `srcPrefix ⇒ uploaded` rule. Note `sourceLabel` reads a RESOLVED cfg; `projectStorage` reads a RAW project — both express one rule.)

- [ ] **Step 4: Run to verify still green**

Run: `node --test tests/config-projectstorage.test.mjs`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add js/config.js tests/config-projectstorage.test.mjs
git commit -m "test(config): lock sourceLabel contract; align with projectStorage mode rule"
```

---

## Task 3: `newProjectPlan` — storage-style × source matrix (pure)

**Files:**
- Modify: `js/importdoc.js` (add after `planNewProjectRepos`, ~line 49)
- Test: `tests/importdoc.test.mjs` (extend)

- [ ] **Step 1: Write the failing test** (append)

```js
import { newProjectPlan } from '../js/importdoc.js';

const CFG = { owner: 'me', hubRepo: 'me/footnote-projects', workspaceRepo: 'me/footnote-projects' };

test('workspace + upload: data=ws, sourceRepo empty, creates none-new-source', () => {
  const p = newProjectPlan('workspace', 'local', 'Metro Paper', CFG);
  assert.equal(p.workspace, true);
  assert.equal(p.dataRepo, 'me/footnote-projects');
  assert.equal(p.sourceRepo, '');
  assert.equal(p.uploaded, true);
  assert.deepEqual(p.creates, ['me/footnote-projects']);   // just the workspace repo (idempotent)
});

test('workspace + github: external source, data=ws', () => {
  const p = newProjectPlan('workspace', 'github', 'Metro', CFG, { sourceRepo: 'me/paper-src' });
  assert.equal(p.workspace, true);
  assert.equal(p.dataRepo, 'me/footnote-projects');
  assert.equal(p.sourceRepo, 'me/paper-src');
  assert.equal(p.uploaded, false);
});

test('independent + upload: dedicated source + data repos', () => {
  const p = newProjectPlan('independent', 'local', 'My Thesis', CFG);
  assert.equal(p.workspace, false);
  assert.equal(p.dataRepo, 'me/my-thesis-footnote-data');
  assert.equal(p.sourceRepo, 'me/my-thesis-source');
  assert.equal(p.uploaded, true);
  assert.deepEqual(p.creates.sort(), ['me/my-thesis-footnote-data', 'me/my-thesis-source']);
});

test('independent + github: external source, dedicated data', () => {
  const p = newProjectPlan('independent', 'github', 'Diss', CFG, { sourceRepo: 'me/phd-dissertation' });
  assert.equal(p.workspace, false);
  assert.equal(p.dataRepo, 'me/diss-footnote-data');
  assert.equal(p.sourceRepo, 'me/phd-dissertation');
  assert.equal(p.uploaded, false);
  assert.deepEqual(p.creates, ['me/diss-footnote-data']);   // don't create the external source
});

test('advanced overrides win', () => {
  const p = newProjectPlan('independent', 'local', 'Diss', CFG, { sourceOverride: 'me/custom-src', dataOverride: 'me/custom-data' });
  assert.equal(p.sourceRepo, 'me/custom-src');
  assert.equal(p.dataRepo, 'me/custom-data');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/importdoc.test.mjs`
Expected: FAIL — `newProjectPlan` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `js/importdoc.js`:

```js
// Resolve the concrete repos + project fields for a NEW project from the two axes chosen in the New
// Project sheet: `style` ('workspace' | 'independent') and `mode` (source: 'local' | 'github' | 'overleaf').
// Returns the addProject fields (workspace/dataRepo/sourceRepo/uploaded) plus `creates` = repos to ensure
// exist. Beginners never type a repo name (auto-derived); Advanced overrides win. Pure — the sheet's click
// handler stays thin and this matrix is unit-tested.
export function newProjectPlan(style, mode, name, cfg, opts = {}) {
  const owner = cfg.owner;
  const wsRepo = cfg.workspaceRepo || cfg.hubRepo;
  const uploaded = mode === 'local';
  const externalSrc = uploaded ? '' : (opts.sourceOverride || opts.sourceRepo || '').trim();
  if (style === 'workspace') {
    return { workspace: true, dataRepo: wsRepo, sourceRepo: externalSrc, uploaded, creates: [wsRepo] };
  }
  // independent: this document gets its own repos
  const dataRepo = (opts.dataOverride || '').trim() || dataRepoSuggestion(name, owner);
  const sourceRepo = externalSrc || (opts.sourceOverride || '').trim() || sourceRepoSuggestion(name, owner);
  const creates = uploaded ? [dataRepo, sourceRepo] : [dataRepo];  // never create an external source repo
  return { workspace: false, dataRepo, sourceRepo, uploaded, creates };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/importdoc.test.mjs`
Expected: PASS (all, incl. 5 new).

- [ ] **Step 5: Commit**

```bash
git add js/importdoc.js tests/importdoc.test.mjs
git commit -m "feat(importdoc): newProjectPlan — storage-style x source matrix for New Project"
```

---

## Task 4: `resolveProject` parity test (external source, both data models)

**Files:**
- Test: `tests/config-projectstorage.test.mjs` (extend) — no code change; this proves "both methods fully accounted for."

- [ ] **Step 1: Write the test** (append)

```js
import { resolveProject } from '../js/config.js';

test('parity: external source resolves identically for workspace vs dedicated data', () => {
  const app = { owner: 'me', dataRepo: 'me/footnote-projects', hubRepo: 'me/footnote-projects', workspaceRepo: 'me/footnote-projects' };
  const ws = resolveProject(app, [{ id: 'a', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: 'me/ext-src' }], 'a');
  const ded = resolveProject(app, [{ id: 'b', workspace: false, dataRepo: 'me/b-data', sourceRepo: 'me/ext-src' }], 'b');
  assert.equal(ws.sourceRepo, 'me/ext-src');
  assert.equal(ded.sourceRepo, 'me/ext-src');
  assert.equal(ws.srcPrefix, '');    // external source is never workspace-prefixed
  assert.equal(ded.srcPrefix, '');
});
```

- [ ] **Step 2: Run — expect PASS** (documents existing correct behavior)

Run: `node --test tests/config-projectstorage.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/config-projectstorage.test.mjs
git commit -m "test(config): parity — external source resolves identically in workspace and dedicated data"
```

---

## Task 5: Edit-modal source branch + hub card source line (DOM; browser gate)

**Files:**
- Modify: `js/hub.js` — import `projectStorage`; `editProjectSheet` (~line 364); card render (~line 279-285)

Not unit-tested (pure DOM). Verified via the fetch-stubbed hub harness (see Task 7 gate).

- [ ] **Step 1: Import the descriptor** in hub.js config import line

Add `projectStorage` to the existing `import { ... } from './config.js?v=<sha>'`. Match the CURRENT `?v=` sha on that line (grep it first — the cachebust bot changes it).

- [ ] **Step 2: Edit modal — branch on source mode**

Replace the single source `<label>` (hub.js:369) with a computed block. Before building `scrim.innerHTML`, compute:

```js
const stor = projectStorage({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, v);
const srcField = stor.source.mode === 'uploaded'
  ? `<div class="fn-field"><span class="fn-field-lbl">Your document's source</span>
       <div class="fn-static">Uploaded ${stor.source.inWorkspace ? `into your workspace (<span class="fn-mono">${esc(stor.source.prefix)}</span>)` : `to <span class="fn-mono">${esc(stor.source.repo)}</span>`}</div>
       <button type="button" class="fn-link" id="np-src-ext">Point at an external repo instead</button>
       <input id="np-src" type="hidden" value=""></div>`
  : `<label class="fn-field">Your document's source repo <span class="fn-sub">the LaTeX you're reviewing (a GitHub repo, Overleaf-synced or not). Read-only; never edited here.</span><input id="np-src" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false" value="${esc(stor.source.repo || '')}"></label>`;
```

Use `${srcField}` in the sheet markup in place of the old label. For the uploaded branch, wire the reveal after append:

```js
const ext = q('#np-src-ext');
if (ext) ext.onclick = () => {
  ext.closest('.fn-field').innerHTML = `Your document's source repo <span class="fn-sub">points Footnote at an external repo; your uploaded copy is kept.</span><input id="np-src" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false" value="">`;
  ext.closest('.fn-field').className = 'fn-field';
  attachRepoPicker(q('#np-src'), tok());
};
```

Guard the save: an empty `#np-src` on an uploaded project means "unchanged" — only patch `sourceRepo` when the field is non-empty:

```js
const srcVal = (q('#np-src').value || '').trim();
const patch = { name, doc: { noun } };
if (srcVal || stor.source.mode === 'external') patch.sourceRepo = srcVal;
await writeProjects(hub(), tok(), updateProject(list, v.id, patch));
```

- [ ] **Step 3: Hub card — add a source line**

In the book markup (hub.js:284), after the `fn-book-repo` (data) span, add a source line computed per book:

```js
// inside the list.map, compute once:
const st = projectStorage({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, p);
const srcLine = st.source.mode === 'uploaded'
  ? (st.source.inWorkspace ? 'uploaded · in workspace' : `uploaded · ${st.source.repo}`)
  : `${st.source.repo} (read-only)`;
```

Render it as a muted span:
`<span class="fn-book-src">${esc(srcLine)}</span>` and relabel the existing `fn-book-repo` as comments if desired (keep class name for CSS; content stays `p.dataRepo`).

- [ ] **Step 4: node --check + browser gate** (see Task 7). Confirm: metrology card shows "uploaded · in workspace"; dissertation card shows "phd-dissertation (read-only)"; edit modal for metrology shows the read-only uploaded line (no empty box), and "Point at an external repo instead" reveals a working picker.

- [ ] **Step 5: Commit**

```bash
git add js/hub.js
git commit -m "fix(hub): honest source display — edit modal + card read projectStorage, not raw sourceRepo"
```

---

## Task 6: New Project storage-style fork + wiring (DOM; browser gate)

**Files:**
- Modify: `js/hub.js` — `newProjectSheet` (~line 395), import `newProjectPlan`

- [ ] **Step 1: Import `newProjectPlan`** into the importdoc import line (match current `?v=` sha).

- [ ] **Step 2: Add the storage-style control** above "Where's your writing?" in the sheet markup:

```html
<div class="fn-field-lbl">How should this be stored?</div>
<div class="fn-seg" id="np-style">
  <button type="button" class="fn-seg-b on" data-style="workspace">Keep it in my workspace</button>
  <button type="button" class="fn-seg-b" data-style="independent">Its own repos</button>
</div>
<div class="fn-hint" id="np-style-hint"></div>
```

Track `let style = 'workspace';` beside `let mode`. Wire the segment buttons like `np-modes`, and update `#np-style-hint` + the bottom hint on change.

- [ ] **Step 3: Conditional hints** — set on style/name change:

```js
const styleHint = () => style === 'workspace'
  ? `Lives in your workspace repo <span class="fn-mono">${esc(wsRepo)}</span> under <span class="fn-mono">${esc(slugPreview())}/</span>.`
  : `Creates <span class="fn-mono">${esc(slugPreview())}-source</span> and <span class="fn-mono">${esc(slugPreview())}-footnote-data</span>, just for this document.`;
```

- [ ] **Step 4: Overleaf copy per style** — in `renderPanel`, when `mode==='overleaf'`, branch the hint on `style`:

```js
const overleafHint = style === 'independent'
  ? `In Overleaf: <b>Menu → GitHub → Sync</b> to a new repo, then pick it here. Overleaf keeps that repo updated and Footnote re-renders on each sync <span class="fn-sub">(Overleaf premium GitHub sync)</span>.`
  : `Export your project (<b>Menu → Download</b>) and upload the folder under "On my computer". Automatic live sync into a workspace is coming.`;
```

For workspace+overleaf, steer the user to the upload panel (independent is the live path). Keep github mode unchanged.

- [ ] **Step 5: Wire create via `newProjectPlan`** — replace the hardcoded fields at the save handler (hub.js:476-491):

```js
const plan = newProjectPlan(style, mode, name, { ...cfg, hubRepo: wsRepo, workspaceRepo: wsRepo },
  { sourceRepo: (mode !== 'local') ? q('#np-pick').value.trim() : '', sourceOverride: advSource(), dataOverride: advData() });
if (mode !== 'local' && !plan.sourceRepo) return q('#np-err').textContent = 'Pick the repo where your LaTeX lives.';
const next = addProject(list, { id, name, dataRepo: plan.dataRepo, sourceRepo: plan.sourceRepo, workspace: plan.workspace, uploaded: plan.uploaded, doc: { noun, unitNoun } });
// ensure repos:
for (const repo of plan.creates) { try { await createRepo(tok(), repo); } catch (e) { /* 422 = exists */ } }
// seed: workspace → prefix '<id>/'; independent → data repo root ''
const seedPrefix = plan.workspace ? `${id}/` : '';
try { await seedDataRepo(plan.dataRepo, tok(), undefined, undefined, seedPrefix); } catch (e) { console.warn('seed:', e.message); }
await ensureRenderPipeline(plan.dataRepo, tok());
// commit uploaded source: workspace → <id>/source/…; independent upload → source repo root
const srcRepo = plan.workspace ? wsRepo : plan.sourceRepo;
const srcBase = plan.workspace ? `${id}/source/` : '';
// …existing folder/single-tex commit loop, but write to `${srcBase}${f.path}` in `srcRepo`…
```

Keep the existing folder-upload + single-.tex loops; only the destination repo + path base change per plan. `advSource()`/`advData()` read the Advanced `<details>` inputs (add them; empty when collapsed).

- [ ] **Step 6: node --check + browser gate** (Task 7). Confirm: workspace+local creates only the workspace repo with `<id>/source/…`; independent+local creates `<slug>-source` + `<slug>-footnote-data`; independent+github sets external source + dedicated data; hints + Overleaf copy switch by style.

- [ ] **Step 7: Commit**

```bash
git add js/hub.js
git commit -m "feat(hub): New Project storage-style fork — consolidated workspace vs independent repos"
```

---

## Task 7: Full verification gate

- [ ] **Step 1: All node tests green**

Run: `node --test tests/`
Expected: PASS (existing + new).

- [ ] **Step 2: Static checks**

Run: `node --check js/config.js && node --check js/importdoc.js && node --check js/hub.js`
Expected: no output (OK).

- [ ] **Step 3: advisor.js AI-clean invariant (unchanged, but verify)**

Run: `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js`
Expected: empty.

- [ ] **Step 4: Browser gate** — serve locally, mount the hub with a fetch stub returning a projects.json containing (a) a workspace upload project, (b) a fully-independent project. Verify per the spec's browser-gate list: card source lines, edit-modal branches + reveal, New Project fork create paths, Overleaf copy per style. Screenshot each state.

- [ ] **Step 5: Rebase discipline before any push** — `git fetch`; if origin/main advanced, reconcile keeping the current `?v=` shas on import lines; re-run `node --test tests/`. Do NOT push to main without Matt's say-so.

---

## Self-Review notes

- **Spec coverage:** Section 1 → Tasks 1,2,5. Section 2 → Tasks 3,6. Section 3 (Overleaf copy) → Task 6 step 4. Parity guarantee → Task 4. Testing plan → Tasks 1-4 (pure) + Task 7 (gate).
- **Type consistency:** `projectStorage` shape used identically in Tasks 1/5; `newProjectPlan` fields (`workspace/dataRepo/sourceRepo/uploaded/creates`) used identically in Tasks 3/6.
- **New raw-project field `uploaded`:** independent-upload projects persist `uploaded:true` so `projectStorage` can report mode without guessing. Workspace uploads don't need it (`sourceInWs` implies uploaded). Back-compat: absent `uploaded` on a legacy external project → `mode:'external'` (correct).

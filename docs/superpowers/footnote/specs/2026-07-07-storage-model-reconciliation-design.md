# SP1 — Storage-model reconciliation (source/data location: display + onboarding)

**Date:** 2026-07-07
**Status:** Design approved (sections 1–3), pending written-spec review
**Repo:** `mattlmccoy/footnote` (local `put_github_repos_here/footnote`)
**Branch:** `feat/storage-model-reconciliation`
**Sequenced before:** SP2 — Overleaf Tier-2 live subtree sync (separate spec, brainstormed after SP1 ships)

## Problem

After the 2026-07-04 workspace consolidation, an uploaded document's LaTeX lives *inside* the
workspace repo at `<id>/source/` and the project is stored with `sourceRepo: ''`. The hub card and
Edit-project modal still bind directly to the raw `project.sourceRepo` string, so for every uploaded
(workspace) project the "Your document's source repo" field renders **empty** — showing only the grey
placeholder `<owner>/your-latex-repo`. It reads as broken and hides where the source actually is.

Root cause is a half-applied model change: `config.js:resolveProject` correctly reconstructs the real
location (`sourceInWs` → `srcPrefix:'<id>/source/'`), and `config.js:sourceLabel` already computes the
right human label ("uploaded" vs an external repo) — but `sourceLabel` is wired **only** into the owner
setup checklist, not the hub card or edit modal. Half the app knows the new model; half doesn't.

Two intertwined gaps to close:
- **Display**: no surface should bind to the raw `project.sourceRepo` string; all should read one
  descriptor that honestly reports uploaded-vs-external and workspace-vs-dedicated.
- **Onboarding**: New Project can no longer create a *fully independent* project (dedicated source +
  dedicated data repos, like the `phd-dissertation` + `dissertation-tracker-data` shape). It hard-codes
  `dataRepo: wsRepo`. Independent projects only exist because they predate consolidation. The user
  requires **both** the consolidated-workspace model and the independent-repo model to be first-class,
  creatable from scratch, and fully accounted for everywhere.

## Non-goals (SP1)

- No Overleaf live sync is built here. SP1 only makes Overleaf *routing + copy* honest (which style gives
  automatic updates). Tier-2 live subtree sync is SP2.
- No change to `resolveProject`'s runtime path resolution beyond what's needed; it already handles all
  four shapes. SP1 adds a display twin + locks the parity with tests.
- No data migration. Existing projects keep working; the new descriptor reads their current fields.

## Two axes (the model)

A project has two independent storage axes. Today they are conflated under one `workspace` boolean.

- **Source location** — where the LaTeX lives:
  - `uploaded` — Footnote committed it (into `<id>/source/` for workspace, or a dedicated `<slug>-source`
    repo root for independent).
  - `external` — a read-only repo the user points at (`phd-dissertation`, an Overleaf-synced repo, etc.).
- **Data/comments location** — where comments + rendered content live:
  - `workspace` — shared workspace repo, under `<id>/`.
  - `dedicated` — this document's own data repo (`<slug>-footnote-data` / `dissertation-tracker-data`).

The four real combinations:

| Shape | Source | Data | Example |
|---|---|---|---|
| Consolidated upload | uploaded → `<ws>/<id>/source/` | workspace | metrology-task-1 |
| Consolidated external | external repo | workspace | GitHub/Overleaf-synced source, comments in workspace |
| Independent upload | uploaded → `<slug>-source` (root) | dedicated `<slug>-footnote-data` | new independent, local file |
| Fully independent | external repo | dedicated | phd-dissertation + dissertation-tracker-data |

## Section 1 — `projectStorage` descriptor + display

### The descriptor (pure, in `js/config.js`)

```
projectStorage(appCfg, project) → {
  source: {
    repo,          // owner/name that actually holds the LaTeX (workspace repo for in-ws uploads)
    prefix,        // '' | '<id>/source/'
    mode,          // 'uploaded' | 'external'
    inWorkspace,   // true when source lives under <ws>/<id>/source/
  },
  data: {
    repo,          // owner/name holding comments+content
    prefix,        // '' | '<id>/'
    dedicated,     // true = own repo; false = shared workspace
  },
  independent,     // convenience: === data.dedicated (has its own data repo, e.g. dissertation)
}
```

Derivation mirrors `resolveProject` exactly (same `wsRepo`/`workspace`/`sourceInWs` logic) so the display
can never disagree with the runtime resolution. `sourceLabel(cfg, parsed)` is refactored to a thin wrapper
over `projectStorage` so its existing callers are unchanged in behavior.

### What each surface renders

| Surface | Consolidated upload | Fully independent / external |
|---|---|---|
| **Hub card** (`hub.js` card render) | adds a source line: *"Source: uploaded · in workspace"*; keeps a comments line *"Comments: `<ws>`"* | *"Source: `<repo>` (read-only)"* · *"Comments: `<data repo>`"* |
| **Edit modal** (`editProjectSheet`) | **read-only line** *"Uploaded into your workspace (`<id>/source/`)"* + a subtle **"Point at an external repo instead"** link that reveals the editable repo field | editable repo field, prefilled from `source.repo` (as today) |
| **Setup checklist** (`app.js`, via `sourceLabel`) | unchanged behavior (already correct) | unchanged behavior |
| **Migrate sheet** (`hub.js confirmMigrate`) | unchanged (already conditional on `project.sourceRepo`) | unchanged |

**Core fix:** the edit modal branches on `source.mode`. `uploaded` → truthful read-only line (no empty
text box). `external` → editable field exactly as today. The "Point at an external repo instead" link is
how an uploaded project can be repointed at an external source (writes `sourceRepo` = the entered repo;
does not delete the uploaded `<id>/source/`).

### Hub card note

The card currently shows only `p.dataRepo` (`hub.js:284`). SP1 adds a source line above/below it using
`projectStorage(...).source`. Keep it muted and single-line to preserve the calm card layout.

## Section 2 — New Project storage-style fork (Approach A)

New Project gains one control above "Where's your writing?", so the data-style axis is chosen first:

```
New project
  Project name              [__________]

  How should this be stored?
   (•) Keep it in my workspace   (recommended)
       comments + uploaded source under one repo, in a per-project folder
   ( ) Give this document its own repos
       a dedicated source repo + a dedicated comments repo, just for this doc

  Where's your writing?
   [On my computer] [In a GitHub repo] [In Overleaf]
   …source sub-panel (unchanged 3-way)…

  What is it?  [thesis]
  ▸ Advanced   (auto-named repos; override names)
```

### Style × source → create outcomes

| Style | Source | Repos created / used | `addProject` fields |
|---|---|---|---|
| Workspace | upload | commit `<ws>/<id>/source/**`; data `<ws>/<id>/` | `workspace:true, dataRepo:ws, sourceRepo:''` |
| Workspace | GitHub/Overleaf | external source; data `<ws>/<id>/` | `workspace:true, dataRepo:ws, sourceRepo:<ext>` |
| Independent | upload | create `<slug>-source` (main.tex/tree at root) + `<slug>-footnote-data` | `workspace:false, dataRepo:<slug>-footnote-data, sourceRepo:<slug>-source` |
| Independent | GitHub/Overleaf | external source (e.g. `phd-dissertation`) + `<slug>-footnote-data` | `workspace:false, dataRepo:<slug>-footnote-data, sourceRepo:<ext>` |

Everything flows into the same `resolveProject`: `workspace:false` = the already-correct, already-tested
legacy path (own dataRepo/sourceRepo, prefixes `''`).

### Pure planning helper

A pure `newProjectPlan(style, mode, name, cfg)` → `{ workspace, dataRepo, sourceRepo, creates:[repos],
srcPrefix }` centralizes the matrix so the sheet's click handler stays thin and the mapping is unit-tested.
It reuses the pre-consolidation helpers still present in `importdoc.js` (`planNewProjectRepos`,
`sourceRepoSuggestion`, `dataRepoSuggestion`). Advanced exposes the auto-named repos for override.

### Seeding

- Workspace: `seedDataRepo(wsRepo, tok, _, _, '<id>/')` (per-project config under `<id>/`, engine at root)
  and `ensureRenderPipeline(wsRepo, ...)` — unchanged from today.
- Independent: create the dedicated data repo, `seedDataRepo(dataRepo, tok, _, _, '')` (root prefix) +
  `ensureRenderPipeline(dataRepo, ...)`; independent+upload also creates the dedicated source repo and
  commits the tree at its root (`srcPrefix:''`).

### Conditional bottom hint

- Workspace: *"Lives in your workspace repo `<ws>` under `<slug>/`."*
- Independent: *"Creates `<slug>-source` and `<slug>-footnote-data`, just for this document."*

## Section 3 — Honest Overleaf routing (copy only in SP1)

Overleaf's native GitHub sync is one project ↔ one repo **at the root** — it can't target `<id>/source/`.
That maps cleanly onto the two styles, so SP1 routes the "In Overleaf" copy by style:

- **Independent + Overleaf** (recommended for Overleaf users): the user runs Overleaf's *Menu → GitHub →
  Sync* to a dedicated root repo; Footnote points at it read-only. Because Overleaf pushes to a root repo,
  `render.yml` rebuilds the reading view automatically on each Overleaf push. Copy states plainly:
  *"Overleaf keeps this repo updated; Footnote re-renders on each sync (Overleaf premium GitHub sync)."*
- **Workspace + Overleaf**: only ZIP/folder re-import works today (source must land in a subfolder Overleaf
  can't push to). Copy states plainly: *"Export your Overleaf project (Menu → Download) and upload the
  folder. Automatic live sync into a workspace is coming"* — the SP2 hook. No implication of live sync.

This is the deployability correction: the UI stops implying automatic Overleaf updates where none exist,
and points Overleaf-live users at the style that actually delivers it.

## Testing (TDD red-green for logic; browser gate for DOM)

**Unit (node --test, `tests/`), written test-first:**
- `projectStorage` — all four combinations + edges: missing `sourceRepo`, `sourceRepo === wsRepo`, legacy
  (`workspace:false`) project, no workspace repo configured. Assert `source.mode`, `inWorkspace`,
  `data.dedicated`, `independent`, prefixes.
- `sourceLabel` wrapper — unchanged outputs for its existing cases (regression lock).
- `newProjectPlan(style, mode, name, cfg)` — the style×source matrix → correct
  `workspace/dataRepo/sourceRepo/creates`.
- `resolveProject` parity — an external source repo resolves to the **same** `sourceRepo/srcPrefix` whether
  `data` is workspace or dedicated (proves "both methods fully accounted for").

**Browser-verification gate (pure DOM; stated, not skipped):** hub card source line, edit-modal
uploaded-vs-external branch + "Point at an external repo instead" reveal, New Project storage-style fork
producing the right repos, honest Overleaf copy per style. Verified via the existing fetch-stubbed
owner/hub harness pattern.

**Invariants:** `advisor.js` stays AI-grep-clean (unchanged here). Deterministic comment→stage→approve→
merge path untouched. No `resolveProject` behavior change for existing projects (legacy byte-identical).

## Files touched (anticipated)

- `js/config.js` — add `projectStorage`; refactor `sourceLabel` onto it.
- `js/hub.js` — edit-modal source branch + "point external" reveal; card source line; New Project
  storage-style control + `newProjectPlan` wiring; conditional hints; Overleaf copy per style.
- `js/importdoc.js` — `newProjectPlan` (or co-locate in config.js if purer there); reuse existing helpers.
- `tests/` — new node tests per above.
- No CI/Python changes in SP1.

## Risks

- `js/app.js` / `js/hub.js` are large and cachebust-churned; follow the memory's rebase discipline
  (`grep -a`, named `git add`, match current `?v=` when editing import lines).
- Independent+upload creates two repos — reintroduces per-doc repos, but only when the user explicitly
  chooses the independent style. Acceptable and opt-in.

# SP2 — Overleaf live sync (B1: bridge-repo, tokenless)

**Date:** 2026-07-07
**Status:** Design approved (Sections A–C + two confirmations), pending written-spec review
**Repo:** `mattlmccoy/footnote` (worktree `put_github_repos_here/footnote-sp1`)
**Branch:** to be created off SP1 (`sp1-storage-model`) or off `main` once SP1 (PR #8) merges
**Depends on:** SP1 storage-model reconciliation (the "workspace data + external source" shape + `projectStorage`)

## Goal

Let an Overleaf-authored paper stay live in Footnote — the author writes in Overleaf, reviewers see and
comment on the latest in Footnote, and accepted edits flow back to Overleaf — **without Footnote ever
holding an Overleaf credential**, and **without giving up repo consolidation**.

## Hard constraints (from the brainstorm)

1. **No Overleaf tokens, ever.** Overleaf content moves only via Overleaf's own native GitHub sync, which
   the *user* sets up. Footnote works entirely in GitHub-land with the adopter's existing GitHub token.
2. **Non-premium users are NOT locked out.** Live auto-sync requires Overleaf premium (Overleaf's GitHub
   sync is a paid Overleaf feature — not ours to change). Free-tier Overleaf users use the full review
   workflow via **Tier-1 ZIP/folder re-import**; they only lose *automatic* refresh, not access.
3. **Both storage models supported.** Overleaf sync keys off *external source = the bridge repo*, which is
   orthogonal to where comments live — so a consolidated-workspace project and an independent
   (own-data-repo) project both support it identically.
4. **Advisors are live — zero breakage.** Additive + gated only; `advisor.js` untouched; the AI-off
   deterministic comment→stage→approve→merge path unchanged; no edits to `render.yml`/apply-engine
   internals (SP2 only *dispatches* the existing render and *reuses* the existing external-source
   write-back).

## Mechanism (B1)

Without an Overleaf token, the tokenless path is Overleaf's native GitHub sync to a dedicated **GitHub
bridge repo** (one per Overleaf-linked paper — the only option Overleaf offers; opt-in and premium).
Footnote treats that bridge repo as the project's **external source** (SP1's "external source" support).
Everything else is reuse.

### The two directions

- **Overleaf → Footnote (read/render).** Author edits in Overleaf → Overleaf syncs → bridge repo updates.
  Footnote re-renders the reader from the bridge clone. Because `render.yml` auto-fires only on the data
  repo's own `<id>/source/**` (not on an *external* source changing), SP2 adds a **"Refresh from Overleaf"**
  action that `dispatchRender`s (the existing, proven dispatch path) → `resolve_source` clones the bridge
  repo → reader rebuilds. Optional `overleaf.autoRefresh` scheduled re-render as a later toggle.
- **Footnote → Overleaf (accepted edits back).** comment → stage → approve → merge → `publish_merge`
  **already** writes the merged source into the external bridge repo's `main` and pushes it
  (`ci_apply.py` external path, using the GitHub `SOURCE_TOKEN`). The author then pulls it into Overleaf
  via Overleaf's own UI. **No new engine code** — this path is already live for external-source projects.

### Data model

An Overleaf-linked project is any project (workspace-data OR dedicated-data) whose `sourceRepo` is the
bridge repo, plus a marker:

```
project.overleaf = { bridgeRepo: "<owner>/<repo>" }   // presence = "Overleaf-linked"; drives UI + refresh
```

`projectStorage` (SP1) already reports `source.mode === 'external'` for these; SP2 adds a thin
`overleafLink(project)` reader and `isOverleafLinked(project)` predicate. No change to `resolveProject`.

## Components

New (small):
- **`js/overleaf.js`** — pure, unit-tested: `overleafLink(project)` (→ `{bridgeRepo}` | null),
  `isOverleafLinked(project)`, `overleafNewProjectPatch(bridgeRepo)` (the fields New Project / Connect set),
  `overleafSetupError(...)` (validation copy). No I/O.
- **Owner-portal wiring (`js/app.js` and/or `js/hub.js`):** the "In Overleaf (premium)" New-Project copy +
  bridge-repo pick; a **"Connect Overleaf"** action on an existing workspace/independent project; a visible
  **"Refresh from Overleaf"** button on Overleaf-linked projects that calls the existing `dispatchRender`/
  `renderRun`. Premium note + `SOURCE_TOKEN` hint surfaced where relevant (reuse the existing external-source
  token guidance).

Reused, unchanged (already live + proven):
- `render.yml` + `ci_render.resolve_source` (external clone with `SOURCE_TOKEN`).
- `ci_apply.publish_merge` external path + `commit_branch(remote_repo=…)` (write-back to the bridge repo).
- SP1 New Project "In Overleaf" mode + repo picker + `projectStorage`.

Optional follow-on (NOT in the MVP): `workflows/overleaf-refresh.yml` scheduled cron that re-renders
Overleaf-linked projects when `overleaf.autoRefresh` is set. MVP ships the manual button only.

## Setup flow (premium-gated, stated plainly)

1. In Overleaf (premium): *Menu → GitHub → Sync* to a new repo = the bridge repo. Overleaf owns this
   connection.
2. In Footnote: **New Project → In Overleaf**, or **Connect Overleaf** on an existing project → pick the
   bridge repo → sets `sourceRepo` + `project.overleaf.bridgeRepo`.
3. (For write-back / private bridge repo) seal a GitHub `SOURCE_TOKEN` with access to the bridge repo —
   reuse the existing external-source token flow. No Overleaf credential.

Free-tier path (no premium): New Project → In Overleaf shows *"Live sync needs Overleaf premium. Free tier:
Menu → Download in Overleaf, then upload the folder under On my computer"* — the SP1 Tier-1 fallback, plus a
clean **"Update source / re-import"** action to refresh after later Overleaf changes.

## Testing

- **Pure logic (TDD red→green, node):** `overleafLink`/`isOverleafLinked`/`overleafNewProjectPatch`/
  validation; the New Project "In Overleaf" plan sets the marker + external source; refresh-eligibility
  (only Overleaf-linked projects show Refresh).
- **Browser gate (DOM):** New Project "In Overleaf (premium)" copy + bridge pick; "Connect Overleaf" on an
  existing project; "Refresh from Overleaf" button dispatches render; free-tier premium note.
- **Reused-and-already-proven (no new integration tests):** external-source render (`resolve_source`) and
  external write-back (`publish_merge` external) are already covered by the SP-Claude-backend pytest suite.
- **Live end-to-end gate (Matt):** a real Overleaf-premium project synced to a bridge repo, pointed at from
  Footnote — Overleaf edit → Refresh → reader updates; approve→merge → bridge repo `main` updated → pull into
  Overleaf.
- **Invariants:** `advisor.js` AI-grep-clean; AI-off deterministic path works; non-Overleaf projects
  unaffected; `render.yml`/apply internals unchanged.

## Files touched (anticipated)

- Create: `js/overleaf.js` + `tests/overleaf.test.mjs`.
- Modify: `js/hub.js` (New Project "In Overleaf" premium copy + marker; "Connect Overleaf" entry) and/or
  `js/app.js` (owner-portal "Refresh from Overleaf" button + "Connect Overleaf"). Reuse `dispatchRender`.
- No Python/CI changes in the MVP (write-back + render already support external source). Optional later:
  `workflows/overleaf-refresh.yml` for the cron toggle.

## Non-goals (SP2 MVP)

- No custom 3-way merge engine, no `.overleaf-base/` snapshot, no Overleaf git-bridge, no `OVERLEAF_TOKEN`
  (all rejected: B1 over B2, no Overleaf tokens).
- No automatic push-back timing beyond the existing approve→merge (author pulls into Overleaf themselves).
- No scheduled cron in the MVP (manual Refresh button first; cron is an opt-in follow-on).

## Risks

- `js/app.js`/`js/hub.js` are large + cachebust-churned — follow the SP1 rebase discipline (`grep -a`,
  named `git add`, match current per-file `?v=` shas on import lines).
- Private bridge repo requires `SOURCE_TOKEN` for both render and write-back; surface that clearly or the
  reader silently fails to build. (Reuse existing external-source token guidance.)
- Live verification is gated on Matt's Overleaf premium; the code paths are otherwise unit- + browser-tested
  and reuse already-proven external-source plumbing.

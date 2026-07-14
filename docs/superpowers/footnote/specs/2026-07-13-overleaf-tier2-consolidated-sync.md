# Overleaf Tier-2 live sync for consolidated repos — design

**Date:** 2026-07-13
**Branch:** `feat/overleaf-tier2` (off `origin/main` dd381c8)
**Status:** design — awaiting author review before writing the implementation plan

## Problem

Footnote consolidates many documents into **one** repo (`footnote-projects`), each document under
`<id>/` (comments, rendered HTML, job queue) and `<id>/source/` (LaTeX). Overleaf's own GitHub
integration is **one project ↔ one repo, synced at the repo ROOT** — it cannot target a subfolder.
So the nominal Overleaf interaction (one repo per Overleaf project) is fundamentally incompatible
with the consolidated model.

**This upgrade exists to make consolidated repos work with Overleaf**: bridge **N separate Overleaf
projects (each its own git-bridge remote) into N subfolders of one consolidated repo** — a
many-to-one mapping Overleaf itself can't express. Today none of this exists: there is no
`overleaf-sync.yml`, no `OVERLEAF_TOKEN`, no `git.overleaf.com` bridge, no push-back. The only
current "Overleaf" support is New Project → "In Overleaf" mode (which is just github-mode: point at
the repo Overleaf natively syncs to, one repo per project — i.e. NOT consolidated) plus a manual
comment worklist export.

## Non-goals (v1)

- Not replacing the existing github-mode "point at an Overleaf-synced repo" path (that stays for the
  one-repo-per-project users). Tier-2 is specifically for **consolidated** projects.
- No real-Overleaf CI in this pass — the git bridge is a paid Overleaf feature. v1 is built and
  verified against a **simulated bridge** (local `--bare` remotes). Real-Overleaf verification is a
  later, premium-gated step, called out honestly.
- No Overleaf webhook (Overleaf has none) — inbound is button/poll, not event-driven.

## Core model: per-`<id>` subfolder ↔ per-Overleaf-project mapping

Each consolidated project that wants Overleaf sync carries a committed marker:

```
<id>/overleaf.json  =  { "projectId": "<overleaf-project-id>", "branch": "master" }
```

The sync **discovers projects by globbing `*/overleaf.json`** (+ a root `overleaf.json` for a legacy
single-project repo). A project with **no** `overleaf.json` is skipped — uploaded and github-mode
docs are never touched. For each marked project the sync reconciles:

```
<id>/source/   ↔   https://git:<token>@git.overleaf.com/<projectId>   (branch)
```

independently, in a loop, mirroring how `ci_render.render_prefixes()` / `ci_notify.project_prefixes()`
already iterate consolidated subfolders.

### Credentials (mirrors the source.json / SOURCE_TOKEN split)

- **Marker** `<id>/overleaf.json` — committed by the app with the owner's **Contents** token (no
  secret in it, just the public project id + branch).
- **Token** — a sealed Actions secret **`OVERLEAF_TOKEN_<ID>`** (per-project), with a shared
  **`OVERLEAF_TOKEN`** fallback (one Overleaf account token usually reaches all your projects; the
  project id in the URL selects the project). Owner seals it (Secrets scope). Never in the data repo,
  never in the marker, never held by Footnote.
- `<ID>` in the secret name = the project id upper-cased with non-alphanumerics → `_`
  (GitHub secret-name charset), e.g. `metrology-paper` → `OVERLEAF_TOKEN_METROLOGY_PAPER`.

## Sync mechanism: `.overleaf-base` three-way merge (decision A)

Keep a hidden last-synced snapshot per project: **`<id>/.overleaf-base/`** (a copy of the source tree
as it was at the last successful sync). Each sync is a real three-way merge with GitHub canonical:

For each file path across {base, overleaf-now, github-now}, the **pure core** runs a line-based
three-way merge (no git shell-out — a self-contained diff3-style merge so it is fully unit-testable):
- present in all three → three-way merge with **base** as the common ancestor. Clean → take merged
  result. Conflict → see below.
- added on exactly one side → take the addition.
- deleted on one side, unchanged on the other → delete.
- deleted on one side, modified on the other → **conflict** (never silently drop prose).

After a clean reconcile: write the merged tree to `<id>/source/`, refresh `<id>/.overleaf-base/` to the
merged state, commit to the data repo (→ `render.yml` `*/source/**` auto-rebuilds the reading view),
and (push-back half) push the merged tree to the Overleaf remote so both peers converge on the same
state. The base snapshot is what prevents ping-pong: only genuine deltas on each side move.

**Why A over `git subtree`:** deterministic in CI, **precise per-file conflict surfacing** (mirrors
the `review-edits/<unit>` staging discipline), and the merge core is **pure + unit-testable** without a
real git history. `git subtree --prefix` was the considered alternative; rejected for coarse conflict
granularity and history-hungry, harder-to-test CI behavior.

### Conflict policy — GitHub canonical, never clobber

A real conflict on any file does **not** land in `<id>/source/` on the main branch. Instead:
- the incoming Overleaf tree is committed to a branch **`overleaf-sync/<id>`**,
- a marker `<id>/overleaf_conflict.json` records the conflicting files + timestamp,
- the app surfaces "Overleaf and Footnote both edited X — resolve" (same shape as a staged review),
- `<id>/source/` on main and `.overleaf-base/` are left untouched until the author resolves.

This mirrors the author-oversight invariant: automated sync never overwrites the author's prose
unilaterally.

## Directions & triggers

Overleaf has no outbound webhook, so the two directions are asymmetric.

### Overleaf → GitHub (pull) — author-initiated / polled
- **"Pull from Overleaf" owner button** → `workflow_dispatch` on `overleaf-sync.yml` (optional
  `project` input; blank = all marked projects).
- **Opt-in cron poll** (e.g. every 15 min) — off by default; the owner enables it. Each poll fetches
  the Overleaf remote, and only runs the merge/commit when the remote head changed.
- On success the data-repo commit to `<id>/source/**` triggers the existing `render.yml` — **no
  render changes needed**.

### GitHub → Overleaf (push-back) — automatic on approved edits
- When approved Footnote/Claude edits land in `<id>/source/` on `main` (the merge step already writes
  there), the sync pushes that subfolder's tree to the Overleaf remote.
- Guarded by the base snapshot so a render-only commit or an Overleaf-originated pull does not bounce
  back. Loop-safe: push only when `github-now` differs from `.overleaf-base` for reasons other than an
  Overleaf-sourced change.

### Loop avoidance
- `render.yml` commits with `[skip ci]` and `content/` is outside the source trigger — rendering
  never triggers sync.
- The `.overleaf-base` three-way makes both directions idempotent: re-running a sync with no new
  deltas on either side is a no-op (nothing to merge, nothing to push).

## Components

### New — CI (Python, `data-template/`)
- **`overleaf_sync.py`** — the **pure core** (no git, no network): `overleaf_prefixes(listing)`,
  `secret_name(project_id)`, `plan_sync(base, overleaf, github)` → `{merged, conflicts, push_needed,
  pull_needed}`, `three_way_file(base, a, b)` → `{text|conflict}`. Fully unit-testable.
- **`ci_overleaf.py`** — the **thin shell**: clone/fetch the bare/real remote, read the three trees,
  call the pure core, write `<id>/source/`, refresh `.overleaf-base/`, commit, push-back, or land the
  conflict branch. The only place git/network live (mirrors `ci_apply.py`'s boundary style).
- **`workflows/overleaf-sync.yml`** — `workflow_dispatch` (+ optional `schedule`), loops marked
  projects, injects `OVERLEAF_TOKEN_<ID>`/`OVERLEAF_TOKEN`, `contents: write` permission.

### New — front end (JS, `js/`), owner-only (advisor.js stays AI-clean & untouched)
- **`js/overleaf.js`** — pure helpers: `overleafMarker(projectId, branch)`, `secretName(id)`,
  `bridgeUrlHint(projectId)`, `syncStatusLabel(state)`. No I/O.
- Owner UI wiring (in the existing project/settings surfaces): set/clear the `overleaf.json` marker,
  seal `OVERLEAF_TOKEN_<ID>`, "Pull from Overleaf" button (dispatch + poll the run), enable/disable
  the cron, and a conflict-resolution surface reading `overleaf_conflict.json`.

### New — seeding
- `seed.js` gains `overleaf-sync.yml` + `ci_overleaf.py` + `overleaf_sync.py` in the render/apply
  self-heal set (`ensureOverleafPipeline`, idempotent, mirrors `ensureRenderPipeline`) so an existing
  consolidated data repo picks up the workflow without a full reseed.

### Unchanged
- `render.yml` (already triggers on `*/source/**`), `advisor.js` (AI-clean), the deterministic
  comment→stage→approve→merge path.

## Testing (simulate the bridge)

Each Overleaf project is a local **`--bare` git remote** standing in for `git.overleaf.com/<projectId>`
— the same harness style as `tests/test_ci_apply_integration.py`.

**Pure unit tests** (`tests/test_ci_overleaf.py`, red-green per unit):
- `overleaf_prefixes`: only `*/overleaf.json`-marked projects returned; unmarked skipped; legacy root.
- `secret_name`: id → `OVERLEAF_TOKEN_<SANITIZED>`.
- `three_way_file`: clean merge; both-changed-same-line → conflict; add/delete/modify-vs-delete cases.
- `plan_sync`: pull-only, push-only, both, no-op, conflict-set; base prevents ping-pong.

**Integration tests** (`tests/test_ci_overleaf_integration.py`, local bare remotes):
1. **Consolidated N-project loop** — two subfolders, one marked + one not; only the marked one syncs;
   the unmarked project's `source/` is untouched.
2. **Two marked projects, two distinct bare remotes** — each `<id>/source/` reconciles against its own
   remote; no cross-contamination.
3. **Pull** — Overleaf-side edit → pull → `<id>/source/` updated, `.overleaf-base` refreshed, a commit
   on `*/source/**` (would fire render).
4. **Push-back** — GitHub-side approved edit → push → bare remote head advances to the merged tree.
5. **Clean three-way** — edits on both sides, different files/lines → merged, both peers converge.
6. **Conflict** — same-line edit both sides → `overleaf-sync/<id>` branch created,
   `overleaf_conflict.json` written, `<id>/source/` on main + `.overleaf-base` unchanged.
7. **Idempotence** — re-run with no new deltas → no commit, no push.

**JS** (`tests/overleaf.test.mjs`): marker/secret-name/label pure helpers.

**Browser gate** (owner UI is DOM, not unit-testable): set marker → seal token → "Pull from Overleaf"
→ status; conflict surface renders from a stubbed `overleaf_conflict.json`. Advisor bundle re-grepped
AI-clean. Stated explicitly; not skipped.

**Deferred (premium-gated, honest):** real `git.overleaf.com` round-trip — cannot run until an Overleaf
paid plan + a throwaway project id/token are available. The simulated bridge proves the git/merge logic;
only the real remote's auth + protocol quirks remain unproven.

## Milestones (within v1)

- **M1 — pull + render:** marker, discovery, pull direction, three-way merge, `.overleaf-base`, commit
  → render. Conflict→branch. (Lands the "edit in Overleaf, review in Footnote" loop.)
- **M2 — push-back:** GitHub→Overleaf push of approved edits, loop-safe via base. Completes bidirectional.
- **M3 — owner UI + seeding + cron:** marker/token setup, "Pull from Overleaf", conflict surface,
  `ensureOverleafPipeline`, opt-in poll.

Each milestone is independently verifiable (its own red-green units + a bare-remote integration test)
before the next.

## Constraints honored

- **Document-agnostic** — no project/doc specifics; discovery is marker-driven; noun via existing helpers.
- **advisor.js AI-clean & untouched** — all UI is owner-side; `js/overleaf.js` is assistant-free.
- **AI-off path unaffected** — sync is orthogonal to Claude; the deterministic path still works.
- **Adopter-owned credentials** — `OVERLEAF_TOKEN_<ID>` sealed by the owner; never hardcoded, never Matt's.
- **Author oversight** — conflicts stage on `overleaf-sync/<id>`; sync never clobbers prose on main.
- **Branch discipline** — built on `feat/overleaf-tier2` off origin/main; cache-bust `?v=` handled on rebase.
- **TDD** — pure core + bare-remote integration are red-green; owner DOM has a stated browser gate.

## Open questions / risks

- **Overleaf git-bridge auth shape** — historically `https://git:<token>@git.overleaf.com/<projectId>`
  with a per-user git-bridge token; newer Overleaf may use per-project tokens/OAuth. The per-project
  `OVERLEAF_TOKEN_<ID>` + shared fallback covers both; real auth confirmed only at the premium step.
- **Binary assets in `source/`** (figures) — three-way on binaries is take-one-side, not line-merge;
  the pure core treats non-text paths as whole-file (base-aware) choose, conflict if both changed.
- **Large source trees** — clone/fetch cost per project per poll; the cron is opt-in and only merges on
  a changed remote head to bound cost.

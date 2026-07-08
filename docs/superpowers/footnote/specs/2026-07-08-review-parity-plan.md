# Review processing: local-parity audit + cloud-parity plan

**Date:** 2026-07-08
**Repo:** `mattlmccoy/footnote` · **Branch:** `sp4-review-safety`
**Builds on spec:** `2026-07-08-local-vs-cloud-review-parity.md` (intake session a25a9cc0)
**Status:** P0 safety SHIPPED; this is the plan for the remaining parity work (P1–P4)

## What already shipped (this branch + deployed)

- **Degenerate-build guard** (`ci_review_common.is_degenerate_content` + `ci_render.build_guarded`):
  content is built to a temp file, validated, and swapped over last-good only if sound. Kills the
  253-byte-stub corruption class. Both render + apply routes use it. 12 tests.
- **Local/cloud hard gate** (`ci_review_common.processing_mode` + `ci_apply.process_project` gate):
  cloud apply is inert unless `<prefix>mode.json` says `cloud`; missing/local marker = inert. 6 tests.
- **Deployed** to `dissertation-tracker-data` (commit `6fb86ef`) with `mode.json=local`, so rfam's
  cloud apply now no-ops instead of corrupting; content is guarded. 172 pytest green.

## Audit — does the generic LOCAL route match dissertation-hub/tracker? (No — gap found)

The proven local route is `dissertation-tracker/scripts/process-reviews.py` (756 lines):
`list → start → [human/agent edits on review-edits/<ch>] → stage → merge`, plus `respond/note/
decide/done`, `verify_refs` gating, content regeneration, outline regeneration, and data-repo
push with rebase-retry.

The generic Footnote engine has only **half** of this locally:
- `ci_local.py` runs **agents** locally (run-agents / author-agent) — the B5 runner. Good, but it is
  NOT the edit round-trip.
- There is **no generic, document-agnostic equivalent of process-reviews.py** `list/start/stage/merge`.
  In "local mode" the app packages queued comments, but nothing generic closes the loop on the
  operator's machine. Matt's dissertation works only because it uses the *hand-written, dissertation-
  specific* process-reviews.py.

**Gap to close (P1):** a generic `process_reviews.py` in `data-template/` (extracted from
process-reviews.py, genericized — no dissertation/RFAM/phd-dissertation literals, env/arg-driven
paths, article-class-aware) providing `list/start/stage/merge`, reusing the shared pure core
(`ci_review_common`) and the SAME degenerate-safe `ci_render.build_guarded` for content rebuild, and
regenerating outline.json on merge (so local is self-sufficient and never needs the cloud outline-sync).

## Parity target (cloud must gain, from the intake spec)

1. **Agent gate** — cloud apply runs the same writer + adversary agents the local route uses, before
   publish/merge. Today the apply/render path runs NO agents (the Agents panel implies otherwise).
2. **Verification gate** — `verify_refs` (0 errors) + build sanity; never publish degenerate (DONE).
3. **No silent bulk-apply** — N un-appliable edits → stop, per-edit status; never stub-and-mark-merged.
4. **Transparency** — UI shows applying/agent-reviewing/verifying/building/publishing + failures.
5. **Truthful status** — `merged` only when the edit is really in main and the rebuilt content contains it.

## Phased plan (TDD red→green each task; browser gate for UI; live-CI gate flagged)

### P1 — Generic local processor (closes the audit gap) — HIGH
- **T1.1** Extract `data-template/process_reviews.py` skeleton + `list` (read jobs.json/reviews, show
  changelist). TDD the pure formatting/selection; live git behind injectable `sh`.
- **T1.2** `start <job>` — branch `review-edits/<unit>` off main in the source repo (in-repo workspace
  OR external clone via `resolve_source`). Reuse `ci_apply.commit_branch` semantics.
- **T1.3** `stage <job>` — flip referenced comments to `staged` (+branch/ts), mark job done, push
  data repo (rebase-retry). Reuse `ci_review_common` staging helpers.
- **T1.4** `merge <unit>` — merge branch→main, rebuild content via `ci_render.build_guarded`
  (degenerate-safe), regenerate outline.json (`parseLatexOutline` equivalent — coordinate with the
  outline generator the import session owns), mark comments `merged`, drop branch. Post-merge
  assertion (parity item 5): the rebuilt content contains the merged edit.
- **T1.5** Genericization sweep: no Matt/RFAM/phd-dissertation literals; `--data/--source` args + env;
  article-class-aware. pytest for the pure core; a local end-to-end against a bare test remote.

### P2 — Cloud agent parity (make the Agents panel real in the apply path) — HIGH
- **T2.1** Insert an agent stage into `ci_apply.process_apply_edits_job`: before staging an edit, run
  the configured writer agent to produce it and the adversary agent to review it (reusing
  `ci_agents`/`run_agent_cli`), recording each agent's output on the comment (transparency).
- **T2.2** Add `verify_refs` invocation to the cloud path (parity item 2 beyond the degenerate guard).
- **T2.3** No-silent-bulk-apply: if any approved edit can't apply/verify, stop that unit, mark per-edit
  `conflict`, never mark the batch merged (extends the existing conflict path).
- **T2.4** Truthful merged status: post-merge assertion in `publish_merge` — only mark `merged` when the
  merged source + rebuilt content actually contain the edit; else `conflict` + keep last-good.

### P3 — Mode toggle UI (writes the marker the gate reads) — MEDIUM
- **T3.1** Settings per-project control "Process reviews: Local (default) · Cloud (experimental)";
  writes `processingMode` to projects.json AND commits `<prefix>mode.json`. Pure plan helper + browser
  gate. Cloud option hidden/labeled experimental until P2 lands.
- **T3.2** Local mode: app packages comments for the local processor and does NOT queue cloud
  apply/merge jobs (enforces mutual exclusion from the app side too).

### P4 — Transparency + outline-sync robustness — MEDIUM
- **T4.1** Surface cloud pipeline steps + failures in the owner UI (not just email).
- **T4.2** `outline-sync.yml` (dissertation-specific, fenced) needs `DATA_TOKEN` — Matt-only. The
  generic local processor regenerating outline on merge (T1.4) removes the hard dependency.

## Fences / non-negotiables

- All generic work lands in `data-template/` (footnote repo). The dissertation-specific
  `process-reviews.py` and `phd-dissertation`/`dissertation-tracker*` are NOT edited (extract-only).
- `advisor.js` stays AI-grep-clean. AI/agents OFF by default; the deterministic
  comment→stage→approve→merge path always works with AI off.
- Cloud mode stays hidden/experimental until P2 parity is met; local remains the default.
- Author-oversight: agents never write source main directly; edits stage on review-edits/<unit>.

## Sequencing note

P1 (generic local processor) is the highest-value gap — it makes "local mode" a real product feature,
not a dissertation-only script. P2 (cloud agent parity) is what lets cloud ever be trusted. P3/P4 are
the UI + transparency around them. Each phase is its own spec→plan→implement cycle.

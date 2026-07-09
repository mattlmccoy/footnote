# Cloud review parity + live "watch it work" view

**Date:** 2026-07-09
**Repo:** `mattlmccoy/footnote` · **Branch:** `feat/cloud-parity-live-view`
**Builds on:** the merged review-safety work (degenerate guard, local/cloud hard gate, local processor,
mode toggle — PR #10) and the parity plan `2026-07-08-review-parity-plan.md`.

## Goal

Make the **cloud** (GitHub Actions) review route match the **local** route's quality — run the same
writer + critic/adversary agents, verify, and never corrupt or lie about status — AND give the user a
**live, human-narrated view** of the cloud job as it works (like watching a Claude Code session step
through the document), not a debug log.

## Hard constraints

- **Serverless** — no new server/infra; everything runs on the adopter's own GitHub with their token
  (the held "no server" line). The parked Phase-2 Worker is NOT required here.
- **Author-oversight preserved** — every approved edit only *stages* on `review-edits/<unit>`; nothing
  merges to source main without the author. AI/agents OFF by default; the deterministic
  comment→stage→approve→merge path is unchanged and always works with AI off.
- **Non-breaking** — additive; `advisor.js` untouched + AI-grep-clean.
- **Local stays default; cloud stays labeled experimental** until parity is verified on a live run.

## Architecture: one shared progress stream couples the two phases

The **progress-event stream is the interface**. Phase 1 (the stream + live view) ships usable
immediately — even the current mechanical apply becomes watchable. Phase 2 (the agent pipeline) emits
*richer* narration into the same stream.

### Transport (decided: #1, poll a data-repo file)

The cloud job appends events to **`<prefix>progress/<job>.jsonl`** (one JSON object per line) and commits
them incrementally with `[skip ci]`; `progress/**` is excluded from every workflow trigger so it never
loops. The portal **polls the raw file every ~2–3s** and renders a live timeline; polling stops on a
terminal `done`/`error` event. Serverless, reuses the token + the exact pattern everything else uses.
Step-level granularity (per comment / per agent / per edit) refreshing every couple seconds — reads like
watching Claude work; token-level streaming (a later nicety) would ride the parked Worker with no redesign.

## Phase 1 — narrated progress stream + live view

### Event contract (narration-first)

The **primary content of each event is a human sentence** (`say`); machine fields drive only the visual
state and an opt-in debug view.

```json
{"ts":"2026-07-09T…","job":"j_…","seq":7,"comment":"c_…","phase":"read|apply|agent|verify|build|stage|merge|done|error",
 "agent":"dissertation-writer",            // present on agent events
 "status":"running|ok|conflict|error",
 "say":"The equations aren't referenced in the text, so I'm adding \\eqref to both.",
 "edit":{"before":"…as shown.","after":"…as shown in \\eqref{eq:loss} and \\eqref{eq:depth}."}}  // optional
```

- `phase` drives the row icon/grouping (spinner → check → warn); `say` is what the user reads; `edit`
  renders as an expandable before→after diff. A terminal `done`/`error` closes the stream.
- **Two narration sources, interleaved into a per-comment story:** (1) **engine narration** — templated
  plain sentences at each deterministic step ("Reading comment 2 of 4 — reviewer asks whether…", "Staged
  on `review-edits/ch_background` for your review."); (2) **agent narration** (Phase 2) — each agent
  returns a first-person `say` alongside its edit/verdict ("checked both `\eqref` targets resolve —
  approved").

### Emission (CI shell + pure builder)

- Pure `progress_event(job, seq, comment, phase, say, **opt)` (TDD'd) builds the object.
- Thin `emit(prefix, job, event)` in `ci_apply` appends the JSONL line + commits (`[skip ci]`). A
  per-job `seq` counter orders events. Even the current mechanical apply emits: job start → per comment
  (read → applying → staged/conflict) → preview build → done.

### Live view (portal, serverless poll)

- Pure `js/cloudprogress.js`: `parseEvents(jsonlText)`, `groupByComment(events)`, `isTerminal(events)`,
  `summaryLine(events)` (the running headline, e.g. "Working on comment 2 of 4 · writer") — all TDD'd.
- DOM: a **"Cloud activity"** panel opened from the Send-to-Claude menu (Cloud mode) and auto-surfaced
  after queuing a cloud job. It polls `<prefix>progress/<job>.jsonl` every ~2–3s and renders a **narrated
  feed grouped by comment** — each comment a little story (asked → looked at → changing & why → verified →
  staged ✓ / conflict ⚠ with reason), a running headline on top, expandable diffs, and a small **"Show
  technical details"** toggle exposing the raw machine fields (debug, opt-in). Stops polling on terminal.
  Browser-gated.

## Phase 2 — the agent pipeline (cloud reaches local quality)

Replaces cloud's single mechanical edit with a **per-comment pipeline** mirroring the local flow, all
narrated. For each comment in an apply-edits job:

1. **Writer agent** returns `{edit:{before,after}, say}` — reasons about the comment and proposes the
   edit + its rationale. (Item 1: agent gate is real, not implied by the Agents panel.)
2. **verify_refs gate** — a generic `verify_refs` on the edited source: every `\ref/\cref/\eqref/\cite/\label`
   resolves (0 errors). Fail → not staged; emit the reason. (Item 2.)
3. **Critic / adversary stack** — the project's configured `reviewAgents` review the proposed edit
   read-only; each emits a verdict + `say`. On rejection, the writer **revises** (bounded ~2 passes,
   narrating each), still failing → conflict. (Item 1.)
4. **Degenerate-build guard** on any content rebuild (already shipped).
5. **Stage or conflict, per comment** — approved → `staged` on `review-edits/<unit>`; failed → `conflict`
   with reason. Never stub-and-mark-everything-merged. (Item 3.)
6. **Truthful merged status** — `publish_merge` asserts the merged source AND rebuilt content actually
   contain the edit before marking `merged`; else conflict + keep last-good. (Item 5.)

**Runs / reuses:** the Claude Code CLI in the adopter's Action via the existing `run_claude_cli`/
`run_agent_cli` boundary + the `ci_agents` catalog. Generic product uses configured `reviewAgents`/
builtins; the dissertation's 5-agent stack is just its configured set. Agent output schema gains a
`narration` field parsed by `parse_claude_edits`/`parse_agent_findings`.

## Components (new / touched)

New:
- `data-template/ci_progress.py` (or a section of ci_review_common) — pure `progress_event` + seq; `emit`
  in `ci_apply`.
- `data-template/export/verify_refs.py` — generic undefined-reference checker (ported + genericized from
  the dissertation's).
- `js/cloudprogress.js` — pure timeline model for the live view.
- Owner-portal "Cloud activity" panel in `app.js` (poll + render).

Touched (additive):
- `ci_apply.process_apply_edits_job` / `process_project` — the per-comment pipeline + emission.
- `ci_review_common` — pipeline decisioning (revise-loop control, verdict tally, stage/conflict routing),
  the truthful-merged assertion, narration plumbing.
- `ci_agents` — agent prompts ask for a `say` narration; findings/edit parsers keep it.

## Testing

- **Pure (TDD, pytest + node):** `progress_event`; `cloudprogress` model; pipeline decisioning +
  revise-loop + verdict tally + stage/conflict routing; `verify_refs` parsing; truthful-merged assertion.
- **Integration (mocked agents, real git — like existing ci_apply tests):** full apply-edits run with
  injected writer/critic fakes → asserts stage-vs-conflict outcomes, the emitted `progress/<job>.jsonl`
  sequence, and that it never stub-and-merges.
- **Browser gate:** the live-view panel polling a canned progress.jsonl → narrated feed fills live, stops
  on `done`, debug toggle works.
- **Live-Actions gate (Matt):** the real agent pipeline needs the Claude token on the adopter's Actions —
  same gate as today's apply; verified on a real cloud job.

## Rollout gating

- Phase 1 (live view + narration) ships usable immediately.
- Phase 2 (agent pipeline) gated behind the AI master switch + configured `reviewAgents` + Claude token.
- Cloud stays labeled **experimental** (the mode toggle) until a live parity run passes; **local remains
  default**.

## Non-goals

- No token-level streaming / Worker relay (parked; rides the future broker with no redesign).
- No change to the local processor or the deterministic path.
- No auto-merge — author-oversight invariant unchanged.
- Not fixing the reader's missing display-equation numbers (a separate Phase-3/`chapter-html.sh` render
  bug surfaced 2026-07-09 — tracked separately).

## Decomposition / order

Phase 1 first (progress contract + emission from the current apply + the live view) → immediate value +
the interface locked. Then Phase 2 (agent pipeline emitting rich narration) on top. Each is its own
writing-plans → TDD → verify cycle.

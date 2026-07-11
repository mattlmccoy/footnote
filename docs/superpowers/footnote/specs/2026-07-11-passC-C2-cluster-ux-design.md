# Pass C2 (UX) — cluster overlapping reviewer comments — design

Date: 2026-07-11
Repo: github.com/mattlmccoy/footnote
Status: spec — design approved in brainstorm (cluster treatment, overlap-triggers-conflict-escalates,
tight quote-overlap granularity). Backend C2c (span-collision at merge) already shipped — this is the UX.

## Problem

When two reviewers comment on the same passage, the author's reading-view rail shows them as separate,
adjacent cards — easy to miss that they're about the same spot, and a genuine edit-conflict (two approved
edits on the same text) only surfaces as an error at merge (C2c). Surface the overlap in context, and give
a conflict one place to resolve.

## Locked decisions (C2 brainstorm)

1. **Cluster** treatment (not stacked): overlapping comments become one grouped card.
2. **Overlap clusters, conflict escalates**: any 2+ comments on the same passage cluster; if 2+ of them
   carry conflicting source EDITS, the cluster shows a "both edited this — resolve" banner.
3. **Tight granularity**: cluster on **overlapping anchor-quote spans** within a unit (same sentence/
   phrase), not same section/heading.
4. **Author-side only**: only the author sees multiple reviewers' comments (each reviewer sees just their
   own `advisor/<id>` file). So clustering lives entirely in `js/app.js` (`renderAdvisorSection`);
   `js/advisor.js` is untouched and trivially stays AI-grep-clean.

## Detection — `js/clustercomments.js` (pure, TDD)

- `clusterComments(comments, locate)` → an ordered list of groups (each a list of comments).
  - `locate(quote)` → `[start, end]` char span of the quote in the unit's rendered text, or `null`
    (injected so it's testable without a DOM; the caller passes a locator over `#doc`'s text).
  - Two comments are in the same group when their located spans overlap (`a.start < b.end &&
    b.start < a.end`); grouping is **transitive** (A–B, B–C ⇒ one group) via union-find.
  - Comments whose quote can't be located (null) or that overlap nothing are their own singleton group.
  - Order preserved (first-seen).
- `clusterHasConflict(group)` → true when **2+** comments in the group carry a source edit
  (`comment.edit` or `comment.source_edit` with a `find`). Same passage + 2 edits = a real conflict.
  (Reuses the C2c notion; the tight quote-overlap already means the edits target the same span.)

## Rendering — `renderAdvisorSection` (app.js)

- Run `clusterComments` over the loaded reviewer comments (`advisorComments`) for the current unit.
- **Singleton groups** render exactly as today (one reviewer comment card — no behavior change).
- **Multi-comment groups** render as a **cluster card**:
  - Header: `<i ti-users> N reviewers · this passage`.
  - The shared quote shown once (the longest/earliest span in the group).
  - Each member comment nested with its existing per-comment actions (reply, resolve, suggest edit,
    send to Claude when AI-on) — reuse the existing card body builder, minus its own quote line.
  - A single merged highlight for the group's span in `paintHighlights` (overlapping highlights become
    one).
- **Conflict escalation**: when `clusterHasConflict(group)`, the cluster shows a banner
  `both edited this — resolve` and, per conflicting edit, a `keep this edit` action. Choosing one sets
  that comment `approved` and the other conflicting edit(s) `declined` (existing status transitions), so
  only one edit lands; C2c's backend guard stays the safety net.

## Out of scope (v1)
- Inbox re-architecture: the Reviewers inbox keeps its per-reviewer grouping; add only a small
  "shared passage" chip on rows whose comment is in a multi-reviewer cluster (nice-to-have; may defer).
- Clustering the author's OWN comments with reviewers' (v1 clusters reviewer comments only).
- Reviewer-side changes (`advisor.js`) — none; reviewers never see other reviewers.

## Testing
- `tests/clustercomments.test.mjs` (node --test, red-green): overlap groups two; transitive chains three;
  disjoint stays separate; unlocatable quote → singleton; `clusterHasConflict` true only with 2+ edits.
- Browser-verify (owner harness, fetch-stubbed): two reviewer comments on one sentence → one cluster card
  ("2 reviewers · this passage"), a third disjoint comment stays separate; a cluster with two suggested
  edits shows the resolve banner and "keep this edit" sets approved/declined; merged highlight.

## Process
- Worktree off `main`; TDD `clusterComments`/`clusterHasConflict` first; browser-verify the rail + banner;
  `advisor.js` untouched (AI-clean by construction); push to main only on Matt's say-so; expect cachebust
  `?v=` churn (per-file content hashes now).

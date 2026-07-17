# Hidden owner debug page — design

**Date:** 2026-07-16
**Status:** Approved (pending spec review)
**Repo:** `mattlmccoy/footnote` (serves footnotedocs.com)

## Purpose

A hidden, owner-only diagnostics page for Footnote. One screen that answers, at a glance:

- What build is deployed, and is the page I just came from running a stale bundle?
- Is GitHub reachable, is my owner token valid, and does it have the scopes the app needs?
- For every project and every document: is the rendered reading view **in sync with the source `main`**, or is it behind — and did *that document's* source file actually change?
- Is the pipeline healthy (processing mode, job queue, last deploy)?

It exists because these signals are currently scattered across the app (or only inferable from raw GitHub state), and when something looks wrong there is no single place to confirm *where* the drift or breakage is. This is a personal forensic tool, not a user-facing surface.

## Non-goals

- Not linked from any user-facing navigation; not documented to reviewers.
- Not a mutation surface. **Read-only** — it never writes to any repo, never triggers jobs, never changes state. (The only write is to the clipboard, on explicit click.)
- Not a replacement for the existing net-health banner or build orb; it complements them.
- No new authentication model, no new stored credentials.

## Access & hiding model

- **Standalone page:** new `debug.html` + `js/debug.js`, served from the same origin as the rest of the site.
- **Auth:** reads the existing owner token from `localStorage['ghpat']`. No paste, no new login. Without a valid token the page renders a minimal "not authenticated" shell and makes no API calls.
- **Why this is "hidden" safely:** GitHub Pages serves every file publicly, so the URL is reachable by anyone. What gates it is that every real signal requires the **owner** token (Contents+Actions+Secrets+…), which only the owner has in their browser. A reviewer (who holds only the Contents-only reviewer key, not `ghpat`) sees the blank shell. The page never displays the token value itself.
- **Entry gesture:** **Alt+click the build orb** (`#fn-build`, rendered by `js/buildinfo.js` on hub/owner/advisor pages) opens `debug.html`.
  - `buildinfo.js` is imported by `advisor.js` (the AI-clean reviewer bundle), so the added gesture code must stay **AI-term-free** (no "claude"/"assistant"/"AI" identifiers), consistent with the file's existing constraint.
  - Reviewers also see the orb; the gesture simply opens the token-gated page, which is blank for them. Acceptable — no reviewer data is exposed.
  - Deep-link: `debug.html?project=<id>` opens straight into one project's expanded table.

## Data sources (all already present)

| Signal | Source |
|--------|--------|
| Deployed build sha + time | `build.json` (`{sha,time}`) |
| This-page bundle staleness | `version.js` (`parseVersion`/`latestFromHtml`/`isStale`) against the referring page's HTML |
| Net health | `netstatus.js` `netHealth` + live sample of an API call latency |
| Token valid + login | `GET /user` |
| Token scopes | `x-oauth-scopes` response header on any authenticated call; classic-token case. For fine-grained tokens (no scope header) fall back to capability probes (`checkActionsAccess`, `listSecretNames` from `ghsecrets.js`) |
| API rate limit | `GET /rate_limit` |
| Processing mode | `mode.json` (`processingmode.js`) |
| Job queue | `jobs.json` (queue depth, oldest-job age by `id`/ts) |
| Project list | hub `projects.json` via `config.js` `loadProjects` |
| Per-doc manifest | project config `chapters` (`{id,n,title,sourceFile}`) via `loadChapters` |
| Doc rendered? | `content/<id>.html` present in the Review repo tree (`ghTree`) |
| Doc built-from commit | `reviews/<id>.json` `built_from_commit` |
| Source `main` HEAD | `GET /repos/<source>/commits/main` |
| Drift depth + file-touched | `GET /repos/<source>/compare/<built_from>...main` → `ahead_by` and whether any changed `files[].filename` equals the doc's `sourceFile` |
| Open review-edits branch | `GET /repos/<source>/branches` (or `git/refs/heads/review-edits/<id>`) |
| Open comments | `reviews/<id>.json` comments filtered by `isActiveComment` (model.js) |

## Layout (three tiers)

1. **Header bar** — `Footnote · Debug`, deployed build pill, this-page staleness note, last-refreshed time + reload link, **Copy snapshot** button.
2. **Two cards** — *GitHub connection* (token/scopes/reachability/rate-limit) and *Pipeline* (mode/queue/oldest job/last deploy).
3. **Projects** — one collapsible row per project (rollup: doc count, N behind main, open-comment count, worst-status dot); expand → per-document table with a small sync bar + dot per row.

Visual language: flat, theme-aware (light/dark via CSS vars), status encoded as green/amber/red dots and a per-doc sync bar. No gradients or chrome.

## "vs main" computation (Option B)

For each source repo, fetch `main` HEAD once. For each doc:

- `built_from_commit` empty or `content/<id>.html` missing → **not rendered** (n/a).
- `built_from_commit === main HEAD` → **in sync** (full green bar).
- else `compare/<built_from>...main`:
  - `ahead_by === 0` → in sync (identical tree, different sha).
  - `ahead_by > 0` **and** the doc's `sourceFile` is among the changed files → **behind (your file changed)** — amber, "N behind".
  - `ahead_by > 0` **and** `sourceFile` not touched → **behind (file unchanged)** — muted/neutral, "N behind · your file untouched". This is the key insight the binary check misses.

Compare calls run only for docs that aren't already equal to HEAD; results are keyed by `built_from` so identical commits share one call.

## Copy-to-clipboard snapshot

The **Copy snapshot** button serializes the current computed state to a plain-text (Markdown) block and writes it to the clipboard via `navigator.clipboard.writeText`. Contents:

- Timestamp, deployed build sha+time, this-page bundle sha + stale flag.
- GitHub: login, token-valid, scopes list, rate-limit remaining, net state. **Redacted:** never the token, never secret *values* (only secret *names present* / scope names).
- Pipeline: mode, queued/running counts, oldest-job type+age.
- Per project: id, doc count, N behind, open comments; then a per-doc line `id · rendered · built_from · sync-state · openN`.

Purpose: paste into a note or a message to myself when something's off, without screenshotting. A `Copied ✓` confirmation replaces the label for ~1.5s. Pure serializer (`buildSnapshot(state) -> string`) is unit-tested.

## Module boundaries

- **`js/debug.js`** — owns the page. Split into pure helpers (tested) + a thin DOM renderer + the fetch orchestration:
  - `classifySync({builtFrom, mainSha, ahead, fileTouched, rendered}) -> {state, label, fill}` — the per-doc verdict.
  - `rollupProject(docVerdicts, comments) -> {docCount, behind, open, worst}` — the collapsed row.
  - `diffScopes(present, required) -> {ok, missing}` — scope gap vs the app's needs.
  - `queueAge(jobs, now) -> {queued, running, oldest}` — pipeline summary (now passed in; no `Date.now()` in pure code).
  - `snapshotLines(state) -> string` / `buildSnapshot(state)` — the clipboard text.
  - `render(state)` + `boot()` — DOM + orchestration (browser-verified, not unit-tested).
- **`js/buildinfo.js`** — add the Alt+click-orb → `debug.html` gesture, AI-term-free. Keep the existing hover/pin behavior intact (plain click still toggles the build line; Alt+click navigates).
- No changes to `app.js`, `model.js`, `advisor.js` logic beyond what the gesture requires.

## Testing (red-green)

`tests/debug.test.mjs` (node --test), written test-first:

- `classifySync`: in-sync (equal sha), in-sync (ahead 0), behind+file-touched, behind+file-untouched, not-rendered.
- `rollupProject`: worst-status wins; behind/open counts; all-in-sync happy path.
- `diffScopes`: missing Secrets/Actions flagged; full set → ok.
- `queueAge`: empty queue; oldest picked by ts; running vs queued split.
- `buildSnapshot`: includes build/git/pipeline/project lines; **asserts the token value and secret values never appear** (redaction guard).
- Gesture: a `buildinfo.js` unit test that Alt+click on the orb calls the navigation hook with `debug.html` (and a plain click does not) — DOM-light, using the existing `showBuildTag(metaUrl, win)` injectable-window seam.

DOM render + live drift numbers are browser-verified against the live site while authenticated (read-only, so safe on production).

## Deploy

Same as any change: push → `cachebust.yml` re-stamps `?v=` tokens and Pages redeploys. `debug.html` gets its own stamped bundle references. No data-repo or workflow changes. Confirm on live before considering done (the page is read-only, so there is no data risk).

## Open risks / notes

- **Rate limit:** worst case ≈ (1 `/user`) + (1 `/rate_limit`) + (1 `main` HEAD + 1 branches per source repo) + (1 compare per behind-doc). For a handful of projects this is well under the 5,000/hr budget; the page shows the remaining budget so the cost is self-evident. No polling — refresh is manual.
- **Fine-grained tokens** omit `x-oauth-scopes`; the capability-probe fallback keeps the scopes card honest rather than blank.
- **Multiple source repos:** the per-source `main` fetch is memoized by repo, not assumed single.

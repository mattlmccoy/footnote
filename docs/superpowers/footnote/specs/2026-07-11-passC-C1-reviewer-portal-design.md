# Pass C1 — reviewer multi-document portal (Home) — design

Date: 2026-07-11
Repo: github.com/mattlmccoy/footnote
Status: spec — design approved in brainstorm (mockups are the contract); awaiting author review of this doc.

## Problem

A reviewer invited to several documents has one invite link per document and must dig the email out
every time. There's no reviewer "home." Goal: a reviewer landing that lists every document shared with
them, so after the first click per document they never hunt for a link again.

## Locked decisions (from the C1 brainstorm)

1. **Discovery = remembered links (client-side recents).** Every invite link the reviewer opens is
   remembered in *that browser* (the `a/p/data/k/n` tuple + doc title). Home lists them, across all
   authors/workspaces. No reviewer-id matching, no server state. (Rejected: within-workspace auto-discovery
   and cross-author accounts — parked.)
2. **Backwards compatibility is a hard constraint.** Every reviewer link already sent must open its
   document unchanged. Home is *additive*, only on the bare entry.
3. **Aesthetic = the author launcher's book-shelf**, reused faithfully (warm paper theme, `fn-shelf` of
   `fn-book` cards with colored spines, serif titles, "open" on hover), fields repurposed for a reviewer.
4. **"N new" badge is IN v1.**
5. **Reviewer identity must be obvious** — a "Reviewer" pill + "Reviewing as <name>", using the word
   "Reviewer" throughout (never "advisor" in display copy).
6. **Back-to-Home** = an always-visible "← All documents" link in the reader topbar + the brand mark →
   Home. No doc-to-doc quick switcher (back-link only).
7. **Use the real Footnote logo** — the `MARK()` inline SVG (hub.js:138, the margin-note glyph; asset
   `brand/footnote-mark.svg`), NOT an ad-hoc "F" box.

## Backwards-compatibility — the router (most important part)

`advisor.js boot()` today reads `&p=` once, sets `_PREFIX`, then loads config→chapters→release→title→doc
home in a straight line; no `&p=` is an error path (`showLinkBroken`). New router splits on the URL:

- **Has `&p=`** (workspace link) **or a legacy `&data=` link whose repo has root chapters** → **open that
  document, exactly as today** (`openProject(paramsFromUrl)`). *Every link already sent hits this path —
  byte-identical behavior.*
- **Bare entry** (no `&p=`, no doc to open) → **Home**: recents non-empty → the shelf; empty → the
  "open your invite link from your email" empty state.
- **Malformed workspace link** (has `&data=` but no `&p=`, repo IS a workspace) → the existing
  `showLinkBroken` screen, plus a new "Go to your documents →" link when recents exist.

Net: existing links never see Home; Home only appears on a bare `advisor.html` (bookmark or the
"← All documents" back-link, which navigates to bare `advisor.html`).

## Components

### `js/reviewerhome.js` (pure, TDD) — new
- `recentsKey()` → `'footnote:reviews'`.
- `recentsAdd(list, entry)` → dedupe by `data+'/'+p` (or `data` for legacy no-`p`), move-to-front, merge
  fields (title/seenReleased/ts win from the newer entry). Returns a new array.
- `recentsList(raw)` → parse + validate + newest-first (by `ts`).
- `linkFor(entry)` → reconstruct `advisor.html?a=<a>&n=<n>&data=<data>&p=<p>&k=<k>` (omit `&p=` for legacy).
- `newCount(entry, currentReleasedIds)` → count of released unit ids present now but absent from
  `entry.seenReleased` (releases added since the reviewer last opened). 0 when unknown.
- All AI-term-free (advisor.js imports it and stays grep-clean).

### `js/brandmark.js` (shared) — new (small infra)
- Extract `MARK(accent)` from hub.js into `export function brandMark(accent)` (the exact inline SVG at
  hub.js:138). Refactor hub.js to import it (single source of truth); advisor.js imports it for Home +
  topbar. AI-term-free.

### `advisor.js` — boot refactor + Home + topbar
- **C1-slice1 boot refactor:** extract a re-runnable **`openProject(params)`** = the current boot body
  from config load through the doc home (sets `_PREFIX`, config, `CHAPTERS`, release, title, `enterHome`).
  Add the **router** above `openProject`. Existing single-project behavior must be **byte-identical**
  (regression-verified in the browser: an existing `&p=` link opens straight to its doc).
- **Home view (`renderReviewerHome`)**: the `fn-shelf` of `fn-book`s built from `recentsList()`, each
  book = `{brandMark spine color by index, who-shared (n/owner), serif title, last-opened, "N new" badge,
  "open"}`; clicking a book navigates to `linkFor(entry)` → router → `openProject`. Empty state when no
  recents. Header: brand mark + "Reviewer" pill + "Reviewing as <name>", eyebrow "Shared with you",
  h1 "Documents to review".
- **Topbar identity + back-link**: the reader topbar (advisor.js ~255) gains the real brand mark + a
  "Reviewer" pill + "← All documents" (→ bare `advisor.html`) + keeps "Reviewing as <name>" and the
  chapter switcher.
- **Recents write**: at the end of a successful `openProject`, upsert the recents entry
  `{a, p, data, k, n, title, seenReleased:<current released ids>, ts:<now>}` via `recentsAdd` → localStorage.

## Data flow

1. Reviewer clicks an emailed link (`&p=…&k=…`) → router → `openProject` → doc loads → recents upserted
   (title + released snapshot + timestamp).
2. Reviewer clicks "← All documents" → bare `advisor.html` → router → `renderReviewerHome` reads recents.
3. Home, per book, fetches that entry's `release.json` (using the entry's own `data`+`k`) and computes
   `newCount(entry, released)` for the badge. N concurrent fetches (a handful of docs) — the only
   per-doc network cost; failures degrade to no badge, never block the shelf.

## Storage & privacy

- `localStorage['footnote:reviews']` — an array of entries, per browser only. Carries the access key
  (`k`), exactly as today's single-link storage already does (Model A, shared key, no rotation). Nothing
  leaves the browser; no server identity.

## Edge cases

- Revoked/expired reviewer on a remembered doc → opening it hits the existing `showRevoked` /
  `showKeyExpired` screens (unchanged).
- A doc whose `release.json` fetch fails on Home → book still lists, just no badge.
- Legacy (no-`p`) remembered links → `linkFor` omits `&p=`; router opens them via the legacy path.
- **Deferred:** remove-from-recents (a stale/finished doc lingering) — note it; a small hover "×" or ⋯
  can come later. Doc-to-doc quick switcher — deferred (back-link only). Auto-discovering unopened
  siblings — parked.

## Slices (TDD red-green first; browser-verify UI)

1. **C1-slice1 — boot refactor.** `openProject(params)` + router. Regression gate: existing `&p=` link
   opens its doc identically; bare entry routes to Home; malformed workspace link still shows link-broken.
2. **C1a — recents store.** `reviewerhome.js` (`recentsAdd`/`recentsList`/`linkFor`) + write-on-open.
   Tests: dedupe/move-to-front, legacy vs workspace key, link reconstruction, malformed input.
3. **C1b — Home shelf + topbar identity + back-link + real brand mark** (extract `brandMark`). Browser-
   verify: shelf renders in the launcher aesthetic with the real logo; "Reviewer" pill + "Reviewing as";
   back-link round-trips to a doc and back.
4. **C1c — "N new" badge.** `newCount` diff + per-doc `release.json` fetch + `seenReleased` snapshot on
   open. Tests: new releases counted, none when unchanged, unknown → 0. Browser-verify a badge appears.

## Testing & process

- Pure units red-green with `node --test`: `recentsAdd`, `recentsList`, `linkFor`, `newCount`.
- Browser-verify (fetch-stubbed reviewer harness): router compat (existing link unchanged), shelf render
  + real brand mark, identity, back-link round-trip, badge.
- Dedicated worktree off `main`; `advisor.js` stays AI-grep-clean; push to main only on Matt's say-so;
  expect cachebust `?v=` rebase churn.

## Out of scope (parked)
Cross-author reviewer accounts / server identity; real-time presence; doc-to-doc switcher; auto-discovery
of unopened siblings; recents management UI beyond the deferred remove.

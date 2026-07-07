# Pass A — parity fixes, build-info, and Reviewers-page reorg

Date: 2026-07-06
Repo: github.com/mattlmccoy/footnote (local: put_github_repos_here/footnote)
Status: spec — awaiting author review before plan

## Scope

Four self-contained "quick correctness + parity" items, from Matt's session notes. All ship
together as Pass A. No AI surface touched; the deterministic comment→stage→approve→merge path is
unaffected. `advisor.js` must stay AI-grep-clean.

1. **#1 Stale workspace onboarding copy** — the second startup page still says the workspace repo
   holds only the *list* of projects, contradicting the locked one-repo-holds-everything model.
2. **#3 Build-info + refresh affordance** — nothing tells a user which build they're running, so
   cache staleness is undiagnosable. Surface the running SHA + a cache-busting refresh, both portals.
3. **#4 Reviewer card progress parity** — the reading-progress bar exists only on author chapter
   cards; add the equivalent to reviewer cards. (Matt chose "keep author, add reviewer".)
4. **#5 Reviewers-page reorg** — reorder sections per Matt's screenshot, move the deploy checklist
   to the bottom as collapsible/dismissable, and point email setup to Settings (no code extraction).

Out of scope (explicitly deferred): the broader author-vs-reviewer feature-parity audit (#4 was
narrowed to just the progress indicator); the two-reviewers-same-section design (#6); the reviewer
multi-document portal (#2); whole-doc references/appendix fix (#5-original). Those are later passes.

---

## Item 1 — Workspace onboarding copy

**File:** `js/hub.js` (`setupWorkspace`, lines ~249–253). Pure copy; no logic.

Current (wrong — predates consolidation):
> Set up your **workspace**.
> This is just a small private repo that holds the **list** of your projects — **not** your
> document or its comments. You'll pick those next, one per project. Create it now, or choose one
> you already have.

New:
> Set up your **workspace**.
> This one private repo is your whole Footnote workspace — it keeps your projects, their documents,
> and every comment together, one folder per project. Create it now, or choose one you already have.

Field sub-label (line ~253): `Projects index — a tiny private repo, e.g. footnote-projects` →
`Workspace repo — one private repo, e.g. footnote-projects`.

**Verification:** browser — load `index.html` unconnected → onboarding step 1 shows the new copy in
both the "Create it for me" and "Use an existing repo" states. No test (pure copy).

---

## Item 3 — Build-info + refresh

**Root cause:** each shell loads its module with a cache-bust query — `owner.html` →
`./js/app.js?v=<sha>` (owner.html:424), `index.html` → `./js/hub.js?v=<sha>`, `advisor.html` →
`./js/advisor.js?v=<sha>`. At runtime `import.meta.url` carries that `?v=<sha>`, so each entry
module already knows its own build. Nothing surfaces it.

**New pure module `js/buildinfo.js`:**
- `buildSha(metaUrl)` → returns the `v` query value from a module URL, or `'dev'` when absent/blank.
  - `".../app.js?v=79b46e8"` → `"79b46e8"`
  - `".../app.js"` → `"dev"`
  - `".../app.js?v="` → `"dev"`
  - malformed / non-URL string → `"dev"` (never throws)
- `showBuildTag(metaUrl, win)` → injects (idempotently — no-op if `#fn-build` exists) a muted,
  fixed bottom-corner pill into `win.document`: text `build <sha>` + a `Refresh` action.
  - `Refresh` → `win.location.replace(pathname + '?r=' + Date.now())` (reloads the top-level HTML
    bypassing the CDN-cached copy, which pulls the newest module `?v=`). Uses an injected `now`
    seam or reads `win`'s location only at click time so the pure part stays testable.
  - Styling: tiny, `var(--text-3)`, low opacity, non-interactive except the Refresh link;
    `position:fixed;bottom;left`, high `z-index` but below modals. Must not overlap the netstatus
    banner (top) — it sits bottom-left.

**Wiring:** one line after each existing `startNetWatch()` boot —
`app.js:19`, `hub.js:10`, `advisor.js:13` → `showBuildTag(import.meta.url, window)`.
`buildinfo.js` contains zero AI terms, so `advisor.js` stays grep-clean.

**Tests (red-green, `tests/buildinfo.test.mjs`, node --test):** `buildSha` across the four cases
above. `showBuildTag` DOM insertion + idempotency can be unit-tested with a minimal fake `win`
(jsdom-free: pass a stub with `document.getElementById`/`createElement`/`body.appendChild`), or
browser-verified — decide in plan; the `buildSha` parse is the load-bearing unit.

**Verification:** browser — each of owner/launcher/reviewer shows `build <sha>` bottom-left; the SHA
matches the `?v=` in that page's script tag; clicking Refresh reloads with `?r=<ts>` and the pill
reappears. Confirm advisor bundle still grep-clean for AI terms.

---

## Item 4 — Reviewer card progress parity

**Current asymmetry:**
- Author chapter cards (`app.js:2388`) render a reading-progress bar from `chapterStats(ch)`:
  `checked = Object.keys(review.read).length`, `sec = review.secCount`, `frac = checked/sec`.
  Author persists `secCount` in its `review:<ch>` object.
- Reviewer already tracks per-section read check-offs (`advisor.js:486` `review.read`, count vs
  `hs.length` at :488) but **does not persist a section total**, and the reviewer home card
  (`advisor.js:1061`) shows only a comment count — no progress bar.

**New pure module `js/cardstats.js`:**
- `readProgress(review)` where `review` is `{read?:object, secCount?:number}` →
  `{ doneN, secN, frac, done }`:
  - `doneN = review?.read ? Object.keys(review.read).length : 0`
  - `secN = review?.secCount || 0`
  - `frac = secN ? doneN/secN : 0`
  - `done = secN > 0 && doneN >= secN`
  - null/undefined/empty review → `{doneN:0, secN:0, frac:0, done:false}` (never throws)

**Reviewer changes (`advisor.js`):**
1. Persist the section total: where the section nav renders (~486–488, `hs` known), set
   `review.secCount = hs.length` and `save()` so the home card can later compute a fraction.
   Before a reviewer opens a chapter there's no `secCount` → card honestly shows "open to review"
   (mirrors the author's "not started").
2. Home card (`advisor.js:1061`): compute `const p = readProgress(r)` and render the same
   progress-bar markup the author uses (5px bar, `var(--accent)`/`var(--success)` when `done`,
   width `p.done?100:round(p.frac*100)`), keeping the existing comment-count line. Import
   `readProgress` from `./cardstats.js?v=<sha>`. `cardstats.js` is AI-term-free → advisor stays clean.

**Author refactor (`app.js`):** `chapterStats` (or the card at :2388) derives `checked/sec/frac/
readDone` from `readProgress` so both portals share one source of truth. Keep `chapterStats`'
comment-status fields (`open`/`merged`/`total`) as-is; only the read-progress derivation moves to
the shared helper. Behavior must be byte-identical for the author (regression-guard by test).

**Tests (red-green, `tests/cardstats.test.mjs`):** `readProgress` — full (done), partial, zero-total
(unopened), missing `read`, null. Plus a guard asserting the author's derived `{checked,sec,frac,
readDone}` equals the pre-refactor inline computation for representative inputs.

**Verification:** browser (reviewer harness) — a reviewer card shows no bar before opening; after
opening a chapter and checking N of M sections, the card shows an N/M bar matching the author's
behavior. Author cards unchanged.

---

## Item 5 — Reviewers-page reorg (`openReleasePanel`, app.js:2841)

The panel is one `innerHTML` block (2901–2932); `#rel-preflight` (deploy checklist, filled at
~3555) and `#rel-board` (reviewer status, filled at ~3530) are populated asynchronously by id, so
reordering = moving blocks in the template; the async fillers still find their divs.

**New section order (Matt's screenshot is the contract):**
1. **Access — which sections each reviewer sees** (matrix + Save & publish + reviewer links) — first.
2. **People** (blurb + add-reviewer grid + `#adv-list` + `#adv-stat`).
3. **Reviewer status** (`#rel-board`).
4. **Inbox — comments received** (`inboxHtml`). *(Kept above the checklist — author's working
   surface. Confirmed with Matt.)*
5. **Deploy checklist** (`#rel-preflight`) — moved to the **bottom**, wrapped **collapsible +
   dismissable**. Dismissal persisted per-project in `localStorage` (key e.g.
   `fn:relchecklist:dismissed:<projectId>`), so a set-up project doesn't nag. Collapsed/expanded
   toggle independent of dismissal. When all signals are green it may default collapsed.

**Email setup → Settings pointer (decision: point, do NOT extract):**
- On Reviewers, replace the inline email banner (`#adv-email-banner` / `renderEmailBanner`) with a
  compact one-line status: `Email invites: set up ✓ — manage in Settings →` (or `not set up`),
  the link calling `openSettingsPage('email')`.
- Settings Email section becomes the entry point: its existing "to reviewers" pointer
  (app.js:2708 `set-email-toreviewers`) is repurposed to **open the wizard**, not just the panel.
  Mechanism (no extraction): give `openReleasePanel` an optional `{ openEmail:true }` arg that, after
  render, invokes the existing `openConnectForm` closure. Settings Email "Manage / set up email" →
  `openReleasePanel({ openEmail:true })`. The ~250-line coupled wizard stays exactly where it is
  (honors [[footnote-settings-architecture]] hard rule); only the *entry point* moves to Settings.
- The **Reviewer access key** row stays on Reviewers (also invite-coupled) — not in scope to move.

**Tests:** the dismiss/collapse state helper (persist + read a per-project flag) is a tiny pure unit
— `tests/relchecklist.test.mjs` (`isChecklistDismissed`/`dismissChecklist` over an injected storage).
The reorder itself is markup → browser-verify.

**Verification:** browser (owner harness) — Reviewers page renders in the new order; deploy checklist
sits at the bottom, collapses and dismisses (dismissal survives reload); email row is a one-line
Settings pointer; Settings Email "manage" opens the connect wizard; access matrix, board, inbox,
add-reviewer all still function.

---

## Testable units (write the failing test first)

- `buildSha(metaUrl)` — `tests/buildinfo.test.mjs`
- `readProgress(review)` — `tests/cardstats.test.mjs` (+ author-parity regression guard)
- checklist dismiss/collapse state — `tests/relchecklist.test.mjs`

## Browser-verify gates (pure DOM/UI — stated, not skipped)

- onboarding copy (both states)
- build pill + refresh on all three portals; advisor grep-clean
- reviewer progress bar appears after sections checked; author cards unchanged
- Reviewers new order; checklist bottom/collapse/dismiss-persist; email→Settings pointer + wizard opens

## Process / isolation

- Work in a dedicated git worktree off `origin/main` (app.js/advisor.js are grep-binary and the
  cachebust bot churns `?v=<sha>`; expect/resolve those on rebase, keeping origin's newer SHA + our
  code). Named-file `git add` only; `grep -a` for app.js/advisor.js.
- Push to `main` only on Matt's explicit say-so.
- Suggested build order: Item 1 (trivial) → Item 3 (new module, no contested files beyond 3 boot
  lines) → Item 4 (shared helper + both cards) → Item 5 (largest, contested `openReleasePanel`).

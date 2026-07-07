# Pass B — whole-doc references consolidation + appendix labeling

Date: 2026-07-07
Repo: github.com/mattlmccoy/footnote
Status: spec — approved approach (B front-end; refs at very end; appendix detect at import)

## Problem

In the **whole-document** reading view, `content/<id>.html` fragments are concatenated as-is
(`loadWholeDoc` in app.js + advisor.js). Because each unit is rendered by a **separate** pandoc pass
with `--citeproc` (`export/chapter-html.sh`), every citing unit carries its **own** citeproc block
(`<div id="refs" class="references csl-bib-body">` of `.csl-entry` items with `id="ref-<key>"`). Result:
- **References scatter** — a reference list appears after each chapter instead of one at the end.
- **Duplicate `id="refs"`/`id="ref-<key>"`** across units (invalid HTML) once concatenated.

Separately, `preprocess.py`/`docparse.js` have **no `\appendix` awareness**, so appendix units render
as "Chapter N" (pandoc HTML doesn't mark appendices, so detection must happen where LaTeX is seen: at
import). The whole-doc order is manifest order, which is already source order.

Decisions (Matt, 2026-07-07): approach **B** (front-end consolidation, no render change); consolidated
References sits at the **very end** (main chapters → appendices → References); appendix detection at
**import**; the "re-scan structure" button for legacy projects is **deferred**.

## Slice 1 — References consolidation (whole-doc only)

**Scope:** the whole-doc assembly path in BOTH portals; single-chapter view untouched.

**New pure module `js/wholerefs.js` (TDD):**
- `dedupeRefs(entries)` — `entries: [{key, html}]` → order-preserving unique by `key` (first wins).
  Empty/duplicate/blank-key cases covered.
- `buildRefsSection(entries, heading='References')` → HTML string for
  `<section class="wd-references"><h2>References</h2><div class="references csl-bib-body">…</div></section>`,
  or `''` when there are no entries.
- Both AI-term-free (advisor.js imports them and stays grep-clean).

**Thin DOM glue (browser-verified), added to `loadWholeDoc` in app.js + advisor.js** right after
`#doc` is built (before the fixFootnotes/runKatex post-processing):
- `consolidateWholeRefs(docEl)`: for each `.wd-chapter`, find `#refs, .references`; collect its
  `.csl-entry` nodes as `{key: el.id, html: el.outerHTML}`; remove the block from the unit. Pass the
  collected list through `dedupeRefs`, then append `buildRefsSection(...)` as the LAST child of `#doc`.
  No-op when no unit has refs. Runs before comment painting so anchors are unaffected (references aren't
  commentable targets in v1).

**Notes:** removing per-unit `#refs` also fixes the duplicate-id problem. Footnotes (`#footnotes`,
`fixFootnotes`) are OUT of scope — the ask was references. Consolidated References is not itself
comment-anchorable in v1 (it carries no `.wd-chapter` segment id).

**Tests:** `tests/wholerefs.test.mjs` — `dedupeRefs` (dupes across units collapse to one, order preserved,
empty, missing key) + `buildRefsSection` (N entries → one section; 0 → '').
**Browser-verify:** a fetch-stubbed whole-doc with two units each carrying a `#refs` block → exactly one
`.wd-references` at the end, deduped, and zero `#refs` left inside `.wd-chapter` segments.

## Slice 2 — Appendix detection + labeling

**Import (`js/docparse.js`):** detect `\appendix` in the assembled/flattened source. Units at/after the
`\appendix` marker (in manifest order) get `kind:'appendix'`. Numbering splits by group:
- non-appendix units: `n` = 1..K (sequential), `kind` absent/`'chapter'`.
- appendix units: `n` = 1..M (sequential among appendices), `kind:'appendix'`.
`numberChapters` gains an `appendixFromIndex` parameter (the index of the first appendix unit, or `null`).
`parseLatexChapters` computes that index: chapter mode → the first `\include`d unit that appears after
`\appendix` in main.tex; section mode → the first top-level `\section` after `\appendix` in the body.
Pure + TDD. `chapters.json` unit shape becomes `{id, n, title, sourceFile, kind?}` (back-compatible —
absent `kind` = chapter).

**Shared label helper `js/unitlabel.js` (TDD):**
- `unitLabel(unit, unitNoun)` → `kind==='appendix'` ? `Appendix <A..>` : `<unitNoun-capitalized> <n>`
  where the appendix letter = `String.fromCharCode(64 + n)` (1→A). Handles `n>26` defensively (AA, AB…),
  and missing/`__whole__`/`__outline__` pseudo-units pass through unchanged.
- `unitLabelWithTitle(unit, unitNoun)` → `unitLabel(...) + ' · ' + title` for the whole-doc header and
  chapter menu.

**Wire the helper into the display sites** (replaces inline `${UNITC} ${n}` / `${UNITC} ${n} · ${title}`)
in app.js + advisor.js: whole-doc `wrapUnit` header, chapter cards, chapter menu/`chsel`, inbox/section
headers, loading/error lines. advisor.js label sites only — helper is AI-clean. Each replacement is a
mechanical swap verified by the helper's tests + a browser label check.

**Tests:** `tests/unitlabel.test.mjs` (chapter, appendix A/B, n>26, pseudo-units, capitalization) +
docparse appendix cases in `tests/docparse.test.mjs` (chapter-mode `\include` after `\appendix`,
section-mode, no-appendix doc unchanged, numbering resets per group).
**Browser-verify:** a fetch-stubbed manifest with 2 chapters + 1 appendix → whole-doc + cards show
"Chapter 1/2" then "Appendix A", not "Chapter 3".

**Legacy projects:** pick up appendix labels on re-sync/re-import (parseLatexChapters re-runs). The one-shot
"re-scan structure" button is deferred (not in this spec).

## Order of work
Slice 1 first (self-contained, high value), then Slice 2. Land Slice 1 even if Slice 2 grows.

## Process / isolation
- Worktree off `origin/main` (currently `4f887f5`; independent of the unmerged name-pill PR #6).
- TDD red-green for every pure unit; browser-verify the whole-doc DOM behavior; advisor.js AI-grep-clean.
- Push to main only on Matt's say-so; expect cachebust `?v=` rebase churn.

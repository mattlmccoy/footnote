# Robust document-title extraction — design

**Date:** 2026-07-07
**Status:** approved (scope: Full)
**Goal:** Every Footnote document (journal article, thesis, dissertation, report) shows the *correct* title
in the reviewer header and owner UI, extracted from the LaTeX source of truth — never a hand-maintained copy
— with a human-checkable override so it can never be stuck wrong.

## Problem

The reviewer header title comes from the data repo (`advisor.js _docTitleFromRepo`). Today it live-parses
`source/main.tex` with `parseLatexTitle`. LaTeX title conventions vary widely and the current parser/flow
has real gaps:

- **Standard `\title{...}`** — journals, theses, dissertations (~95%). Handled.
- **Affiliation/funding marks inside the title** — `\thanks{...}`, `\footnote{...}`, `\tnoteref{...}`,
  `\thanksref{...}`, `\textsuperscript{...}`, `\inst{...}`, `\orcidlink{...}`. **Common in journal templates
  and currently LEAK into the extracted title** (`\cmd{arg}→arg` pulls the footnote text into the title).
- **`\subtitle{...}`** (ACM, Springer) — not combined.
- **Multiline `\\`, LaTeX escapes `\& \% \$ \# \_`** — handled (escapes fixed 2026-07-07, commit 6959059).
- **Title is a macro** (`\title{\mytitle}` with `\newcommand{\mytitle}{...}`) — returns empty.
- **Title in an `\input`/`\include`'d preamble file** (not in the entry `.tex`) — returns empty.
- **No `\title` (manual titlepage)** — returns empty.
- **Non-`.tex` uploads** (.docx) — no title captured.

Also: the title is currently NOT captured at import — `projects.json[].doc.title` is empty, so the reviewer
depends on live-parsing `source/main.tex` existing and being the right file. For the legacy dissertation repo
there was no `source/main.tex` at all (fixed by materializing it, but as a static copy — violates the
source-parity rule that title must be *generated*, never hand-kept).

## Design — three layers

The guarantee is not "regex parses every template" (impossible). It is **strong automated extraction +
capture-at-import + owner override + graceful fallback**.

### Layer 1 — one hardened extractor (`parseDocTitle`), pure + tested

A single function `parseDocTitle(entryText, resolveFile)` in `js/docparse.js`, built on the existing
`pickEntryTex` (root-`.tex` finder) and `firstSectioning` machinery:

1. Strip comments.
2. Find the first `\title` (optionally `\title[short]{...}`), balanced-brace arg (multiline-safe).
3. **Before cleaning, remove title-attached marks**: `\thanks{...}`, `\footnote{...}`, `\tnoteref{...}`,
   `\thanksref{...}`, `\textsuperscript{...}`, `\inst{...}`, `\orcidlink{...}`, `\authormark`, trailing
   `\fnref{...}` — these are affiliations/funding, not the title.
4. Clean via `latexTitleText` (commands → arg, escapes `\&`→`&`, `\\`→space, collapse whitespace).
5. **Best-effort resolution** when the title is empty or a bare macro:
   - If `\title{...}` wraps a single macro (`\mytitle`), look up `\newcommand/\def \mytitle{...}` in the
     source (entry + `resolveFile`'d `\input`s) and use its body.
   - If no `\title` in the entry, scan `\input`/`\include`'d preamble files (via `resolveFile`) for `\title`.
6. Optionally append `\subtitle{...}` as `Title: Subtitle` (configurable; default: title only).
7. Return `''` when nothing is found (caller applies fallback).

`resolveFile` is the same include-resolver already built for `parseLatexChapters` (`folderTexIndex`), so
multi-file sources work.

### Layer 2 — capture at import, store `doc.title` (source-parity)

On New Project / upload (`app.js` import flow, which already runs `pickEntryTex`), run `parseDocTitle` over
the uploaded source and **write the result to `projects.json[<id>].doc.title`** (workspace) / config
(legacy). The title is thus GENERATED from `main.tex` at import — the source-parity rule — and stored once,
deterministically. Re-running import/sync re-generates it (never a hand-kept copy).

For synced/legacy docs (the dissertation, pushed by an external pipeline): the same extractor runs in that
pipeline so `source/main.tex` and/or `doc.title` are refreshed on every content sync — replacing today's
static `source/main.tex` copy.

### Layer 3 — owner override + graceful fallback (the guarantee)

- **Owner override:** a "Document title" field in Settings writes `doc.title`. Extraction gets ~all cases;
  the override makes the rest a one-click fix instead of a stuck "Untitled". This is what *ensures*
  correctness for any document.
- **Read-time fallback chain** (`_docTitleFromRepo`, owner resolveProject):
  `stored doc.title` → live `source/main.tex` `\title` (parseDocTitle) → `outline.json.title` / entry
  filename → `"Untitled <noun>"`. Never a hard failure.

## Components / files

| File | Change |
|------|--------|
| `js/docparse.js` | New `parseDocTitle(entryText, resolveFile)`; harden mark-stripping + macro/`\input` resolution. `parseLatexTitle` becomes the thin entry-only case. |
| `js/importdoc.js` | Reuse `pickEntryTex` + `folderTexIndex`; expose a helper that returns `{ entryPath, title }` for the import flow. |
| `js/app.js` | On import/New Project, call the extractor and persist `doc.title` (projects.json). Add the Settings "Document title" override field. |
| `js/config.js` | `resolveProject`/read path: fallback chain includes stored `doc.title` first. |
| `js/advisor.js` | `_docTitleFromRepo`: prefer stored `doc.title`; keep live `parseDocTitle(source/main.tex)` as fallback; then outline/filename. |
| sync pipeline (dissertation) | Run the extractor to refresh `source/main.tex` / `doc.title` on content push (no static copy). |

## Testing (TDD — red→green per case)

`tests/docparse.test.mjs` cases for `parseDocTitle`:
- standard `\title{}`; multiline; `\title[short]{full}`.
- `\thanks{}` / `\footnote{}` / `\tnoteref{}` / `\textsuperscript{}` stripped (NOT leaked).
- `\subtitle{}` handling.
- escapes `\& \% \_`.
- macro title (`\title{\mytitle}` + `\newcommand`).
- title in an `\input`'d file (via `resolveFile`).
- no title → `''`.
- real fixtures: the RFAM dissertation `main.tex` and an elsarticle journal `main.tex`.

Plus a prod browser verification (reviewer header shows the right title for a journal + the dissertation).

## Non-goals (YAGNI)

- PDF-metadata title extraction (uploads are `.tex`/`.docx`; add later if needed).
- Perfectly parsing pathological/nested title macros — the owner override covers the long tail.
- Rendering the title uppercase to match a thesis title page (display choice; revisit if requested).

# Take-to-Overleaf Worklist — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm), pending implementation plan
**Repo:** `mattlmccoy/footnote` (owner portal + walkthrough)

## Problem

Footnote is the distributed **review layer**: reviewers read a clean surface and leave
comments; authors write in Overleaf with the `.tex` in GitHub. The open gap is the *return
trip* — getting reviewer feedback back into the Overleaf document with minimal friction.

The power-user path (Matt's) is to feed comments to Claude/agents that assemble edit packets.
Most authors will not do this. They need to sit in Overleaf and, for each comment, know two
things immediately: **where** in the source to edit, and **what** to change. Today neither
existing export serves this: `#btn-export` is a reviewer-facing "how I responded" summary, and
`#dl-export-all` is a whole-document dump with comments — neither is an actionable, per-source-file
worklist.

## Solution

A **"Take to Overleaf" worklist**: the open comments, grouped by source `.tex` file, each item
carrying a locator (a search string, plus a line number when available), the reviewer's comment,
and — for suggested edits — a literal before→after block. Delivered two ways (both approved):

1. **In-app panel** in the owner portal, with per-item copy, **Copy all as Markdown**, and **Print** (→ browser PDF).
2. **Download** as a `.md` checklist file to keep open beside Overleaf.

The same Markdown payload doubles as the clean packet power-users paste into Claude/agents.

### Locator decision (deliberate)

The primary locator is the **highlighted quote used as a search string** (`anchor.quote`),
because Overleaf's cross-file search finds it instantly with **zero setup** and no fragile
line/anchor links. A **line number** (`anchor.synctex.line`) is shown *only when present* — the
current pipeline does not emit `.synctex`, so line numbers are a graceful bonus, never a
dependency. We do **not** build a SyncTeX-emitting CI workstream for this feature.

## Architecture

### `js/worklist.js` (new — pure logic, the TDD core)

No DOM, no network. Two exported functions.

```
buildWorklist(reviewsByChapter, config) -> [
  { file, title, open, items: [
      { id, chapterId, section, reviewerName, ts, kind,
        locator: { quote, line, label },   // label used when quote is empty (figure/eq)
        comment,                             // from c.body
        before, after,                       // from c.edit (op replace) or c.staged_edit; else null
        actioned }                           // from c.actioned === true
  ] }
]
```

Rules:
- **Input:** `reviewsByChapter` = `[{ chapter: <configChapter>, review: <reviewModel> }]`.
- **Group by** `chapter.sourceFile`; group `title` = `chapter.title`; `file` = `sourceFile` (or
  `null` if the chapter has no `sourceFile`).
- **Include** every comment whose `status !== 'declined'`. (Declined edits are dropped from the
  return trip.) `actioned:true` items are still returned but flagged, so the panel can show them
  ticked / move them to a done group.
- **Reviewer name:** map `c.author` → display name. `null`/`'matt'`/owner → `config.doc.authorName`
  or `"You"`; an advisor id → `config.advisors[].name` for that id; unknown id → the id verbatim.
- **before/after:** if `c.edit && c.edit.op === 'replace'` → `before=c.edit.find`,
  `after=c.edit.replacement`; else if `c.staged_edit` → `before=c.staged_edit.before`,
  `after=c.staged_edit.after`; else both `null`. (`insert`/`delete` ops: `before`/`after` stay
  null; the comment body still conveys the change.)
- **locator.quote:** `c.anchor.quote` trimmed. **locator.line:** `c.anchor.synctex?.line ?? null`.
  **locator.label:** when `quote` is empty (figure/equation anchors), use `c.anchor.figure` or
  `c.anchor.section` (e.g. `"Figure 3.2"` / `"§3.2"`).
- **Sort:** groups by `file` (nulls last); items within a group by `section` then `ts`.
- **`open`** per group = count of items with `!actioned`.

```
worklistToMarkdown(worklist, meta) -> string
```

- `meta = { docTitle, generatedTs, totalOpen }`.
- Header: `# Review worklist — <docTitle>` + a line `Generated <date> · <N> open items`.
- One `## <file or title>` section per group.
- Each item as a GitHub checkbox line:
  ```
  - [ ] §3.2 — <reviewerName> · <date>
    Find in Overleaf → search: "<quote>"   ( · line 142 when present )
    Comment: <body>
    Suggested edit — before: "<before>"  →  after: "<after>"   (omitted when no before/after)
  ```
- `actioned` items render as `- [x]`.
- Empty worklist → a single line: `No open comments — you're all caught up.`
- Escape backticks/quotes in emitted strings so the Markdown stays valid.

### Owner portal glue (`js/app.js` + owner stylesheet)

- A **"Take to Overleaf"** button beside the existing export controls. Opens a panel/modal.
- Panel renders `buildWorklist(...)`: collapsible group per `.tex` file with its open count;
  each item card shows the locator chip (`search: "…"` + optional line), the comment, the
  before→after block, a **copy-item** button, and a **checkbox**.
- Top bar of the panel: **Copy all as Markdown**, **Download .md**, **Print**.
- **Checkbox** toggles `c.actioned` and persists via the existing `updateComment` + `putJson`
  path to `reviews/<ch>.json`, so progress survives reloads. This is independent of Footnote's
  own merge state (an Overleaf-first author's `.tex` reality is not reflected by Footnote merges).
- **Download .md:** Blob → object URL → anchor download, filename
  `<doc>-overleaf-worklist-<date>.md`.
- **Print:** open the worklist markdown rendered as a styled printable view (or a print-scoped
  section) and call `window.print()`; the user picks "Save as PDF". No PDF library.

### Walkthrough scene (`tutorials/walkthrough.html`)

New scene inserted before the outro:
- Left: the worklist panel — two `## file` groups, each with items showing the `search: "…"`
  chip and one before→after block; animated cursor clicks **Copy all as Markdown**.
- Right/next: a mock Overleaf editor pane; cursor triggers find, the searched phrase highlights,
  and the word is swapped to the "after" text.
- Caption: *"Reviewers comment in Footnote. One click gives you a worklist — exact search text
  and suggested wording — that you clear in Overleaf in minutes."*
- Reuse existing `OVERLEAF` icon const and the scene engine (`hold`, dots, embed mode).

## Data flow

1. Owner opens portal → app already loads each chapter's `reviews/<ch>.json` into review models.
2. User clicks **Take to Overleaf** → `buildWorklist(loadedReviews, config)` → render panel.
3. **Copy all / Download** → `worklistToMarkdown(worklist, meta)` → clipboard / Blob.
4. **Checkbox** → `updateComment(review, id, {actioned})` → `putJson(reviews/<ch>.json)`.
5. The embedded landing video and README reference the same walkthrough automatically.

## Error / edge handling

- **No open comments** → empty-state copy ("You're all caught up"); Copy/Download emit the
  empty-state line.
- **Chapter without `sourceFile`** → group header falls back to `chapter.title`; locator omits the
  filename but still gives the search string.
- **Empty quote** (figure/equation anchor) → locator uses `figure`/`section` label instead of a
  search string.
- **Unknown `author` id** → show the id verbatim (never crash on a missing advisor entry).
- **`insert`/`delete` edit ops** → no before/after block; the comment body conveys the change.
- **Persistence failure** (offline / 401) → surface the existing gh error toast; checkbox reverts
  to its stored state (optimistic UI rolls back).

## Testing

**Unit (TDD — write red first, then green), `tests/worklist.test.mjs`:**
- `buildWorklist` groups by `sourceFile` and sorts groups (nulls last), items by section then ts.
- Excludes `status:'declined'`; includes `open`/`staged`/`approved`/`queued`.
- Maps `author` → reviewer name via `config.advisors`; owner → "You"; unknown id verbatim.
- before/after from `edit.op==='replace'`; falls back to `staged_edit`; null for insert/delete.
- `actioned:true` returned and flagged; `open` count excludes actioned.
- Empty-quote item uses figure/section label.
- `worklistToMarkdown` emits checkbox lines, `- [x]` for actioned, line number only when present,
  omits the edit block when no before/after, escapes quotes/backticks, and returns the
  caught-up line for an empty worklist.

**Browser (owner portal, preview server):**
- Button opens the panel; groups render with correct open counts.
- Copy all as Markdown places the expected text (assert via a data attribute or a test hook).
- Download triggers a `.md` with the right filename.
- Checkbox toggles, persists (mock `putJson`), and re-renders into the done state.
- Empty state renders when no open comments.

**Walkthrough:** scene plays, cursor click + Overleaf find animation runs, `scenes.length`
increments by 1, no console errors.

**AI-free guarantee:** the worklist is owner-portal only; the advisor bundle is untouched, so the
existing grep-clean-of-assistant-references guarantee holds. Re-verify after the change.

## Out of scope (YAGNI)

- SyncTeX-emitting CI (line numbers remain bonus-only).
- Writing directly into the Overleaf/source repo from the worklist (that's the separate v1.1
  direct-edit workstream).
- PDF generation via a library (browser Print → Save as PDF suffices).

# Figure Review — design doc (first pass)

**Status:** proposal, for scope sign-off before building beyond Slice 1.
**Author:** Claude Code, from a study of the live Footnote code (citations inline).
**Origin:** Matt's dissertation figure-pass use case, generalized to a Footnote feature.

> **This is a design + verification doc, not shipped code.** Every data-shape claim below
> carries a `file:line` citation to producing code, per the data-contract rule. Where a shape
> is *assumed* or *does not exist yet*, it is flagged **GAP** — do not build on a GAP without
> capturing evidence first.

---

## 1. What the reviewer actually asked for

A surface to **bulk-review every figure in a document in one place**:

1. Intake **all** figures, grouped by the chapter they appear in — a browsable gallery, each
   figure shown with its caption and where it is referenced.
2. **Draw on a figure** and leave an adjustment request directly on it, for a fast pass over
   every figure without hunting through the reader.
3. Claude Code intakes the drawn annotation + comment and decides how the figure's
   **source** (generator / data / style) should change — the same comment → Claude round-trip
   Footnote already uses for text.
4. **Hidden by default;** visible only when the account has AI enabled — the same gate as the
   existing AI-gated UI.

## 2. What already exists (this is the key finding)

Most of the primitives are already built. The new feature is mostly **assembly + one gallery
surface**, not green-field.

| Primitive | Where it lives today | Reuse |
|---|---|---|
| Figure-anchored comment (`kind:'figure'`, `anchor.figure`) | model: [`js/model.js:5-12`](../js/model.js); owner painter `markFigure` [`js/app.js:2008`](../js/app.js); authoring `wireFigures` [`js/app.js:865`](../js/app.js) | **as-is** |
| **Draw on a figure** (canvas overlay → composited PNG) | owner `openFigureMarkup` [`js/app.js`](../js/app.js) (button at `:1051/:1088`, save `:1143`); reviewer `advisor.js:827` | **as-is** |
| Per-chapter figure enumeration (number → element) | `figTableMaps` [`js/app.js:811`](../js/app.js) / `figureLabel` `:860` (reviewer: `advisor.js:719/735`) | **lift to shared pure module** |
| "Where referenced" linkage (by figure number) | `linkCrossRefs` [`js/app.js`](../js/app.js) / `advisor.js:504` | reuse pattern |
| Comment → Claude job (`apply-edits`) | `buildAdvisorClaudeJob` [`js/aicomment.js:17`](../js/aicomment.js) | **reuse** |
| Engine that edits a **figure's source** on a figure comment | Figure Drafter DOER, selected by `_is_fig()` [`data-template/ci_apply.py:1033`](../data-template/ci_apply.py); agent `ci_agents.py:310` | **reuse** |
| AI gate | `assistantEnabled(cfg,flag)` [`js/config.js:417`](../js/config.js), wrapper `assistantOn()` [`js/app.js:80`](../js/app.js) | **reuse** |
| AI-gated Settings-section registration | `settingsSections` `if(state.aiOn)` [`js/settings.js:15`](../js/settings.js); route [`js/app.js:3554`](../js/app.js) | **mirror** |

**Consequence:** the "draw on a figure and send to Claude" interaction is ~80% present. What is
genuinely missing:

- **A. A cross-chapter figure gallery.** No figure index spans chapters today; the gallery must
  parse each chapter fragment and group. (`loadWholeDoc` [`js/app.js:1679`](../js/app.js) already
  assembles every chapter — the natural hook.)
- **B. Wiring the figure comment → Claude enqueue on the owner side.** `buildAdvisorClaudeJob` is
  defined and unit-tested but **not yet called by any live UI** (`grep` shows only the test
  imports it; [`js/seed.js:25-26`](../js/seed.js): "apply-edits… land in later slices").
- **C. The AI gate + owner-only placement** for this new surface.

## 3. Hard constraints from the data contract (do not invent around these)

1. **Figures have no stable machine id.** The number exists *only as caption text* — pandoc emits
   `<figure><img><figcaption>Figure 3.1. …</figcaption></figure>`; the number is injected as text by
   `number_captions` ([`data-template/preprocess.py:448`](../data-template/preprocess.py)). The
   `label→number` map is computed in `build_labels` (`preprocess.py:185`) but **never exported**.
   `anchor.figure` today = the last 40 chars of `img.src` — brittle across rebuilds (a data-URI tail).
   → **Anchor on the parsed caption number (`"3.1"`), not the img-src tail.** Same key `linkCrossRefs`
   already uses. Keep `anchor.figure` populated for back-compat with the existing painter.

2. **The round-trip is text-only.** Neither the job (`buildAdvisorClaudeJob`) nor the engine task
   (`build_apply_task`, `author_source` = `.tex`/`.bib` only, [`ci_review_common.py:566`](../data-template/ci_review_common.py))
   carries any image / blob / dataURL. A figure comment reaches Claude as **text + coordinates**
   (`quote`, `section`, `body`, `anchor.figure`, `anchor.rects`), and the Figure Drafter edits the
   figure's **source** via `source_before → source_after`.
   → **Slice 1 rides this existing text contract.** The drawn strokes become (a) a composited PNG for
   *human* display (already built), and (b) a **textual description + normalized rect coordinates**
   embedded in the comment body so Claude knows *where* on the figure the request applies. Sending the
   actual pixels to Claude is a **contract extension = a later slice**, not the first slice.

3. **Highlight painting is text/DOM matching, not geometry.** `paintCommentsIn`
   ([`js/app.js:1629`](../js/app.js)) ignores `anchor.rects`/`synctex` and matches quotes; `markFigure`
   outlines the whole `<figure>` by caption-substring then img-src suffix. The gallery follows the same
   model (per-figure card, not pixel overlay on the reader).

4. **Two parallel implementations exist** (owner `app.js`, reviewer `advisor.js`) and drift is a real
   maintenance cost. This feature is **owner-only + AI-gated**, so it lives in `app.js` only and must
   **not** be imported into `advisor.js` (that keeps the reviewer fork AI-free by construction —
   [`js/agentcatalog.js:1-4`](../js/agentcatalog.js)). Shared *pure* helpers go in a new
   `js/figures.js` that both *could* import but only `app.js` does for now.

## 4. Data model

**No new persisted entity.** A figure annotation **is** a comment — the existing shape — anchored to a
figure, optionally carrying a drawn region. Reuse `addComment` ([`js/model.js:5`](../js/model.js)):

```
comment = {
  id, kind: 'figure', tag: 'figure',
  anchor: {
    quote:   'Figure 3.1: <caption text>',   // human label (existing convention)
    figure:  '<img.src last-40>',             // back-compat with current markFigure painter
    fignum:  '3.1',                           // NEW: stable-ish key = parsed caption number  [GAP: add field]
    section: '<nearest heading>',             // where the figure sits
    rects:   [ {x,y,w,h} normalized 0..1 ],   // NEW meaning: drawn region(s) on the figure  [reuses existing field]
  },
  body:  'Make the colorbar log-scale; the region I circled is saturated.',
  markup_png: 'data:image/png;base64,…',      // OPTIONAL, human display only  [GAP: confirm where openFigureMarkup stores today]
  // …claude:{}, status, author — all existing
}
```

- `fignum` is additive and optional; the painter still works without it (falls back to caption/img match).
- `rects` already exists in the anchor; here it means normalized drawn-region boxes on the figure, not
  screen rects. Normalizing to 0..1 makes them meaningful in the text sent to Claude.
- **GAP to close before Slice ≥2:** confirm exactly what `openFigureMarkup` persists today (the composited
  PNG destination) so `markup_png` is a real field, not an invented one. Capture it from a real saved
  figure comment; do not assume.

**Gallery model (derived, not persisted)** — pure, computed from chapter fragments:

```
chapterFigures = [
  { chapter: {id,n,title}, figures: [
      { fignum:'3.1', caption:'…', imgSrcTail:'…', section:'…',
        referencedIn: ['3.2','4'],       // sections/units citing "Figure 3.1"  [computed by text scan]
        activeComments: 2 }              // model.isActiveComment count for this figure
  ]}
]
```

## 5. UI

**Placement:** a new owner-only entry, gated on `assistantOn()`, reached from the document view.
Recommended: a **"Figures" surface** registered like the AI Settings sections — but rendered as a
full-width gallery panel, not a settings pane. Two viable hooks (decide with Matt):

- (pref) A top-bar / document-menu button `Figures` shown only when `assistantOn()` — mirror the Send
  button gating at [`js/app.js:278`](../js/app.js) (`${assistantOn() ? … : ''}`), open a gallery overlay.
- (alt) A Settings-style section id `figures` pushed only `if(state.aiOn)` — mirror
  [`js/settings.js:15`](../js/settings.js) + route at [`js/app.js:3554`](../js/app.js).

**Gallery layout:**
- Grouped by chapter (reading order via `orderedUnits(CHAPTERS)`), collapsible per chapter.
- Each figure card: thumbnail (the existing data-URI `img`), caption, "referenced in §…", and an
  active-comment badge (reuse `model.nodeActiveCommentCount`-style counting via `isActiveComment`).
- Click a card → the existing figure popover + **"Draw on the figure"** (`openFigureMarkup`) — the exact
  interaction already in the reader, now reachable in bulk.
- Comment composer is the existing one; on save it calls the existing `addComment` and, when
  `assistantOn()`, offers **"Send to Claude"** (Slice 2).

**Explicitly for a fast bulk pass:** keyboard next/prev between figures, and a per-figure "done" marker so
Matt can sweep every figure once. (Nice-to-have; not Slice 1.)

## 6. AI round-trip

Reuse the existing path unchanged for Slice 2:

1. Owner draws + comments on a figure → `kind:'figure'` comment saved (Slice 1, no AI needed).
2. Owner clicks **Send to Claude** → build an `apply-edits` job via `buildAdvisorClaudeJob`
   ([`js/aicomment.js:17`](../js/aicomment.js)) with `comment_ids:[cid]`; a "request further work"
   note sets `revision:true`. Append to `<prefix>jobs.json` (the existing append-only log,
   [`js/gh.js:26`](../js/gh.js) / [`ci_review_common.py:247`](../data-template/ci_review_common.py)).
3. Engine drains it: `_is_fig(comment)` is true (anchor.figure / tag=='figure') →
   **Figure Drafter** agent edits the figure's LaTeX/TikZ source
   ([`ci_apply.py:1033`](../data-template/ci_apply.py)) → writes back `status:'staged'`,
   `claude.response`, `staged_edit{before,after}`, `source_edit`
   ([`ci_review_common.py:622`](../data-template/ci_review_common.py)).
4. Client reconciles via `mergeReview` ([`js/gh.js:10`](../js/gh.js)); staged result shows in the
   worklist; owner approves/rejects/revises via the existing decision flow
   (`setDecision`/`queueApproved`, [`js/model.js:39-72`](../js/model.js)).

**What the comment must give Claude** (text, per constraint §3.2): the figure identity (`fignum` +
caption), the section, the request `body`, and a **textual rendering of the drawn region** — e.g.
"annotation at the upper-right ~ (0.8, 0.15)–(0.95, 0.35) of the figure". Building that string from
normalized `rects` is a pure, TDD-able helper.

**Later slice (needs sign-off):** to send the composited PNG to Claude, extend the job + `build_apply_task`
+ Figure Drafter to accept an image asset. This changes the engine data contract and must be its own PR.

## 7. AI gating (exact mechanism to copy)

- Predicate: `assistantEnabled(_CFG, localStorage['footnote:assistant'])` — OFF unless the user switch is
  `'1'` or the config ships a non-empty `reviewAgents` ([`js/config.js:417`](../js/config.js)).
- Gate every entry point by **omitting the HTML** (`${assistantOn() ? … : ''}`), the way Send/agents do —
  not CSS hide.
- Register the surface only when `aiOn` (Settings-section pattern) or render the launcher button only when
  `assistantOn()` (top-bar pattern).
- Import `js/figures.js` and any AI wiring **only into `app.js`**, never `advisor.js`, to preserve the
  AI-free reviewer fork.

## 8. TDD implementation plan — Slice 1 (pure figure index; no AI, no engine change)

Slice 1 ships the **data spine + gallery grouping** as a pure, fully unit-tested module. It is valuable
alone (a "figures in this document" index) and unblocks the UI. It touches **no** engine code and adds
**no** AI contract, so it is safe to land behind or before the gate.

New file `js/figures.js` (pure, ESM, no DOM/network — mirrors `js/aicomment.js` style) + `tests/figures.test.mjs`.

**Red-green steps** (each: write failing test → run `node --test tests/figures.test.mjs` → see it fail for
the right reason → minimal impl → see green → refactor):

1. `parseFiguresFromFragment(html, chapterId)` → `[{chapterId, fignum, caption, imgSrcTail, section}]`.
   - RED: fixture with two `<figure>`s → expect two rows with `fignum '3.1'/'3.2'`, captions, img tails.
   - **Fixture must be captured from a real pandoc fragment** (per data-contract rule), not hand-invented.
     Capture source: a real `content/<id>.html` from a data repo, or the reviewer demo sample
     (`advisor.js:45`), or an existing `tests/fixtures/*`. If none is capturable, mark the test **shape-only**
     and say so in a comment.
2. `figureRefsInFragment(html)` → for each `Figure N` mentioned in body text, the nearest heading — the
   "referenced in" map (mirrors `linkCrossRefs` number-matching). RED with a fixture referencing "Figure 3.1".
3. `groupFiguresByChapter(orderedUnits, fragmentsById)` → ordered `[{chapter, figures}]`. RED: two chapters,
   assert reading order + grouping.
4. `figureAnchor(fig)` → the `{quote, figure, fignum, section, kind:'figure', rects:[]}` shape that
   `addComment` accepts — asserts parity with the existing `wireFigures` anchor so a gallery-authored comment
   paints identically. RED against the model contract.
5. `attachCommentCounts(figures, comments)` → adds `activeComments` per figure using
   `model.isActiveComment` + `fignum`/figure match. RED: mixed open/resolved comments.
6. `describeRegion(rects)` → the human/Claude text string from normalized rects (§6). RED: a rect at
   (0.8,0.1,0.15,0.2) → "upper-right" phrasing; empty → ''.

**Verification gate for Slice 1:** `npm test` green (new + existing 106 files). Pure module, so unit tests
are the gate — no DOM/browser needed. Per the reproducibility rule, also do **one real-data read**: run
`parseFiguresFromFragment` against a real captured chapter fragment and print the rows, to prove the
fixtures match reality (the exact trap the data-contract rule exists for).

**Not in Slice 1 (needs Matt's sign-off, separate PRs):**
- Slice 2: gallery UI in `app.js` behind `assistantOn()` + wire "Send to Claude" via `buildAdvisorClaudeJob`.
  (DOM/visual → verification is a browser check + screenshot, not unit tests.)
- Slice 3: per-figure "done" sweep state + keyboard nav.
- Slice 4 (contract change): send composited PNG to Claude; extend job + engine + Figure Drafter.
- Slice 5: export `label→number` sidecar from `preprocess.py` for a truly stable figure id (retires the
  img-src-tail heuristic).

## 9. Scope decisions (signed off 2026-08-10) + open items

**Decided with Matt:**
1. **Slice 1 builds now** — pure `js/figures.js` index, no UI/AI/engine change.
2. **Entry point = top-bar "Figures" button**, gated on `assistantOn()` (Slice 2), opening a full
   gallery overlay. (Mirror the Send button gating, [`js/app.js:278`](../js/app.js).)
3. **Drawn pixels → Claude IS wanted**, as a later dedicated PR (Slice 4). It is a real engine
   data-contract change (job + `build_apply_task` + Figure Drafter must carry an image asset); it does
   **not** gate Slices 1–3, which ride the existing text+coordinates contract.

**Still open:**
- **Stable figure id (Slice 5):** worth the `preprocess.py` `label→number` sidecar export, or is
  caption-number keying good enough? (Revisit after the gallery is real.)
- The four related memories you named (`footnote-ai-findings-architecture`, `footnote-agent-network`,
   `footnote-claude-comment-actions`, `dissertation-hub-portal-architecture`) are **not in this repo's
   memory dir** (only `footnote-build-provenance` is). If they hold constraints I should honor, point me
   at the vault; otherwise this doc is reconstructed from code.

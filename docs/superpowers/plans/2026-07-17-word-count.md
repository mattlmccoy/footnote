# Word Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A word-processor-style word count — per-chapter count on the home cards, a whole-document total, and a "Word count" panel — computed from each unit's rendered prose (references/footnotes/math excluded).

**Architecture:** The render engine computes counts at render time and writes ONE cheap `content/counts.json` (`{unitId: {words, chars}}`) so the home grid reads them in a single fetch. Pure client helpers format/sum them; three display surfaces (cards, total, panel) consume `counts.json`, with a client-side fallback that counts the already-loaded HTML when `counts.json` is absent (older projects not yet re-rendered).

**Tech Stack:** Python (`data-template/`, pytest) for the engine; vanilla ES modules (`js/`, `node --test`) for the client. No new dependencies.

**Spec:** `docs/superpowers/footnote/specs/2026-07-16-word-count-design.md` (decisions locked).

---

## File Structure

- **Create `data-template/wordcount.py`** — pure `word_count(html) -> {"words", "chars"}`. Strips references, footnotes, and math from a rendered HTML fragment, counts the rest.
- **Create `tests/test_wordcount.py`** — pytest for `word_count`.
- **Modify `data-template/ci_render.py`** — after the render loop, write `<prefix>content/counts.json` from each unit's `content/<id>.html`.
- **Modify `tests/test_ci_render.py`** — assert a render produces `counts.json` with the right shape.
- **Create `js/wordcount.js`** — pure client helpers: `formatCount`, `totalWords`, `totalChars`, `countWords(html)` (the fallback, mirrors the engine rules).
- **Create `tests/wordcount.test.mjs`** — node tests for the client helpers.
- **Modify `js/app.js`** — load `content/counts.json` once; show "X words" on chapter cards; whole-doc total; a "Word count" panel.

---

## Task 1: engine — pure `word_count(html)`

**Files:**
- Create: `data-template/wordcount.py`
- Test: `tests/test_wordcount.py`

- [ ] **Step 1: Write the failing test** `tests/test_wordcount.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data-template"))
from wordcount import word_count


def test_counts_plain_prose():
    r = word_count("<p>Hello brave new world</p>")
    assert r["words"] == 4
    assert r["chars"] == len("Hellobravenewworld")   # non-space chars


def test_includes_headings_and_captions():
    html = "<h1>Intro Title</h1><p>body text here</p><figcaption>Figure 1. A caption line</figcaption>"
    assert word_count(html)["words"] == 2 + 3 + 5   # heading + body + caption


def test_excludes_references_section():
    html = "<p>real words only</p><section id='refs'><div>Smith 2020 reference junk here</div></section>"
    assert word_count(html)["words"] == 3


def test_excludes_references_by_class():
    html = "<p>real words only</p><div class='references'>Smith 2020 reference junk</div>"
    assert word_count(html)["words"] == 3


def test_excludes_footnotes():
    html = "<p>main body words</p><section class='footnotes'><ol><li>a footnote here now</li></ol></section>"
    assert word_count(html)["words"] == 3


def test_excludes_math():
    html = "<p>energy equals <span class='math inline'>\\(E=mc^2\\)</span> mass</p>"
    assert word_count(html)["words"] == 3   # energy equals mass (math dropped)


def test_empty_and_none():
    assert word_count("") == {"words": 0, "chars": 0}
    assert word_count(None) == {"words": 0, "chars": 0}
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: wordcount`):

Run: `python3 -m pytest tests/test_wordcount.py -q`

- [ ] **Step 3: Implement** `data-template/wordcount.py`:

```python
"""Pure word/character count for a rendered reading fragment (content/<id>.html).

Counts the AUTHOR'S PROSE: headings, body text, figure/table captions. Excludes the References /
bibliography block, the footnotes list, and math (equations are not words). Regex-based on purpose —
the input is a well-formed pandoc HTML5 fragment and this must run without extra dependencies.
"""
import re

# citeproc emits <section id="refs"> ... ; some templates use a .references wrapper.
_REF_RE = re.compile(r'<section\b[^>]*\bid="refs"[^>]*>.*?</section>', re.I | re.S)
_REF_CLASS_RE = re.compile(r'<(section|div)\b[^>]*\bclass="[^"]*\breferences\b[^"]*"[^>]*>.*?</\1>', re.I | re.S)
# pandoc footnotes: <section class="footnotes" ...> ... </section>
_FN_RE = re.compile(r'<section\b[^>]*\bclass="[^"]*\bfootnotes\b[^"]*"[^>]*>.*?</section>', re.I | re.S)
# math stays as <span class="math ...">\(...\)</span> in server HTML (KaTeX renders client-side)
_MATH_RE = re.compile(r'<span\b[^>]*\bclass="[^"]*\bmath\b[^"]*"[^>]*>.*?</span>', re.I | re.S)
_TAG_RE = re.compile(r'<[^>]+>')
_ENT_RE = re.compile(r'&[a-zA-Z]+;|&#\d+;')


def word_count(html):
    s = html or ""
    for rx in (_REF_RE, _REF_CLASS_RE, _FN_RE, _MATH_RE):
        s = rx.sub(" ", s)
    s = _TAG_RE.sub(" ", s)
    s = _ENT_RE.sub(" ", s)
    words = s.split()
    return {"words": len(words), "chars": sum(len(w) for w in words)}
```

- [ ] **Step 4: Run — expect PASS:** `python3 -m pytest tests/test_wordcount.py -q`
- [ ] **Step 5: Commit:**

```bash
git add data-template/wordcount.py tests/test_wordcount.py
git commit -m "feat(wordcount): pure word_count(html) — prose minus refs/footnotes/math

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: engine — write `counts.json` after the render loop

**Files:**
- Modify: `data-template/ci_render.py` (imports at top; `render_project` after the `for r in rows` loop, ~line 207)
- Test: `tests/test_ci_render.py` (append)

- [ ] **Step 1: Write the failing test** — append to `tests/test_ci_render.py`. First read the file's top to reuse its existing helpers/imports; then add:

```python
def test_write_counts_json_from_content(tmp_path, monkeypatch):
    # Given two rendered content fragments on disk, write_counts writes counts.json keyed by unit id.
    import ci_render
    (tmp_path / "content").mkdir()
    (tmp_path / "content" / "ch_a.html").write_text("<p>one two three</p>")
    (tmp_path / "content" / "ch_b.html").write_text("<p>alpha beta</p><section id='refs'>ignored ignored</section>")
    rows = [{"id": "ch_a"}, {"id": "ch_b"}]
    monkeypatch.chdir(tmp_path)
    ci_render.write_counts("", rows)
    import json
    got = json.loads((tmp_path / "content" / "counts.json").read_text())
    assert got == {"ch_a": {"words": 3, "chars": 11}, "ch_b": {"words": 2, "chars": 9}}
```

(If `test_ci_render.py` already imports `ci_render` and sets `sys.path`, reuse that; do not duplicate the sys.path shim.)

- [ ] **Step 2: Run — expect FAIL** (`AttributeError: module 'ci_render' has no attribute 'write_counts'`):

Run: `python3 -m pytest tests/test_ci_render.py::test_write_counts_json_from_content -q`

- [ ] **Step 3: Implement.** At the top of `ci_render.py` with the other imports add:

```python
from wordcount import word_count
```

Then add this function next to the other `content_out`/`srcmap_out` helpers (near line 98):

```python
def write_counts(prefix, rows):
    """Write <prefix>content/counts.json = {unitId: {words, chars}} from each unit's rendered HTML.
    Reads whatever content/<id>.html exists (rebuilt this run OR kept from a prior run) so the file
    always reflects every unit. Cheap: the home grid reads this one file instead of every chapter."""
    counts = {}
    for r in rows:
        uid = r.get("id")
        if not uid:
            continue
        p = Path(content_out(prefix, uid))
        if p.exists():
            counts[uid] = word_count(p.read_text(encoding="utf-8", errors="replace"))
    out = Path(f"{prefix}content/counts.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(counts), encoding="utf-8")
    return counts
```

(Confirm `json` and `Path` are already imported at the top of `ci_render.py` — they are used elsewhere in the file. If `json` is not imported, add `import json`.)

Then, in `render_project`, immediately AFTER the `for r in rows:` loop and BEFORE the `print(f"[render] ...built...")` line (~line 207), add:

```python
    write_counts(prefix, rows)
```

- [ ] **Step 4: Run — expect PASS:** `python3 -m pytest tests/test_ci_render.py -q`  (whole file stays green)
- [ ] **Step 5: Verify `counts.json` isn't caught by a content-only/[skip ci] guard**

`counts.json` lives under `content/`. Check that the render workflow's writeback globs `content/**` (or `content/*.json`) so `counts.json` is committed like `srcmap.json`. Read `.github/workflows/render.yml` (or `data-template/workflows/render.yml`); if the `git add` path is narrower than `content`, widen it to include `content/counts.json`. If it already adds `content` wholesale, no change — note that in the commit message.

- [ ] **Step 6: Commit:**

```bash
git add data-template/ci_render.py tests/test_ci_render.py
git commit -m "feat(wordcount): render writes content/counts.json (one cheap file for the home grid)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: client — pure helpers (`js/wordcount.js`)

**Files:**
- Create: `js/wordcount.js`
- Test: `tests/wordcount.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/wordcount.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, totalWords, totalChars, countWords } from '../js/wordcount.js';

test('formatCount groups thousands and labels', () => {
  assert.equal(formatCount(0), '0 words');
  assert.equal(formatCount(1), '1 word');
  assert.equal(formatCount(12480), '12,480 words');
});

test('totalWords / totalChars sum a counts map, tolerating gaps', () => {
  const counts = { a: { words: 100, chars: 500 }, b: { words: 20, chars: 90 }, c: null };
  assert.equal(totalWords(counts), 120);
  assert.equal(totalChars(counts), 590);
  assert.equal(totalWords({}), 0);
  assert.equal(totalWords(), 0);
});

test('countWords mirrors the engine: prose minus refs/footnotes/math', () => {
  // no DOM in node: countWords must work on a plain string via a regex fallback identical to the engine.
  assert.equal(countWords('<p>one two three</p>').words, 3);
  assert.equal(countWords("<p>real words only</p><section id='refs'>junk junk</section>").words, 3);
  assert.equal(countWords("<p>a b</p><section class='footnotes'>fn fn fn</section>").words, 2);
  assert.equal(countWords("<p>e <span class='math inline'>\\(x\\)</span> m</p>").words, 2);
  assert.equal(countWords('').words, 0);
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../js/wordcount.js'`):

Run: `node --test tests/wordcount.test.mjs`

- [ ] **Step 3: Implement** `js/wordcount.js`:

```js
// Word-count display helpers + a client-side fallback counter. The fallback mirrors data-template/
// wordcount.py so a project without counts.json (not re-rendered yet) still shows a count. Term-neutral.

export function formatCount(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString('en-US')} word${v === 1 ? '' : 's'}`;
}

export function totalWords(counts = {}) {
  return Object.values(counts || {}).reduce((s, c) => s + (c && c.words ? c.words : 0), 0);
}
export function totalChars(counts = {}) {
  return Object.values(counts || {}).reduce((s, c) => s + (c && c.chars ? c.chars : 0), 0);
}

// Fallback: same rules as the engine (refs / footnotes / math excluded). Regex-based so it runs in node
// tests too; on real HTML in the browser it operates on the same fragment string.
const REF = /<section\b[^>]*\bid="refs"[^>]*>[\s\S]*?<\/section>/gi;
const REF_C = /<(section|div)\b[^>]*\bclass="[^"]*\breferences\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;
const FN = /<section\b[^>]*\bclass="[^"]*\bfootnotes\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi;
const MATH = /<span\b[^>]*\bclass="[^"]*\bmath\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const TAG = /<[^>]+>/g;
const ENT = /&[a-zA-Z]+;|&#\d+;/g;

export function countWords(html) {
  let s = String(html || '');
  s = s.replace(REF, ' ').replace(REF_C, ' ').replace(FN, ' ').replace(MATH, ' ').replace(TAG, ' ').replace(ENT, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  return { words: words.length, chars: words.reduce((n, w) => n + w.length, 0) };
}
```

- [ ] **Step 4: Run — expect PASS:** `node --test tests/wordcount.test.mjs`
- [ ] **Step 5: Commit:**

```bash
git add js/wordcount.js tests/wordcount.test.mjs
git commit -m "feat(wordcount): client helpers formatCount/totalWords/totalChars + countWords fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: client — load `counts.json` + per-chapter "X words" on the home cards

**Files:**
- Modify: `js/app.js` (import ~line 25; a module-level `COUNTS` cache loaded at boot near `CHAPTERS`; the `chcard` render in `homeHtml` ~line 2934)

- [ ] **Step 1: Add the import** near the other `./*.js?v=` imports (by line 25):

```js
import { formatCount, totalWords, totalChars, countWords } from './wordcount.js?v=1';
```

- [ ] **Step 2: Load `counts.json` once at boot.** Find where `CHAPTERS` is loaded (`let CHAPTERS = await loadChapters(...)`, ~line 169). Immediately after it add:

```js
// Per-unit word/char counts, produced at render time (content/counts.json). One cheap fetch; absence is fine.
let COUNTS = {};
async function loadCounts(){ const t = tok(); if (!t) return; try { const r = await getJson(t, dpath('content/counts.json')); COUNTS = (r.json && typeof r.json === 'object') ? r.json : {}; } catch(e){ COUNTS = {}; } }
```

Then call `await loadCounts();` right after `CHAPTERS = await loadChapters(...)` at BOTH sites (boot line ~169 and the re-load after import ~line 2826 `CHAPTERS = await loadChapters(t); enterHome();` → make it `CHAPTERS = await loadChapters(t); await loadCounts(); enterHome();`). Confirm `getJson` and `dpath` are already imported in app.js (they are).

- [ ] **Step 3: Show the count on each chapter card.** In `homeHtml`'s `chcard` template (the line building `<div class="chcard" ...>`, ~line 2934), the status row is:

```js
        <div style="font-size:11px;color:var(--text-2);display:flex"><span>${status}</span><span style="margin-left:auto">${right}</span></div></div>`;
```

Change the `${right}` span to append the word count (a muted count next to the existing right-hand info). Replace that line with:

```js
        <div style="font-size:11px;color:var(--text-2);display:flex;gap:8px"><span>${status}</span><span style="margin-left:auto">${right}</span>${COUNTS[c.id]?.words != null ? `<span style="color:var(--text-3)">${formatCount(COUNTS[c.id].words)}</span>` : ''}</div></div>`;
```

- [ ] **Step 4: Browser-verify** (DOM — not unit-testable): serve the worktree, open `owner.html`, load a project with `counts.json`. Confirm each chapter card shows "N words". Read console → no errors. (If no live `counts.json`, the count is simply absent — that's Task 5's fallback territory; card must not error.)

- [ ] **Step 5: Commit:**

```bash
git add js/app.js
git commit -m "feat(wordcount): load counts.json + show per-chapter word count on home cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: client — whole-document total + client-side fallback

**Files:**
- Modify: `js/app.js` (`homeHtml` — the "ALL CHAPTERS" header ~line 2951; `loadWholeDoc` ~line 1492 for the reader header total; a fallback that fills `COUNTS[current]` from the loaded HTML when absent)

- [ ] **Step 1: Show the total in the home "ALL …S" header.** Find the `allCh` markup header (`<div class="home-allch" ...>ALL ${UNIT.toUpperCase()}S</div>`, ~line 2951). Change it to append the total when known:

```js
    ? `<div class="home-allch" style="display:flex;align-items:baseline;gap:8px;margin-bottom:13px">ALL ${UNIT.toUpperCase()}S${totalWords(COUNTS) ? `<span style="font-weight:400;font-size:11px;color:var(--text-3)">${formatCount(totalWords(COUNTS))} total</span>` : ''}</div>
```

(Keep the rest of the `allCh` template — `${wholeBtn}` and the grid — unchanged; only the header `<div>` changes.)

- [ ] **Step 2: Fallback — count the current chapter client-side when counts.json lacks it.** In `renderDoc` (the function that injects a chapter's HTML into `#doc`, ~line 430), after the doc is painted add a one-liner that backfills the count for `current` from the rendered fragment so re-opening the home shows it even pre-render:

Find the end of `renderDoc` (after its post-processing calls) and add:

```js
  if (current && current !== '__whole__' && COUNTS[current]?.words == null){
    try { COUNTS[current] = countWords(read.querySelector('#doc')?.innerHTML || ''); } catch(e){}
  }
```

- [ ] **Step 3: Whole-document reader total.** In `loadWholeDoc` (~line 1492), after it assembles and paints every unit into `#doc`, it knows all units are shown. Add a total line to the whole-doc header. Locate where `loadWholeDoc` sets the reader header/title (search inside `loadWholeDoc` for the `<h1`/title it renders) and append, when `totalWords(COUNTS)` is truthy, a muted `${formatCount(totalWords(COUNTS))}` subtitle. (If `loadWholeDoc` has no header element, prepend a small `<div style="color:var(--text-3);font-size:12px;margin-bottom:8px">${formatCount(totalWords(COUNTS))}</div>` above the assembled article.)

- [ ] **Step 4: Browser-verify:** home header shows "N words total"; open a chapter then return home — its card now shows a count even without counts.json (fallback); whole-doc view shows the total. Console clean.

- [ ] **Step 5: Commit:**

```bash
git add js/app.js
git commit -m "feat(wordcount): whole-document total + client-side fallback count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: client — the "Word count" panel + final verify/PR

**Files:**
- Modify: `js/app.js` (add a `⋯`-menu / toolbar item that opens a Word-style dialog; reuse the existing modal/scrim pattern used by other panels)

- [ ] **Step 1: Find the ⋯ menu items** (search `openExportMenu` / the `mmi` menu rows, ~line 3111 where `release`/`help`/`token` acts are wired). Add a "Word count" row + act.

- [ ] **Step 2: Add `openWordCountPanel()`** near the other panel openers. It builds a scrim+sheet (copy the `scrim`/`sheet` pattern already used by `importDocument`) listing each unit and the total:

```js
function openWordCountPanel(){
  const rows = CHAPTERS.map(c => { const wc = COUNTS[c.id] || countWords(''); const label = unitLabel(c, UNIT);
    return `<tr><td style="padding:4px 0">${escapeHtml(label)} · ${escapeHtml(shortTitle(c.title))}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${(wc.words||0).toLocaleString('en-US')}</td><td style="text-align:right;color:var(--text-3);font-variant-numeric:tabular-nums">${(wc.chars||0).toLocaleString('en-US')}</td></tr>`; }).join('');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" style="max-width:440px">
    <div style="font-size:16px;font-weight:600;margin-bottom:4px">Word count</div>
    <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">Rendered prose — references, footnotes, and equations excluded.</div>
    <table style="width:100%;font-size:12.5px;border-collapse:collapse"><thead><tr style="color:var(--text-3)"><th style="text-align:left;font-weight:500">${escapeHtml(UNITC)}</th><th style="text-align:right;font-weight:500">Words</th><th style="text-align:right;font-weight:500">Chars</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:600"><td style="padding-top:6px">Total</td><td style="text-align:right;padding-top:6px;font-variant-numeric:tabular-nums">${totalWords(COUNTS).toLocaleString('en-US')}</td><td style="text-align:right;padding-top:6px;font-variant-numeric:tabular-nums">${totalChars(COUNTS).toLocaleString('en-US')}</td></tr></tfoot></table>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn" id="wc-close">Close</button></div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.onclick = e => { if (e.target === scrim) close(); };
  scrim.querySelector('#wc-close').onclick = close;
}
```

Wire the menu act (in the `acts` object next to `release: openReleasePanel`): add `wordcount: openWordCountPanel`, and add the menu row `<div class="mmi" data-act="wordcount"><i class="ti ti-abacus"></i>Word count</div>` alongside the others.

- [ ] **Step 3: Browser-verify:** open ⋯ → "Word count" → dialog lists every unit + words + chars + a Total row; numbers match the cards; Close works; appendix units appear with "Appendix A" labels. Console clean.

- [ ] **Step 4: Full suites green:** `python3 -m pytest tests/ -q` and `node --test tests/*.test.mjs` both green; `node --check js/app.js` clean; owner.html boots with no console errors.

- [ ] **Step 5: Commit + push + PR:**

```bash
git add js/app.js
git commit -m "feat(wordcount): Word-style count panel (per-unit + total)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin feat/word-count
gh pr create --title "feat: word count — per-chapter, whole-document total, Word-style panel" --body "<summary + verification>"
```

---

## Self-Review notes

- **Spec coverage:** everywhere placement — cards (T4), total (T5), panel (T6) ✓; words excluding refs/footnotes/math, incl. headings+captions (T1 `word_count` + tests) ✓; engine writes counts.json auto on render (T2) ✓; pure client helpers formatCount/totalWords/totalChars/countWords (T3) ✓; fallback when no counts.json (T5 renderDoc + T6 panel uses countWords) ✓; appendices count (they're rows in chapters.json → included by T2 loop and shown by T4/T6) ✓; panel shows chars too (T6) ✓; additive-only, no data touched ✓.
- **Type consistency:** counts shape `{words, chars}` identical in `word_count` (py), `countWords` (js), `counts.json`, and every consumer. `formatCount(n)` takes a number; `totalWords/totalChars(counts)` take the map. `COUNTS` is the module cache keyed by unit id.
- **Deferred/again out of scope:** reviewer-portal (advisor.js) counts — counts.json is term-neutral so a later parity pass can read it; live-typing counts and page estimates (no live editor / no pagination).
- **Known dependency:** the count only appears once a project has been re-rendered (writes counts.json); the T5 fallback covers the current chapter client-side in the meantime. rfam shows counts after its next render.

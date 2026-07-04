# Take-to-Overleaf Worklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authors a one-click, per-source-file worklist of reviewer comments — locator + suggested edit — to action back in Overleaf, delivered as an owner-portal panel plus a downloadable Markdown checklist, and shown in the walkthrough.

**Architecture:** A new pure module `js/worklist.js` turns loaded review models into a grouped, sorted worklist and into a Markdown payload (no DOM, no network — fully unit-tested). The owner portal (`js/app.js` + `owner.html` styles) gathers every chapter's `reviews/<ch>.json`, renders the worklist in a panel with copy/download/print and per-item "actioned" checkboxes (persisted via the existing `putJson` path), and the walkthrough (`tutorials/walkthrough.html`) gets a scene demonstrating the round-trip.

**Tech Stack:** Vanilla ES modules, `node --test` (node:test + assert/strict), GitHub Pages static app, existing `js/gh.js` / `js/config.js` / `js/model.js`.

**Spec:** `docs/superpowers/footnote/specs/2026-07-03-overleaf-worklist-design.md`

---

## File Structure

- **Create `js/worklist.js`** — pure logic: `buildWorklist(chapters, reviews, config)` and `worklistToMarkdown(worklist, meta)`. One responsibility: transform data → worklist / Markdown. No DOM, no fetch.
- **Create `tests/worklist.test.mjs`** — unit tests for both functions.
- **Modify `js/app.js`** — owner portal: gather all reviews, render the panel, wire button + copy/download/print + checkbox persistence.
- **Modify `owner.html`** — the "Take to Overleaf" button element + panel container + CSS (follow existing export-control markup/styles).
- **Modify `tutorials/walkthrough.html`** — one new scene.

Reviewer comment shape (from `js/model.js`, authoritative):
`{ id, page, kind, anchor:{quote, synctex, rects, section, figure, confirmed}, tag, body, status, author, edit:{op,find,replacement,position}|null, staged_edit?:{before,after}, actioned?:bool, created_ts }`.
Statuses seen: `open`, `staged`, `approved`, `queued`, `declined`. Owner `author` is `null`/`'matt'`; advisors are ids like `'CJS'` mapped via `config.advisors=[{id,name}]`.

---

## Task 1: `buildWorklist` — group + shape (pure)

**Files:**
- Create: `js/worklist.js`
- Test: `tests/worklist.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/worklist.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { buildWorklist } from '../js/worklist.js';

const CH = [
  { id: 'ch_results', n: 3, title: 'Results', sourceFile: 'chapters/results.tex' },
  { id: 'ch_intro',   n: 1, title: 'Introduction', sourceFile: 'chapters/intro.tex' },
];
const CFG = { doc: { title: 'My Thesis' }, advisors: [{ id: 'CJS', name: 'Carolyn Seepersad' }] };

const rev = (comments) => ({ chapter: 'x', comments });
const cmt = (o) => ({ id: 'c1', kind: 'text', status: 'open', author: null,
  anchor: { quote: 'the melt-pool contrast was pronounced', synctex: null, section: '§3.2', figure: null },
  body: 'Overstates it.', edit: null, created_ts: '2026-07-01T00:00:00Z', ...o });

test('buildWorklist: groups by sourceFile and sorts groups by file', () => {
  const reviews = { ch_results: rev([cmt({})]), ch_intro: rev([cmt({ id: 'c2' })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  assert.deepEqual(wl.map(g => g.file), ['chapters/intro.tex', 'chapters/results.tex']);
  assert.equal(wl[1].title, 'Results');
});

test('buildWorklist: excludes declined comments', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a' }), cmt({ id: 'b', status: 'declined' })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  assert.equal(wl.length, 1);
  assert.deepEqual(wl[0].items.map(i => i.id), ['a']);
});

test('buildWorklist: maps advisor id to name, owner to You', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a', author: 'CJS' }), cmt({ id: 'b', author: null })]) };
  const wl = buildWorklist(CH, reviews, CFG);
  const names = wl[0].items.map(i => i.reviewerName).sort();
  assert.deepEqual(names, ['Carolyn Seepersad', 'You']);
});

test('buildWorklist: unknown author id passes through verbatim', () => {
  const reviews = { ch_results: rev([cmt({ author: 'ZZZ' })]) };
  assert.equal(buildWorklist(CH, reviews, CFG)[0].items[0].reviewerName, 'ZZZ');
});

test('buildWorklist: open count excludes actioned', () => {
  const reviews = { ch_results: rev([cmt({ id: 'a' }), cmt({ id: 'b', actioned: true })]) };
  const g = buildWorklist(CH, reviews, CFG)[0];
  assert.equal(g.items.length, 2);
  assert.equal(g.open, 1);
});

test('buildWorklist: chapter with no review is skipped', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({})]) }, CFG);
  assert.deepEqual(wl.map(g => g.file), ['chapters/results.tex']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/worklist.test.mjs`
Expected: FAIL — `Cannot find module '../js/worklist.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// js/worklist.js
// Pure worklist builder: turns loaded review models into an Overleaf-actionable,
// per-source-file worklist and a Markdown payload. No DOM, no network.
// Consumed by the owner portal panel and the Markdown export/download.

const DECLINED = 'declined';

function reviewerName(author, config) {
  if (!author || author === 'matt' || author === 'owner') {
    return (config && config.doc && config.doc.authorName) || 'You';
  }
  const adv = ((config && config.advisors) || []).find(a => a.id === author);
  return adv ? (adv.name || adv.id) : author;
}

function editBeforeAfter(c) {
  if (c.edit && c.edit.op === 'replace') {
    return { before: c.edit.find || '', after: c.edit.replacement || '' };
  }
  if (c.staged_edit) {
    return { before: c.staged_edit.before || '', after: c.staged_edit.after || '' };
  }
  return { before: null, after: null };
}

function locatorOf(c) {
  const a = c.anchor || {};
  const quote = (a.quote || '').trim();
  const line = (a.synctex && a.synctex.line) || null;
  const label = quote ? '' : (a.figure || a.section || '');
  return { quote, line, label };
}

const sectionOf = c => (c.anchor && (c.anchor.section || c.anchor.figure)) || '';

export function buildWorklist(chapters, reviews, config) {
  const groups = [];
  for (const ch of (chapters || [])) {
    const review = (reviews || {})[ch.id];
    if (!review || !Array.isArray(review.comments)) continue;
    const items = review.comments
      .filter(c => (c.status || 'open') !== DECLINED)
      .map(c => {
        const { before, after } = editBeforeAfter(c);
        return {
          id: c.id, chapterId: ch.id,
          section: sectionOf(c),
          reviewerName: reviewerName(c.author, config),
          ts: c.created_ts || '',
          kind: c.kind || 'text',
          locator: locatorOf(c),
          comment: c.body || '',
          before, after,
          actioned: c.actioned === true,
        };
      })
      .sort((a, b) =>
        (a.section || '').localeCompare(b.section || '') ||
        (a.ts || '').localeCompare(b.ts || ''));
    if (!items.length) continue;
    groups.push({
      file: ch.sourceFile || null,
      title: ch.title || ch.id,
      open: items.filter(i => !i.actioned).length,
      items,
    });
  }
  groups.sort((a, b) => {
    if (a.file && b.file) return a.file.localeCompare(b.file);
    if (a.file) return -1;
    if (b.file) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/worklist.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add js/worklist.js tests/worklist.test.mjs
git commit -m "feat(worklist): buildWorklist — group reviewer comments by source .tex file"
```

---

## Task 2: `worklistToMarkdown` — checklist payload (pure)

**Files:**
- Modify: `js/worklist.js` (add export)
- Test: `tests/worklist.test.mjs` (add tests)

- [ ] **Step 1: Write the failing tests** (append to `tests/worklist.test.mjs`)

```js
import { worklistToMarkdown } from '../js/worklist.js';

const META = { docTitle: 'My Thesis', generatedTs: '2026-07-03T12:00:00Z' };

test('worklistToMarkdown: empty worklist yields the caught-up line', () => {
  const md = worklistToMarkdown([], META);
  assert.match(md, /# Review worklist — My Thesis/);
  assert.match(md, /0 open items/);
  assert.match(md, /No open comments — you're all caught up\./);
});

test('worklistToMarkdown: renders file heading, search locator, comment, edit', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({
    edit: { op: 'replace', find: 'was pronounced', replacement: 'was measurable' } })]) }, CFG);
  const md = worklistToMarkdown(wl, META);
  assert.match(md, /## chapters\/results\.tex/);
  assert.match(md, /- \[ \] §3\.2 — You · 2026-07-01/);
  assert.match(md, /search: "the melt-pool contrast was pronounced"/);
  assert.match(md, /Comment: Overstates it\./);
  assert.match(md, /before: "was pronounced"  →  after: "was measurable"/);
});

test('worklistToMarkdown: actioned item uses a checked box', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({ actioned: true })]) }, CFG);
  assert.match(worklistToMarkdown(wl, META), /- \[x\] /);
});

test('worklistToMarkdown: shows line number only when synctex present', () => {
  const withLine = buildWorklist(CH, { ch_results: rev([cmt({
    anchor: { quote: 'foo', synctex: { line: 142 }, section: '§3.2' } })]) }, CFG);
  assert.match(worklistToMarkdown(withLine, META), /search: "foo"  · line 142/);
  const noLine = buildWorklist(CH, { ch_results: rev([cmt({})]) }, CFG);
  assert.doesNotMatch(worklistToMarkdown(noLine, META), /· line/);
});

test('worklistToMarkdown: empty-quote item locates by label, omits edit block', () => {
  const wl = buildWorklist(CH, { ch_results: rev([cmt({
    kind: 'figure', anchor: { quote: '', synctex: null, figure: 'Figure 3.2', section: '§3.2' } })]) }, CFG);
  const md = worklistToMarkdown(wl, META);
  assert.match(md, /Find in Overleaf → Figure 3\.2/);
  assert.doesNotMatch(md, /before:/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/worklist.test.mjs`
Expected: FAIL — `worklistToMarkdown is not a function` (Task-1 tests still PASS).

- [ ] **Step 3: Write minimal implementation** (append to `js/worklist.js`)

```js
// Escape for inline Markdown: neutralize backticks, collapse newlines.
const esc = s => String(s == null ? '' : s).replace(/`/g, '‘').replace(/\r?\n/g, ' ');

export function worklistToMarkdown(worklist, meta) {
  const m = meta || {};
  const totalOpen = (worklist || []).reduce((n, g) => n + (g.open || 0), 0);
  const head = [
    `# Review worklist — ${m.docTitle || 'document'}`,
    `Generated ${(m.generatedTs || '').slice(0, 10)} · ${totalOpen} open item${totalOpen === 1 ? '' : 's'}`,
    '',
  ];
  if (!worklist || !worklist.length) {
    return [...head, "No open comments — you're all caught up.", ''].join('\n');
  }
  const lines = [...head];
  for (const g of worklist) {
    lines.push(`## ${g.file || g.title}`, '');
    for (const it of g.items) {
      const box = it.actioned ? 'x' : ' ';
      const who = `${it.section ? it.section + ' — ' : ''}${it.reviewerName} · ${(it.ts || '').slice(0, 10)}`;
      lines.push(`- [${box}] ${who}`);
      if (it.locator.quote) {
        lines.push(`  Find in Overleaf → search: "${esc(it.locator.quote)}"${it.locator.line ? `  · line ${it.locator.line}` : ''}`);
      } else if (it.locator.label) {
        lines.push(`  Find in Overleaf → ${esc(it.locator.label)}`);
      }
      if (it.comment) lines.push(`  Comment: ${esc(it.comment)}`);
      if (it.before != null && it.after != null) {
        lines.push(`  Suggested edit — before: "${esc(it.before)}"  →  after: "${esc(it.after)}"`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/worklist.test.mjs`
Expected: PASS — 11 tests total.

- [ ] **Step 5: Verify the whole suite is green**

Run: `npm test`
Expected: PASS, no regressions in other `tests/*.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add js/worklist.js tests/worklist.test.mjs
git commit -m "feat(worklist): worklistToMarkdown — Overleaf checklist payload"
```

---

## Task 3: Owner portal — gather reviews + render panel

Not unit-testable (DOM + network). **Verification gate: browser (preview server).**

**Files:**
- Modify: `owner.html` (button + panel container + CSS)
- Modify: `js/app.js` (import worklist, gather reviews across chapters, render)

- [ ] **Step 1: Locate the export controls.** Read `owner.html` and find the element `#dl-export-all` / `#btn-export` (referenced in `js/app.js`). Note the container and its class pattern.

- [ ] **Step 2: Add the button + panel to `owner.html`.** Beside the existing export control, add:

```html
<button id="btn-overleaf" class="btn">Take to Overleaf</button>
<div id="overleaf-panel" class="ovl-panel" hidden>
  <div class="ovl-head">
    <b>Take reviewer feedback to Overleaf</b>
    <div class="ovl-actions">
      <button id="ovl-copy" class="btn btn-sm">Copy all as Markdown</button>
      <button id="ovl-download" class="btn btn-sm">Download .md</button>
      <button id="ovl-print" class="btn btn-sm">Print</button>
      <button id="ovl-close" class="btn btn-sm" aria-label="Close">✕</button>
    </div>
  </div>
  <p class="ovl-sub">Each item shows where to edit in your <code>.tex</code> and what to change. Search the quoted text in Overleaf; tick items off as you go.</p>
  <div id="ovl-body" class="ovl-body"></div>
</div>
```

- [ ] **Step 3: Add CSS to `owner.html`** (in the existing `<style>`, matching current tokens like `var(--panel)`, `var(--text-2)`):

```css
.ovl-panel{position:fixed;inset:6vh 6vw auto auto;left:6vw;max-width:860px;margin:0 auto;background:var(--panel,#12161f);border:1px solid var(--line,#232a36);border-radius:14px;padding:18px 20px;max-height:82vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.5);z-index:60}
.ovl-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
.ovl-actions{display:flex;gap:8px;flex-wrap:wrap}
.ovl-sub{color:var(--text-2,#96a0b5);font-size:13px;margin:0 0 14px}
.ovl-grp{margin:0 0 18px}
.ovl-grp-h{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--text,#e7ecf3);background:var(--chip,#1b2130);padding:6px 10px;border-radius:8px;display:inline-block;margin-bottom:8px}
.ovl-grp-h .ovl-n{color:var(--text-2,#96a0b5);font-family:inherit}
.ovl-item{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--line,#232a36)}
.ovl-item.done{opacity:.5}
.ovl-item .ovl-cb{margin-top:3px}
.ovl-meta{font-size:12px;color:var(--text-2,#96a0b5);margin-bottom:3px}
.ovl-loc{font-size:12.5px;margin:2px 0}
.ovl-loc code{background:var(--chip,#1b2130);padding:1px 6px;border-radius:5px}
.ovl-cmt{font-size:13.5px;margin:2px 0}
.ovl-edit{font-size:12.5px;margin:3px 0 0;color:var(--text-2,#96a0b5)}
.ovl-edit .ba{color:var(--text,#e7ecf3)}
.ovl-empty{color:var(--text-2,#96a0b5);padding:24px 0;text-align:center}
@media print{body>*{display:none!important}.ovl-panel{display:block!important;position:static;inset:auto;max-height:none;box-shadow:none;border:none}.ovl-actions,.ovl-cb{display:none!important}}
```

- [ ] **Step 4: Import worklist in `js/app.js`.** At the top with the other imports (match the existing cachebust stamp on sibling imports, e.g. `?v=<sha>`):

```js
import { buildWorklist, worklistToMarkdown } from './worklist.js';
import { getConfig } from './config.js';   // if not already imported; else reuse existing import
import { loadChapters } from './config.js'; // verify the exact export name for the chapters loader
```

Note for implementer: confirm how the app already obtains the chapter list (search `js/app.js` and `js/config.js` for `loadChapters` / `chapters.json`). Reuse that exact function; do not invent one.

- [ ] **Step 5: Add the gather+render function in `js/app.js`:**

```js
// Fetch every chapter's review and render the Overleaf worklist panel.
async function openOverleafPanel() {
  const t = tok(); const cfg = getConfig();
  const chapters = await loadChapters();            // reuse the app's existing chapters source
  const reviews = {};
  await Promise.all(chapters.map(async ch => {
    try { const { json } = await getJson(t, reviewPath(ch.id)); if (json) reviews[ch.id] = json; }
    catch (e) { /* missing review file for a chapter is normal; skip */ }
  }));
  const wl = buildWorklist(chapters, reviews, cfg);
  renderOverleafPanel(wl, cfg);
  const panel = document.getElementById('overleaf-panel'); panel.hidden = false;
  panel.dataset.md = worklistToMarkdown(wl, { docTitle: cfg.doc?.title || 'document', generatedTs: new Date().toISOString() });
}

function renderOverleafPanel(wl, cfg) {
  const body = document.getElementById('ovl-body');
  if (!wl.length) { body.innerHTML = `<div class="ovl-empty">No open comments — you're all caught up.</div>`; return; }
  body.innerHTML = wl.map(g => `
    <div class="ovl-grp">
      <div class="ovl-grp-h">${escapeHtml(g.file || g.title)} <span class="ovl-n">· ${g.open} open</span></div>
      ${g.items.map(it => `
        <label class="ovl-item${it.actioned ? ' done' : ''}" data-cid="${it.id}" data-ch="${it.chapterId}">
          <input type="checkbox" class="ovl-cb"${it.actioned ? ' checked' : ''}>
          <div>
            <div class="ovl-meta">${it.section ? escapeHtml(it.section) + ' · ' : ''}${escapeHtml(it.reviewerName)} · ${(it.ts || '').slice(0, 10)}</div>
            <div class="ovl-loc">${it.locator.quote
              ? `Find in Overleaf → <code>search: "${escapeHtml(it.locator.quote)}"</code>${it.locator.line ? ` · line ${it.locator.line}` : ''}`
              : `Find in Overleaf → ${escapeHtml(it.locator.label || g.title)}`}</div>
            ${it.comment ? `<div class="ovl-cmt">${escapeHtml(it.comment)}</div>` : ''}
            ${(it.before != null && it.after != null)
              ? `<div class="ovl-edit">before <span class="ba">"${escapeHtml(it.before)}"</span> → after <span class="ba">"${escapeHtml(it.after)}"</span></div>` : ''}
          </div>
        </label>`).join('')}
    </div>`).join('');
}
```

- [ ] **Step 6: Wire the open/close buttons in `js/app.js`** (in the same place other buttons are wired):

```js
document.getElementById('btn-overleaf')?.addEventListener('click', () => openOverleafPanel().catch(e => alert('Could not build worklist: ' + e.message)));
document.getElementById('ovl-close')?.addEventListener('click', () => { document.getElementById('overleaf-panel').hidden = true; });
```

- [ ] **Step 7: Browser-verify.** Start the preview server (`footnote` launch config), open `owner.html`, connect (or use dev seed). Click **Take to Overleaf**.
  - Expected: panel opens; one `.ovl-grp` per chapter that has comments; group header shows the `.tex` filename + open count; each item shows the `search: "…"` locator, the comment, and (when present) the before→after block.
  - Check `preview_console_logs` (level error) → none.
  - If no reviews exist in the data repo, verify the empty state renders instead.

- [ ] **Step 8: Commit**

```bash
git add owner.html js/app.js
git commit -m "feat(worklist): owner-portal Take-to-Overleaf panel — gather reviews + render"
```

---

## Task 4: Copy / Download / Print wiring

**Verification gate: browser.**

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Wire the three actions** (add near the other panel button wiring):

```js
document.getElementById('ovl-copy')?.addEventListener('click', async () => {
  const md = document.getElementById('overleaf-panel').dataset.md || '';
  try { await navigator.clipboard.writeText(md); flash('ovl-copy', 'Copied ✓'); }
  catch { const ta = document.createElement('textarea'); ta.value = md; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); flash('ovl-copy', 'Copied ✓'); }
});
document.getElementById('ovl-download')?.addEventListener('click', () => {
  const md = document.getElementById('overleaf-panel').dataset.md || '';
  const cfg = getConfig(); const stamp = new Date().toISOString().slice(0, 10);
  const name = `${(cfg.doc?.title || 'document').replace(/[^\w-]+/g, '-').toLowerCase()}-overleaf-worklist-${stamp}.md`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
document.getElementById('ovl-print')?.addEventListener('click', () => window.print());
```

- [ ] **Step 2: Add the `flash` helper if the codebase lacks one** (search `js/app.js` first; reuse if present):

```js
function flash(id, msg) {
  const b = document.getElementById(id); if (!b) return;
  const old = b.textContent; b.textContent = msg; b.disabled = true;
  setTimeout(() => { b.textContent = old; b.disabled = false; }, 1400);
}
```

- [ ] **Step 3: Browser-verify.**
  - Click **Copy all as Markdown** → button shows "Copied ✓". Paste into a scratch buffer (or read via `preview_eval` of `navigator.clipboard.readText()` if permitted) and confirm it starts with `# Review worklist —`.
  - Click **Download .md** → a file downloads named `<doc>-overleaf-worklist-<date>.md`; verify via `preview_network` / the download event.
  - Click **Print** → the print dialog opens; via `@media print` only the panel is visible (verify in print preview / screenshot).
  - `preview_console_logs` (error) → none.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(worklist): copy / download .md / print for the Overleaf panel"
```

---

## Task 5: "Actioned" checkbox persistence

**Verification gate: browser (with a real or dev data repo).**

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Wire checkbox → persist** (delegated listener on the panel body). Uses existing `getJson`/`putJson`/`reviewPath` and `updateComment` from `model.js`:

```js
import { updateComment } from './model.js';   // add to imports if not present

document.getElementById('ovl-body')?.addEventListener('change', async (e) => {
  const cb = e.target.closest('.ovl-cb'); if (!cb) return;
  const item = cb.closest('.ovl-item'); const cid = item.dataset.cid, ch = item.dataset.ch;
  const actioned = cb.checked; item.classList.toggle('done', actioned);
  try {
    const t = tok();
    const { json, sha } = await getJson(t, reviewPath(ch));
    if (!json) throw new Error('review not found');
    const next = updateComment(json, cid, { actioned });
    await putJson(t, reviewPath(ch), next, sha, `worklist: ${actioned ? 'actioned' : 'reopened'} ${cid} in ${ch}`, false);
    // keep panel Markdown in sync so a subsequent Copy/Download reflects the tick
    const panel = document.getElementById('overleaf-panel');
    // cheap: re-open to rebuild from source of truth
  } catch (err) {
    cb.checked = !actioned; item.classList.toggle('done', !actioned);   // optimistic rollback
    alert('Could not save: ' + err.message);
  }
});
```

- [ ] **Step 2: Keep the copyable Markdown fresh after a tick.** Simplest correct approach: after a successful `putJson`, re-run the gather so `panel.dataset.md` and the open counts update:

```js
    // (inside the try, after putJson succeeds)
    await openOverleafPanel();
```

Remove the now-redundant local `item.classList` toggle if `openOverleafPanel` fully re-renders (it does). Keep the optimistic rollback in `catch`.

- [ ] **Step 3: Browser-verify.**
  - Tick an item → row dims (`.done`); no console error; a PUT to `reviews/<ch>.json` fires (`preview_network`).
  - Re-open the panel (close + Take to Overleaf) → the item is still checked and the group open-count dropped by 1 (persistence survived).
  - Untick → reverts and persists.
  - Simulate a failure (e.g. temporarily bad token) → checkbox rolls back and an alert shows.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(worklist): persist per-comment actioned flag from the panel"
```

---

## Task 6: Walkthrough scene

**Verification gate: browser (scene plays, no console errors).**

**Files:**
- Modify: `tutorials/walkthrough.html`

- [ ] **Step 1: Read the scene array** in `tutorials/walkthrough.html`. Find the `scenes` array, the outro scene (last), the `hold`/`S`/`stage` helpers, and the existing `OVERLEAF` icon const. Insert the new scene immediately **before the outro** scene object.

- [ ] **Step 2: Add scene CSS** (near the other scene CSS, before `/* cursor */`):

```css
.ovl-wl{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;justify-content:center}
.ovl-card{background:#12161f;border:1px solid #232a36;border-radius:12px;padding:14px 16px;width:340px;text-align:left}
.ovl-card h4{margin:0 0 8px;font:600 13px ui-monospace,Menlo,monospace;color:#cfd7e6}
.ovl-row{border-top:1px solid #232a36;padding:8px 0;font-size:12.5px;color:#96a0b5}
.ovl-row .chip{background:#1b2130;color:#e7ecf3;border-radius:5px;padding:1px 6px;font-family:ui-monospace,Menlo,monospace}
.ovl-row .ba{color:#e7ecf3}
.ovl-oe{background:#0f1722;border:1px solid #1f6f3f;border-radius:12px;padding:14px 16px;width:300px;text-align:left;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#cfe8d6}
.ovl-oe .found{background:#2e7d46;color:#fff;border-radius:3px;padding:0 3px}
.ovl-cta{margin-top:14px;background:#138a07;color:#fff;border-radius:8px;padding:8px 14px;display:inline-block;font:600 13px system-ui}
```

- [ ] **Step 3: Insert the scene object** (before the outro):

```js
{ k:'Back to Overleaf', t:'Reviewers comment in Footnote. One click gives you a worklist — exact search text and suggested wording — that you clear in Overleaf in minutes.', dur:9000,
  build(){ stage.innerHTML = `<div class="ovl-wl">
    <div class="ovl-card" id="wlcard">
      <h4>${OVERLEAF} chapters/results.tex · 2 open</h4>
      <div class="ovl-row">§3.2 · Carolyn Seepersad<br>Find → <span class="chip">search: "contrast was pronounced"</span><br>before <span class="ba">"pronounced"</span> → after <span class="ba">"measurable"</span></div>
      <div class="ovl-row">§3.4 · You<br>Find → <span class="chip">search: "the densification front"</span></div>
      <div class="ovl-cta" id="wlcopy">Copy all as Markdown</div>
    </div>
    <div class="ovl-oe" id="wloe">
      <div>Overleaf · results.tex</div><br>
      <div>…the melt-pool <span id="wlword">contrast was pronounced</span> across…</div>
    </div>
  </div>`; },
  async run(my){
    cur.style.opacity=1;
    await moveCursorTo('#wlcopy'); await hold(500);
    S('#wlcopy').textContent='Copied ✓'; await hold(900);
    await moveCursorTo('#wloe'); await hold(500);
    S('#wlword').className='found'; await hold(1100);
    S('#wlword').textContent='contrast was measurable'; S('#wlword').className=''; await hold(1600);
  } },
```

Note for implementer: `moveCursorTo` / `cur` / `S` / `hold` / `stage` are the existing scene helpers — confirm their exact names in the file and match them (the walkthrough already uses an animated cursor). If the cursor helper has a different name, use the one the other scenes call.

- [ ] **Step 4: Browser-verify.** Serve the repo; open `tutorials/walkthrough.html`. Use the jump dots to land on the new scene.
  - Expected: the worklist card (with the search-chips + before/after) and the mock Overleaf pane render; cursor moves to "Copy all as Markdown" → "Copied ✓"; then the Overleaf word highlights and swaps to "measurable".
  - `preview_eval` `scenes.length` increased by exactly 1 vs. before.
  - `preview_console_logs` (error) → none.

- [ ] **Step 5: Commit**

```bash
git add tutorials/walkthrough.html
git commit -m "feat(walkthrough): scene — take reviewer feedback back to Overleaf"
```

---

## Task 7: Final integration pass

- [ ] **Step 1: Full suite.** Run `npm test` → all `tests/*.test.mjs` PASS.
- [ ] **Step 2: AI-free guarantee.** Confirm the panel/worklist lives only in `owner.html`/`js/app.js`/`js/worklist.js` — NOT in the advisor bundle. Re-grep the advisor surface:
  `grep -rlai "claude\|\bai\b\|agent" advisor.html js/advisor.js CJS.html CCS.html 2>/dev/null` → expect no worklist-introduced hits (pre-existing unrelated hits, if any, unchanged).
- [ ] **Step 3: Browser smoke.** Owner portal: open panel, copy, download, tick one item, reload, confirm persistence. Walkthrough: play straight through, no console errors, embedded landing video still plays (it iframes the same file).
- [ ] **Step 4: README.** Add one line under "Walkthrough"/features noting the "Take to Overleaf" worklist. Commit.
- [ ] **Step 5: Push.** Fetch/rebase (resolve any cachebust `?v=` import conflicts by keeping newer stamps + all imports, given the active parallel session), then push all commits.

---

## Notes for the implementer

- **Cachebust:** CI stamps `?v=<sha>` on imports. New imports you add to `js/app.js` (e.g. `./worklist.js`, `./model.js`) may be auto-stamped later — don't fight it; if a rebase conflicts on import lines, keep the newer stamp and keep every import.
- **`js/app.js` has an emoji** → `grep` treats it as binary; use `grep -a`. `node --check` false-passes on conflict markers → always browser-verify (`#topbar` non-empty, no console errors) after resolving a conflict there.
- **Parallel session:** another Claude session edits this repo concurrently (`index.html`, `js/hub.js`, `js/importdoc.js`). Touch only the files in this plan; on push, rebase rather than merge.
- **Chapters source:** the app loads chapters from the data repo (`loadChapters()` / `chapters.json`), NOT from `config.chapters`. Reuse the app's existing loader — verify its exact name before Task 3.

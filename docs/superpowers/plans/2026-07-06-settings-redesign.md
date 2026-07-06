# Settings Redesign (Project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all owner configuration off the Reviewers page into a dedicated, progressively-disclosed Settings page (gear entry, left-nav sections, status-card + dialog pattern), losing no function.

**Architecture:** Two new pure modules — `js/settings.js` (left-nav model + section resolver) and `js/modal.js` (modal-stack reducer) — are TDD'd with `node --test`. The view (`openSettingsPage`, section renderers, the two dialogs, the shared `openModal` DOM helper, the Reviewers-page reorg) lives in `js/app.js` and is verified through a browser gate because it's DOM/layout, not unit-testable. All GitHub/secret I/O reuses existing tested helpers (`setAiSecrets`, `claudeConnectionStatus`, `PROVIDERS`/`detectProvider`, `ensureApplyEngine`, `writeProjectPatch`).

**Tech Stack:** Vanilla ES modules, `node --test` (JS unit), GitHub Pages SPA. No build step. `app.js` contains emoji/binary — always `grep -a`.

---

## Spec

Design spec: `docs/superpowers/footnote/specs/2026-07-06-settings-redesign-design.md`. Read it before starting.

## Constraints (apply to EVERY task)

- **Document-agnostic** — no dissertation/RFAM specifics.
- **`advisor.js` stays AI-clean** — after any change, `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` returns NOTHING. (advisor.js should not be touched at all in this project.)
- **Not AI-forward** — AI off by default; Claude/AI section understated when off; deterministic review flow works with AI off.
- **Adopter-owned credentials** — never hardcode personal repos/tokens.
- **TDD red-green** for pure logic (Tasks 1–2); **browser-verification gate** for DOM (Tasks 3–9), stated explicitly, never skipped.
- Cache-bust bot bumps `?v=<sha>` on JS import lines; when adding an import, match the current sha used by the other imports on that line-block. Resolve rebase conflicts by keeping the newest cachebust + your additions.
- Commit after every green step. When committing: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git commit …` in ONE command. Conventional Commits; end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- **Create `js/settings.js`** — pure: `settingsSections(cfg, state)` → ordered `{id,label,glyph,muted}[]`; `resolveSection(sections, requested)` → active section id. No DOM, no app state.
- **Create `js/modal.js`** — pure: `modalReducer(stack, action)`, `topModal(stack)`. The modal-stack logic (ESC closes topmost) behind the DOM helper.
- **Create `tests/settings.test.mjs`**, **`tests/modal.test.mjs`** — `node --test`.
- **Modify `js/app.js`** — add: `openSettingsPage(section)` view + per-section renderers (`renderSettingsEmail`, `renderSettingsAccess`, `renderSettingsAgents`, `renderSettingsAI`), the two dialogs (`openClaudeDialog`, `openEmailDialog`), the shared DOM `openModal(...)`, gear buttons in `renderTopbar`/`enterHome`, `⋯` deep-links. Remove the Settings block from `openReleasePanel` and reorganize its leftovers into People/Access/Inbox. Move `aiSettingHtml` logic into the AI section; delete the old inline `manageToken` prompt.
- **Modify `css/app.css`** (the main stylesheet — confirm exact filename with `ls css/`) — `.set-*` classes for the Settings page + `.modal*` classes.
- **Modify `tests/` imports** only as above.

Confirm the stylesheet filename first: `ls /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt/css`. The plan writes CSS into the primary app stylesheet that `app.html` loads.

---

### Task 1: `js/settings.js` — left-nav model (pure, TDD)

**Files:**
- Create: `js/settings.js`
- Test: `tests/settings.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsSections, resolveSection } from '../js/settings.js';

const cfg = { reviewAgents: [] };

test('AI off: sections are email, access, ai(last, muted); NO agents', () => {
  const s = settingsSections(cfg, { aiOn:false, claudeConnected:false, emailConfigured:false, hasToken:false });
  assert.deepEqual(s.map(x => x.id), ['email', 'access', 'ai']);
  const ai = s.find(x => x.id === 'ai');
  assert.equal(ai.muted, true);           // understated when off
  assert.equal(ai.glyph, null);           // no marketing glyph
  assert.equal(ai.label, 'AI assistant'); // soft label when off
});

test('AI on: agents appears before ai; ai not muted', () => {
  const s = settingsSections(cfg, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.deepEqual(s.map(x => x.id), ['email', 'access', 'agents', 'ai']);
  assert.equal(s.find(x => x.id === 'ai').muted, false);
  assert.equal(s.find(x => x.id === 'ai').label, 'Claude / AI');
});

test('glyphs reflect state: ok when configured, warn when not', () => {
  const s = settingsSections(cfg, { aiOn:true, claudeConnected:false, emailConfigured:false, hasToken:true });
  assert.equal(s.find(x => x.id === 'email').glyph, 'warn');
  assert.equal(s.find(x => x.id === 'access').glyph, 'ok');
  assert.equal(s.find(x => x.id === 'ai').glyph, 'warn');   // on but not connected
});

test('agents glyph is ok only when agents configured', () => {
  const on = settingsSections({ reviewAgents:['rigor'] }, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.equal(on.find(x => x.id === 'agents').glyph, 'ok');
  const off = settingsSections({ reviewAgents:[] }, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.equal(off.find(x => x.id === 'agents').glyph, null);
});

test('resolveSection keeps a valid request, else falls back to first', () => {
  const s = settingsSections(cfg, { aiOn:false, claudeConnected:false, emailConfigured:false, hasToken:false });
  assert.equal(resolveSection(s, 'access'), 'access');
  assert.equal(resolveSection(s, 'agents'), 'email');   // agents hidden when AI off → fall back
  assert.equal(resolveSection(s, undefined), 'email');
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && node --test tests/settings.test.mjs`
Expected: FAIL — `Cannot find module '../js/settings.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// js/settings.js
// Pure model for the Settings page left-nav (Project A). No DOM, no app state — the view in app.js
// maps glyph ('ok'|'warn'|null) to a ✓/●/none marker and renders the muted flag. Footnote is not
// AI-forward: the AI section is present but understated (last, muted, soft label, no glyph) while AI
// is off, and the Agents section is hidden entirely until AI is on.
export function settingsSections(cfg, state) {
  const agents = (cfg && cfg.reviewAgents) || [];
  const secs = [
    { id: 'email',  label: 'Email & notifications', glyph: state.emailConfigured ? 'ok' : 'warn', muted: false },
    { id: 'access', label: 'Access token',          glyph: state.hasToken ? 'ok' : 'warn',        muted: false },
  ];
  if (state.aiOn) {
    secs.push({ id: 'agents', label: 'Agents', glyph: agents.length ? 'ok' : null, muted: false });
  }
  secs.push(state.aiOn
    ? { id: 'ai', label: 'Claude / AI',  glyph: state.claudeConnected ? 'ok' : 'warn', muted: false }
    : { id: 'ai', label: 'AI assistant', glyph: null,                                  muted: true  });
  return secs;
}

// The active section id: honor a valid deep-link request, else the first (visible) section.
export function resolveSection(sections, requested) {
  const ids = sections.map(s => s.id);
  return requested && ids.includes(requested) ? requested : ids[0];
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && node --test tests/settings.test.mjs`
Expected: PASS (5 tests). Output pristine.

- [ ] **Step 5: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add js/settings.js tests/settings.test.mjs && git commit -m "feat(settings): pure left-nav model (settingsSections/resolveSection)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `js/modal.js` — modal-stack reducer (pure, TDD)

**Files:**
- Create: `js/modal.js`
- Test: `tests/modal.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/modal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modalReducer, topModal } from '../js/modal.js';

test('open pushes, close pops the topmost, closeAll empties', () => {
  let s = [];
  s = modalReducer(s, { type:'open', id:'claude' });
  s = modalReducer(s, { type:'open', id:'email' });
  assert.deepEqual(s, ['claude', 'email']);
  assert.equal(topModal(s), 'email');       // ESC closes the topmost first
  s = modalReducer(s, { type:'close' });
  assert.deepEqual(s, ['claude']);
  s = modalReducer(s, { type:'closeAll' });
  assert.deepEqual(s, []);
  assert.equal(topModal(s), null);
});

test('close on empty stack is a no-op (never throws)', () => {
  assert.deepEqual(modalReducer([], { type:'close' }), []);
});

test('unknown action returns the stack unchanged', () => {
  assert.deepEqual(modalReducer(['a'], { type:'wat' }), ['a']);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && node --test tests/modal.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// js/modal.js
// Pure modal-stack state behind app.js's openModal() DOM helper. Modals stack (a dialog can open a
// child); ESC / overlay-click closes the topmost only. The DOM wiring lives in app.js; this keeps the
// ordering logic unit-testable.
export function modalReducer(stack, action) {
  switch (action && action.type) {
    case 'open':     return [...stack, action.id];
    case 'close':    return stack.slice(0, -1);
    case 'closeAll': return [];
    default:         return stack;
  }
}
export function topModal(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && node --test tests/modal.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add js/modal.js tests/modal.test.mjs && git commit -m "feat(settings): pure modal-stack reducer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Settings page shell + gear entry (DOM, browser gate)

Adds `openModal` DOM helper, `openSettingsPage(section)`, the left-nav render, and gear buttons. Sections render placeholder panes here; Tasks 4–7 fill them.

**Files:**
- Modify: `js/app.js` — imports; `renderTopbar` (~231 group); `enterHome` (~1843 group); new functions near `openReleasePanel` (~2603).
- Modify: `css/app.css` — `.set-*` + `.modal*` classes.

- [ ] **Step 1: Confirm stylesheet + read anchors**

Run: `ls /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt/css` and `grep -an "renderTopbar\|function enterHome\|btn-releases\|ovl-panel" js/app.js | head`. Note the primary stylesheet filename for the CSS steps below.

- [ ] **Step 2: Add the import (top of app.js)**

Add to the import block, matching the current `?v=<sha>` used by neighboring imports:

```js
import { settingsSections, resolveSection } from './settings.js?v=CURRENTSHA';
import { modalReducer, topModal } from './modal.js?v=CURRENTSHA';
```

- [ ] **Step 3: Add CSS**

Append to the primary stylesheet:

```css
/* Settings page (Project A) */
.set-wrap{display:flex;min-height:calc(100vh - 120px)}
.set-nav{width:230px;flex:none;border-right:.5px solid var(--border);padding:14px 10px}
.set-nav .set-item{display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-2)}
.set-nav .set-item:hover{background:var(--bg-3)}
.set-nav .set-item.active{background:var(--accent-bg);color:var(--accent);font-weight:600}
.set-nav .set-item.muted{color:var(--text-3)}
.set-nav .set-g{margin-left:auto;font-size:13px}
.set-nav .set-g.ok{color:var(--success)} .set-nav .set-g.warn{color:var(--warn)}
.set-pane{flex:1;padding:20px 26px;max-width:640px}
.set-card{border:.5px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px;background:var(--bg-2)}
.set-card h4{font-size:13px;font-weight:600;margin:0 0 4px}
.set-status{display:flex;align-items:center;gap:8px;font-size:12.5px}
.set-status .ok{color:var(--success)} .set-status .warn{color:var(--warn)}
/* Shared modal */
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:80;display:flex;align-items:center;justify-content:center}
.modal-box{background:var(--bg);border:.5px solid var(--border-2);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.28);width:min(560px,92vw);max-height:86vh;overflow:auto;padding:0}
.modal-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:.5px solid var(--border);font-weight:600;font-size:14px}
.modal-head .modal-x{margin-left:auto;cursor:pointer;color:var(--text-3);background:none;border:none;font-size:16px}
.modal-body{padding:16px 18px}
.modal-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:.5px solid var(--border)}
```

- [ ] **Step 4: Add the shared `openModal` DOM helper**

Place near `openReleasePanel`. Uses `modalReducer`/`topModal` for the ESC stack.

```js
// Shared modal used by Settings dialogs (and, later, agent authoring). Stacks; ESC / backdrop-click
// closes the topmost. `body` is an HTMLElement; `actions` is [{label, primary?, onClick(close)}].
let _modalStack = [];
function openModal(title, body, actions = []) {
  const id = 'm_' + (_modalStack.length + 1);
  _modalStack = modalReducer(_modalStack, { type:'open', id });
  const back = document.createElement('div'); back.className = 'modal-backdrop'; back.dataset.mid = id;
  const foot = actions.map((a, i) => `<button class="btn${a.primary?' btn-primary':''}" data-i="${i}">${a.label}</button>`).join('');
  back.innerHTML = `<div class="modal-box"><div class="modal-head">${title}<button class="modal-x" aria-label="Close">×</button></div>
    <div class="modal-body"></div>${actions.length?`<div class="modal-foot">${foot}</div>`:''}</div>`;
  back.querySelector('.modal-body').appendChild(body);
  const close = () => { back.remove(); _modalStack = modalReducer(_modalStack, { type:'close' });
    if (_onModalEsc && !_modalStack.length){ document.removeEventListener('keydown', _onModalEsc); _onModalEsc = null; } };
  back.querySelector('.modal-x').onclick = close;
  back.onclick = e => { if (e.target === back) close(); };   // backdrop only
  actions.forEach((a, i) => { const b = back.querySelector(`.modal-foot [data-i="${i}"]`); if (b) b.onclick = () => a.onClick(close); });
  document.body.appendChild(back);
  if (!_onModalEsc){ _onModalEsc = e => { if (e.key === 'Escape'){ const top = document.querySelector(`.modal-backdrop[data-mid="${topModal(_modalStack)}"]`); top?.querySelector('.modal-x')?.click(); } };
    document.addEventListener('keydown', _onModalEsc); }
  return close;
}
let _onModalEsc = null;
```

- [ ] **Step 5: Add `openSettingsPage` shell + left-nav**

```js
// Dedicated Settings page (Project A). In-place view like openReleasePanel: swaps topbar + main area,
// renders a left-nav (settingsSections model) + a detail pane. `section` deep-links a starting section.
let _setSection = null;
async function openSettingsPage(section) {
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<strong style="font-size:16px;font-weight:600"><i class="ti ti-settings" style="margin-right:7px"></i>Settings</strong>
     <button class="btn" id="set-close" style="margin-left:auto"><i class="ti ti-arrow-left"></i>Back to ${UNIT}s</button>`;
  document.getElementById('set-close').onclick = enterHome;
  // connection state for glyphs (secret NAMES only — values are unreadable)
  let claudeConnected = false, emailConfigured = false;
  try { claudeConnected = claudeConnectionStatus(await listSecretNames(t)).claude; } catch {}
  try { const r = await loadAdvisorsRegistry(t); emailConfigured = r.reg?.email_configured === true; } catch {}
  const state = { aiOn: assistantOn(), claudeConnected, emailConfigured, hasToken: !!t };
  const secs = settingsSections(_CFG, state);
  _setSection = resolveSection(secs, section || _setSection);
  const nav = secs.map(s => `<div class="set-item${s.id===_setSection?' active':''}${s.muted?' muted':''}" data-s="${s.id}">
      <span>${escapeHtml(s.label)}</span>${s.glyph?`<span class="set-g ${s.glyph}">${s.glyph==='ok'?'✓':'●'}</span>`:''}</div>`).join('');
  read.innerHTML = `<div class="set-wrap"><div class="set-nav">${nav}</div><div class="set-pane" id="set-pane"></div></div>`;
  read.querySelectorAll('.set-item').forEach(el => el.onclick = () => { _setSection = el.dataset.s; openSettingsPage(_setSection); });
  renderSettingsSection(_setSection, t);
}
function renderSettingsSection(id, t) {
  const pane = document.getElementById('set-pane'); if (!pane) return;
  if (id === 'email')  return renderSettingsEmail(pane, t);
  if (id === 'access') return renderSettingsAccess(pane, t);
  if (id === 'agents') return renderSettingsAgents(pane, t);
  if (id === 'ai')     return renderSettingsAI(pane, t);
}
// Temporary placeholders — replaced in Tasks 4–7.
function renderSettingsEmail(p){ p.innerHTML = '<div class="set-card">Email — TODO Task 5</div>'; }
function renderSettingsAccess(p){ p.innerHTML = '<div class="set-card">Access — TODO Task 4</div>'; }
function renderSettingsAgents(p){ p.innerHTML = '<div class="set-card">Agents — TODO Task 7</div>'; }
function renderSettingsAI(p){ p.innerHTML = '<div class="set-card">AI — TODO Task 6</div>'; }
```

- [ ] **Step 6: Add the gear button to both topbars**

In `renderTopbar` (the right-side button group), add before `btn-more`:

```js
      <button class="icbtn" id="btn-settings" title="Settings"><i class="ti ti-settings"></i></button>
```

and wire it after the other `.onclick` bindings in `renderTopbar`:

```js
  document.getElementById('btn-settings').onclick = () => openSettingsPage();
```

In `enterHome`'s topbar (next to `btn-releases`), add:

```js
     <button class="btn" id="btn-settings-h" style="padding:6px 12px"><i class="ti ti-settings"></i>Settings</button>
```

and wire (with the other `enterHome` bindings):

```js
  document.getElementById('btn-settings-h').onclick = () => openSettingsPage();
```

- [ ] **Step 7: Browser-verify (gate)**

Run the dev server (`preview_start` per webapp-testing) and load `app.html`. Verify:
- Gear appears in both the reading topbar and the home topbar.
- Clicking it opens the Settings page: left-nav shows **Email & notifications**, **Access token**, **AI assistant** (muted, last, no glyph) — and NO Agents row (AI off by default).
- Clicking each nav item swaps the placeholder pane and highlights the active item.
- "Back to …" returns to the document.
- Console clean (no errors).
- `node --test tests/*.test.mjs` still all green.

- [ ] **Step 8: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): dedicated Settings page shell + gear entry + shared modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Access section (token + source-repo token)

Home of the browser PAT (from `manageToken`) and the source-repo token (moved out of the AI block). No `prompt()`.

**Files:** Modify `js/app.js` — replace `renderSettingsAccess` placeholder.

- [ ] **Step 1: Implement `renderSettingsAccess`**

```js
// Access section: the browser PAT (read/write on the data repo) + the optional source-repo token
// (only when the paper's LaTeX lives in a separate repo). Replaces the old ⋯ prompt() flow.
function renderSettingsAccess(pane, t) {
  const has = !!tok();
  pane.innerHTML = `
    <div class="set-card">
      <h4>Access token</h4>
      <div class="set-status">${has?'<span class="ok">✓</span> Connected — stored only in this browser.':'<span class="warn">●</span> Not set — Footnote can’t read your repo without it.'}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="set-pat" type="password" placeholder="fine-grained PAT · Contents: read/write on ${escapeHtml(DATA_REPO)}" style="flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <button class="btn btn-primary" id="set-pat-save" style="padding:5px 12px">Save</button>
        ${has?'<button class="btn" id="set-pat-clear" style="padding:5px 12px">Remove</button>':''}
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a fine-grained PAT →</a></div>
    </div>
    <div class="set-card">
      <h4>Source repo token <span style="font-weight:400;color:var(--text-3)">— only for external source</span></h4>
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">Only needed if this paper’s LaTeX lives in a <b>separate</b> repo (not imported into ${escapeHtml(DATA_REPO)}). Sealed into your data repo’s Actions secrets as <code>SOURCE_TOKEN</code>.</div>
      <div style="display:flex;gap:8px">
        <input id="set-srctok" type="password" placeholder="fine-grained PAT · Contents: write on the source repo" style="flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <button class="btn" id="set-srctok-save" style="padding:5px 12px">Save</button>
        <span id="set-srctok-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
    </div>`;
  pane.querySelector('#set-pat-save').onclick = () => {
    const v = pane.querySelector('#set-pat').value.trim();
    if (!v){ flash('Paste a token first.'); return; }
    localStorage.setItem('ghpat', v); flash('Token saved.'); openSettingsPage('access');
  };
  const clr = pane.querySelector('#set-pat-clear');
  if (clr) clr.onclick = () => { if (confirm('Remove the saved access token from this browser?')){ localStorage.removeItem('ghpat'); flash('Token removed.'); openSettingsPage('access'); } };
  pane.querySelector('#set-srctok-save').onclick = async () => {
    const v = pane.querySelector('#set-srctok').value.trim(); const stat = pane.querySelector('#set-srctok-stat');
    if (!v){ stat.textContent = 'Paste a token first.'; return; }
    stat.style.color = 'var(--text-3)'; stat.textContent = 'Sealing…';
    try { await setAiSecrets(t, sealToBase64, { sourceToken: v }); stat.style.color = 'var(--success)'; stat.textContent = 'Saved SOURCE_TOKEN.'; pane.querySelector('#set-srctok').value = ''; }
    catch(e){ stat.style.color = 'var(--warn)'; stat.textContent = isScopeError(e) ? 'Token lacks Secrets write.' : 'Failed: ' + e.message; }
  };
}
```

- [ ] **Step 2: Browser-verify (gate)**

Load Settings → Access. Verify: status reflects whether a token is set; Save persists (reload keeps it, glyph flips to ✓); Remove clears it; source-token Save shows "Saved SOURCE_TOKEN." (with a real token + Secrets scope) or a clear scope error otherwise. Console clean. `node --test` still green.

- [ ] **Step 3: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): Access section — PAT + source-repo token, no prompt()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Email & notifications section (two rows + provider-picker dialog)

**Files:** Modify `js/app.js` — replace `renderSettingsEmail`; add `openEmailDialog`. Reuse `PROVIDERS`/`detectProvider` (already imported) and the existing `openConnectForm`/`openTestSend` if suitable; otherwise the dialog below supersedes them.

- [ ] **Step 1: Implement `renderSettingsEmail` (two rows)**

```js
// Email section: Row 1 = "Notify me" digest (email + frequency). Row 2 = "Invite email" status card;
// "Connect email" opens the provider-picker dialog. Reads notify prefs + email_configured from the
// advisors registry via existing helpers.
async function renderSettingsEmail(pane, t) {
  pane.innerHTML = '<div class="set-card">Loading…</div>';
  let reg = {}; try { reg = (await loadAdvisorsRegistry(t)).reg || {}; } catch {}
  const configured = reg.email_configured === true;
  const notify = reg.notify || {};
  pane.innerHTML = `
    <div class="set-card">
      <h4>Notify me</h4>
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">A digest of reviewer activity, emailed to you.</div>
      <div style="display:flex;gap:8px">
        <input id="set-notify-email" type="email" value="${escapeHtml(notify.email||'')}" placeholder="you@example.com" style="flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <select id="set-notify-freq" style="font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
          <option value="daily"${notify.freq==='daily'?' selected':''}>Daily</option>
          <option value="weekly"${notify.freq==='weekly'||!notify.freq?' selected':''}>Weekly</option>
          <option value="off"${notify.freq==='off'?' selected':''}>Off</option>
        </select>
        <button class="btn" id="set-notify-save" style="padding:5px 12px">Save</button>
        <span id="set-notify-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
    </div>
    <div class="set-card">
      <h4>Invite email</h4>
      <div class="set-status">${configured?'<span class="ok">✓</span> Set up — invites send automatically.':'<span class="warn">●</span> Not set up — add reviewers, but copy portal links yourself until connected.'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-primary" id="set-email-connect" style="padding:5px 12px"><i class="ti ti-plug"></i>${configured?'Change / re-test':'Connect email'}</button>
      </div>
    </div>`;
  pane.querySelector('#set-notify-save').onclick = async () => {
    const stat = pane.querySelector('#set-notify-stat');
    const patch = { notify: { email: pane.querySelector('#set-notify-email').value.trim(), freq: pane.querySelector('#set-notify-freq').value } };
    stat.style.color = 'var(--text-3)'; stat.textContent = 'Saving…';
    try { await saveNotifyPrefs(t, patch); stat.style.color = 'var(--success)'; stat.textContent = 'Saved.'; }
    catch(e){ stat.style.color = 'var(--warn)'; stat.textContent = 'Failed: ' + e.message; }
  };
  pane.querySelector('#set-email-connect').onclick = () => openEmailDialog(t);
}
```

Note: `saveNotifyPrefs(t, patch)` — reuse the existing notify-save path from the old `notify-save` handler (it writes into `advisors.json`/registry). If the current code inlines that write, extract it into `saveNotifyPrefs` (pure-ish I/O wrapper) and call it from both places. Confirm the exact registry field the old handler used and match it.

- [ ] **Step 2: Implement `openEmailDialog` (provider picker)**

```js
// Provider-picker connect dialog. Leads with Gmail / Outlook / Other; picking one shows only that
// provider's host/port + app-password link + fields, backed by the existing PROVIDERS table.
function openEmailDialog(t) {
  const box = document.createElement('div');
  const provIds = ['gmail','outlook','custom'];
  const chips = provIds.map(id => `<span class="btn set-prov" data-p="${id}" style="padding:4px 10px">${PROVIDERS[id].label.split(' ')[0]}</span>`).join(' ');
  box.innerHTML = `<div style="font-size:12.5px;margin-bottom:10px">Choose your mail provider:</div>
    <div style="display:flex;gap:6px;margin-bottom:12px">${chips}</div>
    <div id="set-prov-detail" style="font-size:12px;color:var(--text-3)">Pick a provider to see its steps.</div>`;
  const detail = () => box.querySelector('#set-prov-detail');
  box.querySelectorAll('.set-prov').forEach(c => c.onclick = () => {
    box.querySelectorAll('.set-prov').forEach(x => x.classList.remove('btn-primary'));
    c.classList.add('btn-primary');
    const p = PROVIDERS[c.dataset.p];
    detail().innerHTML = `
      <div style="margin-bottom:8px">Host <code>${escapeHtml(p.host||'—')}</code> · Port <code>${p.port}</code>. ${p.keyUrl?`<a href="${p.keyUrl}" target="_blank" rel="noopener">${escapeHtml(p.keyLabel)} →</a>`:''}</div>
      <ol style="margin:0 0 8px 16px;padding:0">${(p.howto||[]).map(h => `<li style="margin-bottom:3px">${escapeHtml(h)}</li>`).join('')}</ol>
      <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--text-3)">Set it up manually (gh secret set / repo Settings)</summary>
        <div style="font-size:11.5px;margin-top:6px">Add <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>ADVISOR_KEY</code> (+ optional <code>SMTP_HOST</code>/<code>SMTP_PORT</code>) as Actions secrets in <code>${escapeHtml(DATA_REPO)}</code>, then re-test.</div></details>`;
  });
  openModal('<i class="ti ti-plug" style="margin-right:7px"></i>Connect invite email', box, [
    { label:'Send test invite', onClick: (close) => { close(); openTestSend(); } },
  ]);
}
```

Note: verify `openTestSend` exists (it does, ~app.js:2923) and that the manual-secret names match the current invite workflow. Keep the existing `openConnectForm` reachable if it does credential-writing the dialog doesn't; otherwise fold its behavior in. Confirm before deleting `openConnectForm`.

- [ ] **Step 3: Browser-verify (gate)**

Settings → Email. Verify: Notify row prefills + saves; Invite-email status reflects `email_configured`; "Connect email" opens the dialog; clicking Gmail/Outlook/Other shows that provider's host/port + steps + app-password link; "Set it up manually" expands; ESC/backdrop/× close. Console clean. `node --test` green.

- [ ] **Step 4: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): Email section — notify row + provider-picker connect dialog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Claude / AI section (status card + Connect dialog, understated when off)

**Files:** Modify `js/app.js` — replace `renderSettingsAI`; add `openClaudeDialog`; reuse the wiring from the old `wireAiSetup` (`setAiSecrets`, `claudeConnectionStatus`, `ensureApplyEngine`, `dispatchApply`, `toggleAssistant`).

- [ ] **Step 1: Implement `renderSettingsAI`**

```js
// Claude / AI section. OFF: an understated card + the master toggle, nothing else (not AI-forward).
// ON: status card (connected via <secret> / not connected) + Connect / Manage → dialog, + Run apply.
async function renderSettingsAI(pane, t) {
  const on = assistantOn();
  const shipped = (_CFG.reviewAgents || []).length > 0;
  if (!on) {
    pane.innerHTML = `<div class="set-card">
      <h4>AI assistant</h4>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Off by default. The core review flow — comment → stage → approve → merge — works fully without AI. Turn on to send comments to Claude on your own GitHub Actions + credentials.</div>
      <button class="btn" id="set-ai-toggle" style="padding:5px 14px">Turn on</button>
    </div>`;
    pane.querySelector('#set-ai-toggle').onclick = () => { toggleAssistant(); openSettingsPage('ai'); };
    return;
  }
  pane.innerHTML = `<div class="set-card"><div id="set-ai-conn" class="set-status">Checking…</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-primary" id="set-ai-connect" style="padding:5px 12px">Connect / manage Claude</button>
        <button class="btn" id="set-ai-run" style="padding:5px 12px"><i class="ti ti-player-play"></i>Run apply now</button>
        <span id="set-ai-run-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:10px"><i class="ti ti-git-branch"></i> Every Claude edit stages on a <code>review-edits/&lt;${escapeHtml(UNIT)}&gt;</code> branch for you to approve — nothing reaches your document without your say-so.</div>
      ${shipped?'':`<div style="margin-top:10px"><button class="btn" id="set-ai-off" style="padding:4px 11px;font-size:11.5px;color:var(--text-3)">Turn AI assistant off</button></div>`}
    </div>`;
  const conn = pane.querySelector('#set-ai-conn');
  try { const s = claudeConnectionStatus(await listSecretNames(t));
    conn.innerHTML = s.claude ? `<span class="ok">✓</span> Claude connected via <code>${s.via}</code> — every paper in ${escapeHtml(DATA_REPO)} is set.` : '<span class="warn">●</span> Not connected — add your Claude Code token.';
  } catch(e){ conn.textContent = 'Couldn’t check connection: ' + e.message; }
  pane.querySelector('#set-ai-connect').onclick = () => openClaudeDialog(t);
  pane.querySelector('#set-ai-run').onclick = async () => {
    const stat = pane.querySelector('#set-ai-run-stat'); stat.style.color='var(--text-3)'; stat.textContent='Ensuring engine…';
    try { await ensureApplyEngine(DATA_REPO, t); stat.textContent='Dispatching…'; await dispatchApply(t, _CFG.dataPrefix ? _projectId : '');
      stat.style.color='var(--success)'; stat.textContent='Apply run started — watch your repo’s Actions tab.'; }
    catch(e){ stat.style.color='var(--warn)'; stat.textContent = e.message==='workflow-scope'?'Token lacks the workflow scope.':'Failed: '+e.message; }
  };
  const off = pane.querySelector('#set-ai-off'); if (off) off.onclick = () => { toggleAssistant(); openSettingsPage('ai'); };
}
```

- [ ] **Step 2: Implement `openClaudeDialog`**

```js
// Connect Claude dialog: primary = paste the `claude setup-token` value (CLAUDE_CODE_OAUTH_TOKEN);
// Advanced = Anthropic API key fallback. Save seals via setAiSecrets + self-heals the engine.
function openClaudeDialog(t) {
  const box = document.createElement('div');
  box.innerHTML = `
    <div style="font-size:12.5px;margin-bottom:8px">On your computer run <code>claude setup-token</code>, sign in, and paste the token it prints (recommended — no API bill; counts against your Claude plan).</div>
    <input id="set-claude-tok" type="password" placeholder="CLAUDE_CODE_OAUTH_TOKEN" style="width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);margin-bottom:8px">
    <details style="margin-bottom:8px"><summary style="cursor:pointer;color:var(--text-3);font-size:11.5px">Prefer an Anthropic API key? (billed per token)</summary>
      <input id="set-claude-key" type="password" placeholder="sk-ant-… (ANTHROPIC_API_KEY)" style="width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);margin-top:8px"></details>
    <div id="set-claude-stat" style="font-size:11.5px;color:var(--text-3)"></div>`;
  openModal('<i class="ti ti-robot-face" style="margin-right:7px"></i>Connect Claude', box, [
    { label:'Save & connect', primary:true, onClick: async (close) => {
      const stat = box.querySelector('#set-claude-stat');
      const values = { claudeCodeToken: box.querySelector('#set-claude-tok').value, anthropicKey: box.querySelector('#set-claude-key')?.value || '' };
      stat.style.color='var(--text-3)'; stat.textContent='Sealing…';
      try { const names = await setAiSecrets(t, sealToBase64, values);
        if (!names.length){ stat.textContent='Paste your Claude Code token (or an API key) first.'; return; }
        try { await ensureApplyEngine(DATA_REPO, t); } catch {}
        close(); flash('Saved ' + names.join(' + ') + ' to your data repo.'); openSettingsPage('ai');
      } catch(e){ stat.style.color='var(--warn)'; stat.textContent = isScopeError(e)?'Token lacks Secrets write on the data repo.':'Failed: '+e.message; }
    } },
  ]);
}
```

- [ ] **Step 3: Browser-verify (gate)**

Verify BOTH states: (off) Settings→AI shows only the understated card + "Turn on", and the left-nav "AI assistant" row is muted/last with no glyph, Agents hidden. Turn on → nav promotes "Claude / AI", Agents row appears, section shows status + Connect + Run. "Connect / manage Claude" opens the dialog (primary field + Advanced disclosure); Save with empty → inline prompt to paste; ESC closes. "Turn AI assistant off" returns to understated state. Console clean. `node --test` green. **AI-clean check:** `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` → nothing.

- [ ] **Step 4: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): Claude/AI section — status card + Connect dialog, understated when off

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Agents section (moved reviewAgents field; hidden when AI off)

Placeholder home for Project B; for now it holds the existing bare-name `reviewAgents` field so nothing is lost. Hidden when AI off (already enforced by `settingsSections`).

**Files:** Modify `js/app.js` — replace `renderSettingsAgents`.

- [ ] **Step 1: Implement `renderSettingsAgents`**

```js
// Agents section. B1 (the catalog) lands here later; for now it carries the existing comma-separated
// reviewAgents list so the current capability isn't lost. Only reachable when AI is on.
function renderSettingsAgents(pane, t) {
  const editable = !!(_projectId && _CFG.hubRepo);
  pane.innerHTML = `<div class="set-card">
    <h4>Review agents</h4>
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">Read-only critics that comment on your draft when you run agents. A richer catalog is coming; for now, comma-separated ids.</div>
    <div style="display:flex;gap:8px">
      <input id="set-agents" placeholder="e.g. rigor, clarity" value="${escapeHtml((_CFG.reviewAgents||[]).join(', '))}" ${editable?'':'disabled title="Set in this instance’s config"'} style="flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
      <button class="btn" id="set-agents-save" ${editable?'':'disabled'} style="padding:5px 12px">Save</button>
      <span id="set-agents-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
    </div></div>`;
  const save = pane.querySelector('#set-agents-save');
  if (save && editable) save.onclick = async () => {
    const stat = pane.querySelector('#set-agents-stat');
    const list = pane.querySelector('#set-agents').value.split(',').map(s => s.trim()).filter(Boolean);
    stat.style.color='var(--text-3)'; stat.textContent='Saving…';
    try { await writeProjectPatch(_CFG, _projectId, { reviewAgents: list }, t); _CFG = { ..._CFG, reviewAgents: list };
      stat.style.color='var(--success)'; stat.textContent = list.length?`Saved ${list.length} agent(s).`:'Cleared.';
      if (document.getElementById('btn-send')) renderTopbar();
    } catch(e){ stat.style.color='var(--warn)'; stat.textContent='Failed: '+e.message; }
  };
}
```

- [ ] **Step 2: Browser-verify (gate)**

With AI on: Settings→Agents shows the field prefilled from `_CFG.reviewAgents`; Save persists (reflected in the send-menu gate). With AI off: no Agents nav row. Console clean. `node --test` green.

- [ ] **Step 3: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): Agents section carries reviewAgents list (B1 fills it later)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Strip Settings from Reviewers page + reorganize leftovers (People / Access / Inbox)

**Files:** Modify `js/app.js` — `openReleasePanel` (~2603–2701). Remove the `<div class="rel-sec">…Settings…</div>` block through the notify row + `${aiSettingHtml()}` + email banner + notify handler wiring; delete `aiSettingHtml`, `wireAiSetup`, and the old `manageToken` if fully superseded (verify no other callers with `grep -an`). Regroup the remaining markup under three headers.

- [ ] **Step 1: Find all references before deleting**

Run: `grep -an "aiSettingHtml\|wireAiSetup\|manageToken\|notify-save\|adv-email-banner\|renderEmailBanner" js/app.js`. Only remove a function once its callers are all rerouted (Access/Email sections + ⋯ deep-links in Task 9). If `renderEmailBanner`/`openConnectForm`/`openTestSend` are still used by the Email dialog, keep them.

- [ ] **Step 2: Remove the Settings block from `openReleasePanel`**

Delete, in the `rel-body` template, from the `<div class="rel-sec" style="margin-top:34px…">…Settings…</div>` line through the closing of the notify row `</div>`; and remove `wireAiSetup(t)` + the `aiToggle` wiring + the notify-save handler from the function body. Leave roster/gating/links/inbox intact.

- [ ] **Step 3: Reorganize the remaining Reviewers markup into three labeled blocks**

Wrap the existing pieces under headers (markup only — no behavior change):
- **People** — the `.advadd` add-reviewer form + `#adv-list` + `#adv-stat`.
- **Access** — the "Which units each reviewer can see" `.rel-tbl` + release-responses row + `.rel-links`.
- **Inbox** — the "Comments received from reviewers" `.rel-sec` + `inboxHtml`.

Use the existing `<div class="rel-sec">` heading style for each. Keep every id/class the wiring depends on (`#rel-save`, `.rel-inbox`, `.rel-row`, `#adv-add`, etc.) unchanged.

- [ ] **Step 4: Browser-verify (gate)**

Reviewers page: no Settings/AI/email/notify content remains; the three blocks render with headers; add-reviewer, gating checkboxes + Save & publish, portal links, and the inbox (mark-read, open-in-context, send-unsent when AI on, clear-inbox) ALL still work. Settings content now lives only under the gear. Console clean. `node --test` green. `grep -a` confirms `aiSettingHtml`/`wireAiSetup` are gone (or intentionally kept).

- [ ] **Step 5: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "refactor(reviewers): move Settings to its own page; regroup into People/Access/Inbox

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `⋯` deep-links + remove inline token prompt

**Files:** Modify `js/app.js` — `openMoreMenu` (~2428–2451).

- [ ] **Step 1: Reroute the `⋯` items**

In `openMoreMenu`, change the `token` action from `manageToken` to `() => openSettingsPage('access')`, and the `assistant` action from the "open Reviewers then scrollIntoView" hack to `() => openSettingsPage('ai')`. Update the `token` menu row label to read "Access token — in Settings". Remove the now-unused `manageToken` definition if no other caller (verify with `grep -an "manageToken" js/app.js`).

- [ ] **Step 2: Browser-verify (gate)**

`⋯ → Access token` opens Settings on the Access section; `⋯ → AI assistant` opens Settings on the AI section. No `prompt()` dialog appears. Console clean. `node --test` green.

- [ ] **Step 3: Commit**

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git add -A && git commit -m "feat(settings): ⋯ menu deep-links into Settings; drop inline token prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Full verification pass (gate) + cache-bust

- [ ] **Step 1: Run the whole JS suite**

Run: `cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && node --test tests/*.test.mjs`
Expected: all green (incl. new `settings`/`modal` suites). Also run the Python suite if touched (it shouldn't be): `python3 -m pytest tests/ -q`.

- [ ] **Step 2: Full browser click-through (enumerated states)**

Serve `app.html`; verify each state from the spec's testing section: AI off; AI on/not-connected; AI on/connected; Connect Claude dialog (primary + Advanced); Email both rows; Connect email dialog per provider (Gmail/Outlook/Other) + manual disclosure; Access set/unset + source token; deep-link from `⋯` (access + ai); Reviewers People/Access/Inbox intact; back-to-document; theme light + dark; console clean throughout.

- [ ] **Step 3: Guardrail greps**

Run: `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` → expect NOTHING.
Run: `grep -an "mattlmccoy\|phd-dissertation\|DISS_TOKEN" js/app.js js/settings.js js/modal.js` → expect nothing new.

- [ ] **Step 4: Cache-bust + push**

Follow the repo's cache-bust convention (the bot bumps `?v=<sha>` on import lines; if there's a script for it, run it, else the bot handles it on merge). Then:

```bash
cd /Users/mattmccoy/code/put_github_repos_here/footnote-settings-wt && git push -u origin feat/settings-redesign
```

Do NOT push to `main`. Report what changed, tests run, and browser states verified; hand back for owner review + merge.

---

## Self-Review (completed at authoring)

- **Spec coverage:** nav gear (T3) ✓; left-nav C (T1/T3) ✓; Claude status+dialog B (T6) ✓; email two-row + provider-picker A+C (T5) ✓; Access + source token (T4) ✓; Agents moved + hidden-when-off (T1/T7) ✓; modal helper (T2/T3) ✓; ⋯ deep-links + no prompt Q1 (T9) ✓; AI understated Q2 (T1/T6) ✓; Reviewers reorg Q4 (T8) ✓; no-function-loss audit mapped across T4–T9 ✓.
- **Placeholder scan:** the only "TODO" strings are the deliberate temporary pane placeholders in T3, each replaced by a named later task. No vague steps.
- **Type consistency:** `settingsSections`/`resolveSection`/`modalReducer`/`topModal` signatures match across tasks; glyph domain is `'ok'|'warn'|null` everywhere; section ids `email|access|agents|ai` consistent in the model, renderer switch, and deep-links.
- **Known verify-before-delete points** (flagged in tasks, not assumed): exact stylesheet filename (T3.1); the notify-write field + `saveNotifyPrefs` extraction (T5.1); whether `openConnectForm`/`openTestSend`/`renderEmailBanner` stay (T5.2/T8.1); `manageToken` caller check (T9.1).

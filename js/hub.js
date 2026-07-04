// Footnote launcher — the multi-project homepage. Lists the owner's review projects from the hub repo's
// projects.json, lets them create a new one, and opens a project's reviewer. Serverless: all state is a
// projects.json in the owner's private hub repo, read/written with their token. The workspace (hub) repo
// can be set up entirely in the UI (stored as a localStorage override so nothing in the app repo is edited).
import { loadConfig, loadProjects, normalizeProject } from './config.js?v=1406ac8';
import { seedDataRepo } from './seed.js?v=1406ac8';
import { importFormat, sourceRepoSuggestion, dataRepoSuggestion, planNewProjectRepos, ensureRepo, commitSourceFile } from './importdoc.js?v=1406ac8';
import { parseLatexChapters } from './docparse.js?v=1406ac8';

// ---- pure helpers (unit-tested) ----

export function addProject(projects, entry) {
  const p = normalizeProject(entry);
  if ((projects || []).some(x => x.id === p.id)) throw new Error(`a project named that already exists (id "${p.id}")`);
  return [...(projects || []), p];
}
export function removeProject(projects, id) {
  return (projects || []).filter(p => p.id !== id);
}
export function updateProject(projects, id, patch) {
  return (projects || []).map(p => {
    if (p.id !== id) return p;
    const merged = { ...p, ...(patch || {}), id: p.id };   // id is stable — edits never change it
    if (patch && patch.doc) merged.doc = { ...(p.doc || {}), ...patch.doc };   // keep unitNoun etc.
    return normalizeProject(merged);
  });
}
export function projectHref(cfg, id) {
  return `${cfg.ownerPortalFile || 'owner.html'}?project=${encodeURIComponent(id)}`;
}
export function defaultHubRepo(cfg) { return `${cfg.owner}/footnote-projects`; }
export function projectIdFromName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
// Book-spine palette for the shelf — warm editorial hues that harmonize with the paper background.
// Each project gets a spine color by its position so the shelf reads like a row of different books.
export const SPINES = ['#2c64c4', '#b5643c', '#4a7c59', '#7a4b73', '#c08a2d', '#2f7d80', '#93313e'];
export function spineColor(i) { return SPINES[((i % SPINES.length) + SPINES.length) % SPINES.length]; }
// First name for the greeting: first word of the GitHub display name, else the login, else a generic.
export function greetName(user) {
  const u = user || {};
  const first = String(u.name || '').trim().split(/\s+/)[0];
  return first || u.login || 'there';
}
// First-run onboarding: which of the three setup steps the user is on (null once they have a project).
export const ONBOARD_STEPS = ['Connect', 'Workspace', 'First project'];
export function onboardingStep({ hasToken, hasHub, hasProjects } = {}) {
  if (hasProjects) return null;                       // onboarding complete
  const index = !hasToken ? 0 : !hasHub ? 1 : 2;
  return { index, total: ONBOARD_STEPS.length, label: ONBOARD_STEPS[index] };
}

// ---- I/O + DOM (browser only) ----

const API = 'https://api.github.com';
const HUB_KEY = 'footnote:hub';
const TOK_KEY = 'ghpat';
const hdr = t => ({ Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// repo + workflow: seeding a new project writes .github/workflows/*.yml (invite/notify/convert), which
// GitHub blocks without the workflow scope. (The email wizard requests the same scopes separately.)
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Footnote';

async function hubSha(hub, t) {
  try { const r = await fetch(`${API}/repos/${hub}/contents/projects.json?t=${Date.now()}`, { headers: hdr(t), cache: 'no-store' });
    return r.ok ? (await r.json()).sha : null; } catch { return null; }
}
async function writeProjects(hub, t, projects) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(projects, null, 2))));
  const r = await fetch(`${API}/repos/${hub}/contents/projects.json`, { method: 'PUT', headers: hdr(t),
    body: JSON.stringify({ message: `projects: ${projects.length} project(s)`, content, sha: (await hubSha(hub, t)) || undefined }) });
  if (!r.ok) throw new Error('couldn’t save to ' + hub + ' (' + r.status + ')');
}
async function createRepo(t, fullName) {
  const name = fullName.split('/').pop();
  const r = await fetch(`${API}/user/repos`, { method: 'POST', headers: hdr(t),
    body: JSON.stringify({ name, private: true, auto_init: true, description: 'Footnote projects registry' }) });
  if (r.status === 422) return;   // already exists — fine
  if (!r.ok) throw new Error('couldn’t create ' + fullName + ' (' + r.status + ') — check the token scope');
}

// The user's repos, so fields can be PICKED instead of typed. Cache is KEYED BY TOKEN so switching to a
// new (e.g. private-enabled) token always refetches. Records whether any private repo was visible.
let _repoCache = null;   // { token, names, priv, count, status, error }
async function userRepos(t) {
  if (_repoCache && _repoCache.token === t) return _repoCache;
  const out = []; let priv = 0, status = 0, error = '';
  try {
    // visibility=all + all affiliations so PRIVATE and org repos are included (given a token that can see them).
    for (let page = 1; page <= 6; page++) {
      const r = await fetch(`${API}/user/repos?per_page=100&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&page=${page}`, { headers: hdr(t), cache: 'no-store' });
      status = r.status;
      if (!r.ok) { error = 'HTTP ' + r.status; break; }
      const d = await r.json(); if (!Array.isArray(d)) { error = 'unexpected response'; break; }
      for (const x of d) if (x.private) priv++;
      out.push(...d.map(x => x.full_name));
      if (d.length < 100) break;
    }
  } catch (e) { error = (e && e.message) || 'network error'; }
  _repoCache = { token: t, names: out, priv, count: out.length, seenPrivate: priv > 0, status, error };
  return _repoCache;
}
// Attach a GitHub-repo autocomplete to a text input (still typeable). Suggestions from the user's repos.
function attachRepoPicker(input, t) {
  const menu = document.createElement('div'); menu.className = 'fn-ac';
  input.insertAdjacentElement('afterend', menu);
  let data = { names: [], priv: 0, count: 0, seenPrivate: true, status: 0, error: '' };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const m = data.names.filter(r => r.toLowerCase().includes(q)).slice(0, 8);
    // Live footer: shows the ACTUAL result so token/scope problems are visible, not silent.
    let foot;
    if (data.error) foot = `<div class="fn-ac-hint">Couldn't list your repos — <b>${esc(data.error)}</b>. The token may be wrong or lack access.</div>`;
    else if (data.priv === 0) foot = `<div class="fn-ac-hint">${data.count} repos found, <b>0 private</b>. Your token can't see private repos — <a href="${TOKEN_URL}" target="_blank" rel="noopener">make one with <code>repo</code> scope</a>, then Disconnect &amp; reconnect.</div>`;
    else foot = `<div class="fn-ac-diag">${data.count} repos · ${data.priv} private</div>`;
    menu.innerHTML = m.map(r => `<div class="fn-ac-item">${esc(r)}</div>`).join('') + foot;
    menu.style.display = 'block';
    [...menu.querySelectorAll('.fn-ac-item')].forEach((el, i) => el.onmousedown = e => { e.preventDefault(); input.value = m[i]; menu.style.display = 'none'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  input.addEventListener('focus', async () => { data = await userRepos(t); show(); });
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 200));
}

const MARK = accent => `<svg class="fn-mark" viewBox="0 0 52 52" aria-hidden="true"><rect x="3" y="3" width="46" height="46" rx="13" fill="${accent}"/><line x1="19" y1="13" x2="19" y2="39" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="39" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="39" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.7" fill="#fff"/></svg>`;

// Creator credit + contact — Footnote's own authorship (global product identity, not the adopter's data).
const IC_MAIL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>`;
const IC_GH = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const IC_ISSUE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/></svg>`;
const FOOTER = `<footer class="fn-foot">
  <span class="fn-cred">Footnote · Built by <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener">@mattlmccoy</a></span>
  <span class="fn-foot-links">
    <a href="mailto:mail@matthewmccoy.info" title="Email" aria-label="Email">${IC_MAIL}</a>
    <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub profile">${IC_GH}</a>
    <a href="https://github.com/mattlmccoy/footnote/issues" target="_blank" rel="noopener" title="Report an issue" aria-label="Report an issue">${IC_ISSUE}</a>
  </span>
</footer>`;

// First-run progress: the 3 setup steps with the current one highlighted (idx = 0-based current step).
const stepperHtml = idx => `<div class="fn-steps">${ONBOARD_STEPS
  .map((s, i) => `<span class="fn-stepx ${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}"><b>${i + 1}</b>${esc(s)}</span>`)
  .join('<i class="fn-stepsep">→</i>')}</div>`;

export async function launch() {
  const cfg = await loadConfig();
  const root = document.getElementById('app') || document.body;
  const tok = () => localStorage.getItem(TOK_KEY);
  const hub = () => localStorage.getItem(HUB_KEY) || cfg.hubRepo || '';
  document.documentElement.style.setProperty('--accent', cfg.brand.accent);

  // Derive the real GitHub username from the token so defaults aren't the "your-github-username"
  // placeholder, and grab the display name + avatar for the greeting. Runs at launch + after connect.
  let _ownerFetched = false;
  let _user = {};   // { login, name, avatar }
  async function refreshOwner() {
    const t = tok(); if (!t || _ownerFetched) return;
    try {
      const u = await (await fetch(`${API}/user`, { headers: hdr(t) })).json();
      if (u && u.login) { cfg.owner = u.login; _user = { login: u.login, name: u.name, avatar: u.avatar_url }; _ownerFetched = true; }
    } catch {}
  }
  await refreshOwner();

  function frame(inner, opts = {}) {
    const avatar = _user.avatar ? `<img class="fn-avatar" src="${esc(_user.avatar)}" alt="" referrerpolicy="no-referrer">` : '';
    const userbar = opts.signout ? `<div class="fn-userbar">
        ${avatar}<span class="fn-hi">Hi, ${esc(greetName(_user))}</span>
        <button class="fn-link" id="fn-signout">Disconnect</button>
      </div>` : '';
    root.innerHTML = `<div class="fn-shell">
      <header class="fn-top">
        <span class="fn-brand">${MARK(cfg.brand.accent)}<span class="fn-word">${esc(cfg.brand.name)}</span></span>
        ${userbar}
      </header>
      <main class="fn-main"><div class="fn-rule"></div>${inner}</main>
      ${FOOTER}
    </div>`;
    const so = document.getElementById('fn-signout');
    if (so) so.onclick = () => { localStorage.removeItem(TOK_KEY); render(); };
  }

  function connect() {
    frame(`<style>
      .fn-shell{max-width:1160px}
      .fn-split{display:grid;grid-template-columns:minmax(0,1fr) 520px;gap:54px;align-items:center;margin-top:8px}
      .fn-split .fn-lead{max-width:32em}
      .fn-vid{display:block;position:relative;width:520px;aspect-ratio:16/10;border-radius:16px;overflow:hidden;border:1px solid var(--line);box-shadow:0 34px 80px -26px rgba(20,24,48,.55);background:#0c0f1e;text-decoration:none}
      .fn-vid iframe{position:absolute;top:0;left:0;width:1300px;height:812px;border:0;transform:scale(.4);transform-origin:top left;pointer-events:none}
      .fn-vid-badge{position:absolute;left:13px;bottom:13px;z-index:2;display:inline-flex;align-items:center;gap:7px;background:rgba(12,15,30,.62);color:#fff;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:22px;backdrop-filter:blur(4px);transition:background .15s}
      .fn-vid:hover .fn-vid-badge{background:#2c64c4}
      .fn-vid-badge .pg{display:inline-flex;width:17px;height:17px;border-radius:50%;background:#fff;color:#2c64c4;align-items:center;justify-content:center;font-size:8px;padding-left:1px}
      @media(max-width:960px){ .fn-shell{max-width:880px} .fn-split{grid-template-columns:1fr} .fn-vid-col{display:none} }
    </style>
    <div class="fn-hero fn-reveal">
      ${stepperHtml(0)}
      <div class="fn-split">
        <div class="fn-split-l">
          <h1 class="fn-h1">Margin notes for<br><em>native-LaTeX</em> writing.</h1>
          <p class="fn-lead">A clean reading surface for your document, comments and suggested edits from your reviewers, and clean exports — running entirely on your GitHub. No server.</p>
          <div class="fn-card">
            <div class="fn-step">Connect GitHub</div>
            <label class="fn-field">Access token <span class="fn-sub">must include your <b>private</b> repos</span><input id="fn-tok" type="password" placeholder="ghp_… or github_pat_…" autocomplete="off"></label>
            <p class="fn-hint"><a href="${TOKEN_URL}" target="_blank" rel="noopener">Generate a token →</a> — the link pre-selects the <code>repo</code> + <code>workflow</code> scopes (full read/write, private included; workflow lets Footnote set up your background email/convert Actions). If you use a fine-grained token instead, set <b>Repository access → All repositories</b>. Stored only in this browser.</p>
            <div class="fn-err" id="fn-err"></div>
            <button class="fn-btn fn-btn-primary" id="fn-go">Connect</button>
          </div>
        </div>
        <div class="fn-vid-col">
          <a class="fn-vid" href="tutorials/walkthrough.html" title="Watch the full walkthrough">
            <iframe src="tutorials/walkthrough.html?embed=1" title="Footnote walkthrough" loading="lazy" scrolling="no" tabindex="-1"></iframe>
            <span class="fn-vid-badge"><span class="pg">▶</span>Watch the 90-second walkthrough</span>
          </a>
        </div>
      </div>
    </div>`);
    const go = async () => { const v = document.getElementById('fn-tok').value.trim();
      if (!v) { document.getElementById('fn-err').textContent = 'Paste your token to continue.'; return; }
      localStorage.setItem(TOK_KEY, v); _ownerFetched = false; await refreshOwner(); render(); };
    document.getElementById('fn-go').onclick = go;
    document.getElementById('fn-tok').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  function setupWorkspace() {
    frame(`<div class="fn-hero fn-reveal">
      ${stepperHtml(1)}
      <h1 class="fn-h1">Set up your <em>workspace</em>.</h1>
      <p class="fn-lead">This is just a small private repo that holds the <b>list</b> of your projects — <b>not</b> your document or its comments. You'll pick those next, one per project. Create it now, or choose one you already have.</p>
      <div class="fn-card">
        <div class="fn-step">Workspace repo</div>
        <label class="fn-field">Projects index <span class="fn-sub">a tiny private repo, e.g. footnote-projects</span><input id="fn-hub" value="${esc(defaultHubRepo(cfg))}" spellcheck="false"></label>
        <div class="fn-err" id="fn-err"></div>
        <div class="fn-actions">
          <button class="fn-btn fn-btn-primary" id="fn-create">Create it for me</button>
          <button class="fn-btn" id="fn-use">Use an existing repo</button>
        </div>
      </div></div>`, { signout: true });
    attachRepoPicker(document.getElementById('fn-hub'), tok());
    const val = () => document.getElementById('fn-hub').value.trim();
    const err = m => document.getElementById('fn-err').textContent = m;
    document.getElementById('fn-use').onclick = () => { if (!/^[\w.-]+\/[\w.-]+$/.test(val())) return err('Use owner/repo format.'); localStorage.setItem(HUB_KEY, val()); render(); };
    document.getElementById('fn-create').onclick = async () => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(val())) return err('Use owner/repo format.');
      const btn = document.getElementById('fn-create'); btn.disabled = true; err('Creating…');
      try { await createRepo(tok(), val()); localStorage.setItem(HUB_KEY, val()); render(); }
      catch (e) { err(e.message); btn.disabled = false; }
    };
  }

  async function projects() {
    frame(`<div class="fn-loading fn-reveal">Loading your library…</div>`, { signout: true });
    let list = [];
    try { list = await loadProjects({ ...cfg, hubRepo: hub() }, tok()); } catch {}
    // Each project is a face-out book standing on the shelf; its spine color comes from its position.
    const books = list.map((p, i) => `<a class="fn-book fn-reveal" style="--i:${i};--spine:${spineColor(i)}" href="${projectHref(cfg, p.id)}">
        <span class="fn-book-spine"></span>
        <button class="fn-book-manage" data-mid="${esc(p.id)}" title="Manage project" aria-label="Manage ${esc(p.name)}">⋯</button>
        <span class="fn-book-type">${esc(p.doc.noun)}</span>
        <span class="fn-book-title">${esc(p.name)}</span>
        <span class="fn-book-repo">${esc(p.dataRepo)}</span>
        <span class="fn-book-go">Open →</span></a>`).join('');
    // "Add a book" tile stands at the end of the shelf, same footprint as the books.
    const addTile = `<button class="fn-book fn-book-new fn-reveal" style="--i:${list.length}" id="fn-new">
        <span class="fn-book-plus">＋</span><span class="fn-book-newlabel">New project</span></button>`;
    frame(`<div class="fn-head fn-reveal"><span class="fn-eyebrow">Your library</span><h1 class="fn-h1">Documents in review</h1></div>
      ${list.length
        ? `<div class="fn-shelf">${books}${addTile}</div><div class="fn-shelf-board"></div>`
        : `${stepperHtml(2)}<div class="fn-empty fn-reveal"><div class="fn-empty-mark">${MARK(cfg.brand.accent)}</div>
             <h2 class="fn-empty-h">Your shelf is empty</h2>
             <p class="fn-empty-p">Point Footnote at a LaTeX or Word document and invite your reviewers. It becomes the first book on your shelf.</p>
             <button class="fn-btn fn-btn-primary" id="fn-new2">Add your first document</button></div>`}
      <div class="fn-ws">Workspace <span class="fn-mono">${esc(hub())}</span> · <button class="fn-link" id="fn-chg">change</button></div>`, { signout: true });
    const open = () => projectSheet(list, null);
    ['fn-new', 'fn-new2'].forEach(id => { const b = document.getElementById(id); if (b) b.onclick = open; });
    document.getElementById('fn-chg').onclick = () => { localStorage.removeItem(HUB_KEY); render(); };
    // per-book manage menu (Edit / Remove). The ⋯ button must not open the project.
    list.forEach(p => {
      const mb = root.querySelector(`.fn-book-manage[data-mid="${cssId(p.id)}"]`);
      if (mb) mb.onclick = e => { e.preventDefault(); e.stopPropagation(); openManageMenu(mb, p, list); };
    });
  }

  function cssId(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  function closeManageMenu() { const m = document.getElementById('fn-menu'); if (m) m.remove(); }
  function openManageMenu(anchor, project, list) {
    closeManageMenu();
    const menu = document.createElement('div'); menu.className = 'fn-menu'; menu.id = 'fn-menu';
    menu.innerHTML = `<button class="fn-menu-item" data-act="edit">Edit details</button>
      <button class="fn-menu-item fn-menu-danger" data-act="remove">Remove from library</button>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.querySelector('[data-act="edit"]').onclick = () => { closeManageMenu(); projectSheet(list, project); };
    menu.querySelector('[data-act="remove"]').onclick = () => { closeManageMenu(); confirmRemove(list, project); };
  }

  // One sheet for both New (existing=null) and Edit. On edit the comments repo is read-only (it's the
  // project's identity + holds all existing comments) and no repo is created/seeded — only projects.json changes.
  function projectSheet(list, existing) {
    if (existing) return editProjectSheet(list, existing);
    return newProjectSheet(list);
  }

  // Edit: rename, repoint the source repo, change the noun. Never creates/seeds repos; the comments repo
  // is the project's identity and stays fixed.
  function editProjectSheet(list, v) {
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">Edit project</div>
      <label class="fn-field">Project name<input id="np-name" placeholder="My Thesis" spellcheck="false" value="${esc(v.name)}"></label>
      <label class="fn-field">Your document's source repo <span class="fn-sub">the LaTeX you're reviewing (a GitHub repo, Overleaf-synced or not). Read-only; never edited here.</span><input id="np-src" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false" value="${esc(v.sourceRepo || '')}"></label>
      <label class="fn-field">Comments repo <span class="fn-sub">where this project’s comments live — fixed once created</span><input id="np-data" value="${esc(v.dataRepo || '')}" disabled></label>
      <label class="fn-field">What is it? <span class="fn-sub">the word for the whole document</span><input id="np-noun" value="${esc((v.doc && v.doc.noun) || 'thesis')}" spellcheck="false"></label>
      <div class="fn-err" id="np-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="np-x">Cancel</button><button class="fn-btn fn-btn-primary" id="np-save">Save changes</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    attachRepoPicker(q('#np-src'), tok());
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-x').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), noun = q('#np-noun').value.trim() || 'document', sourceRepo = q('#np-src').value.trim();
      if (!name) return q('#np-err').textContent = 'Name is required.';
      try {
        q('#np-save').disabled = true; q('#np-err').textContent = 'Saving…';
        await writeProjects(hub(), tok(), updateProject(list, v.id, { name, sourceRepo, doc: { noun } }));
        close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
    setTimeout(() => q('#np-name').focus(), 30);
  }

  // New project onboarding, organized around "Where's your writing?" so a beginner with a local file never
  // has to know what a repo is. Both repos are auto-named from the project name; power users override under
  // Advanced. mode='local' uploads a .tex (Footnote creates the repo + commits it); 'github'/'overleaf'
  // point at an existing repo.
  function newProjectSheet(list) {
    let mode = 'local', pendingTex = null, srcDirty = false, dataDirty = false;
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">New project</div>
      <label class="fn-field">Project name<input id="np-name" placeholder="My Thesis" spellcheck="false"></label>
      <div class="fn-field-lbl">Where's your writing?</div>
      <div class="fn-seg" id="np-modes">
        <button type="button" class="fn-seg-b on" data-mode="local">On my computer</button>
        <button type="button" class="fn-seg-b" data-mode="github">In a GitHub repo</button>
        <button type="button" class="fn-seg-b" data-mode="overleaf">In Overleaf</button>
      </div>
      <div id="np-panel"></div>
      <label class="fn-field">What is it? <span class="fn-sub">the word for the whole document</span><input id="np-noun" value="thesis" spellcheck="false"></label>
      <details class="fn-adv"><summary>Advanced — repo names</summary>
        <label class="fn-field">Source repo <span class="fn-sub">where your LaTeX lives / will be created</span><input id="np-src" spellcheck="false"></label>
        <label class="fn-field">Comments repo <span class="fn-sub">a private repo Footnote creates for comments + the reading view — not your document</span><input id="np-data" spellcheck="false"></label>
      </details>
      <div class="fn-err" id="np-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="np-x">Cancel</button><button class="fn-btn fn-btn-primary" id="np-save">Create project</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    // Keep the auto-named repo fields in sync with the project name until the user edits them by hand.
    const syncNames = () => {
      const name = q('#np-name').value.trim();
      if (!srcDirty && mode === 'local') q('#np-src').value = sourceRepoSuggestion(name || 'project', cfg.owner);
      if (!dataDirty) q('#np-data').value = dataRepoSuggestion(name || 'project', cfg.owner);
    };
    const renderPanel = () => {
      const p = q('#np-panel');
      if (mode === 'local') {
        p.innerHTML = `<label class="fn-drop"><i class="ti ti-upload"></i> <span id="np-tex-name">Choose your .tex file</span><input id="np-tex" type="file" accept=".tex" style="display:none"></label>
          <div class="fn-hint">Footnote creates a private repo for it and commits it as <code>main.tex</code>. <code>.docx</code> support is coming.</div>`;
        q('#np-tex').onchange = async e => {
          const f = e.target.files[0]; if (!f) return;
          if (importFormat(f.name) !== 'tex') { q('#np-err').textContent = 'Please choose a .tex file (.docx is coming soon).'; return; }
          pendingTex = { name: f.name, text: await f.text() }; q('#np-tex-name').textContent = f.name; q('#np-err').textContent = '';
        };
      } else {
        pendingTex = null;
        const overleaf = mode === 'overleaf';
        p.innerHTML = `${overleaf ? `<div class="fn-hint">In Overleaf: <b>Menu → GitHub → Sync</b> to a new repo, then pick it here.</div>` : ''}
          <label class="fn-field">${overleaf ? 'Your synced GitHub repo' : 'Pick the repo with your LaTeX'}<input id="np-pick" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false"></label>
          <div class="fn-hint">Already on GitHub? Point Footnote at it — read-only, never edited.</div>`;
        const pick = q('#np-pick'); attachRepoPicker(pick, tok());
        pick.addEventListener('input', () => { srcDirty = true; q('#np-src').value = pick.value.trim(); });
      }
      syncNames();
    };
    q('#np-modes').querySelectorAll('.fn-seg-b').forEach(b => b.onclick = () => {
      if (mode === b.dataset.mode) return;
      mode = b.dataset.mode;
      if (mode !== 'local') srcDirty = false;   // a picked repo re-marks dirty; auto-name resumes for local
      q('#np-modes').querySelectorAll('.fn-seg-b').forEach(x => x.classList.toggle('on', x === b));
      renderPanel();
    });
    q('#np-name').addEventListener('input', syncNames);
    q('#np-src').addEventListener('input', () => { srcDirty = true; });
    q('#np-data').addEventListener('input', () => { dataDirty = true; });
    attachRepoPicker(q('#np-src'), tok());
    syncNames(); renderPanel();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-x').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), noun = q('#np-noun').value.trim() || 'document';
      if (!name) return q('#np-err').textContent = 'Give your project a name.';
      const { sourceRepo, dataRepo } = planNewProjectRepos({ mode, name, owner: cfg.owner, sourceOverride: q('#np-src').value, dataOverride: q('#np-data').value });
      if (mode === 'local' && !pendingTex) return q('#np-err').textContent = 'Choose your .tex file to upload.';
      if (mode !== 'local' && !sourceRepo) return q('#np-err').textContent = 'Pick the repo where your LaTeX lives.';
      try {
        const next = addProject(list, { id: projectIdFromName(name), name, dataRepo, sourceRepo, doc: { noun, unitNoun: 'chapter' } });
        q('#np-save').disabled = true;
        let chapters = null;
        if (pendingTex) {   // local upload: create the source repo, commit the LaTeX, parse its chapters
          q('#np-err').textContent = `Creating ${sourceRepo}…`;
          await ensureRepo(tok(), sourceRepo);
          q('#np-err').textContent = 'Committing main.tex…';
          await commitSourceFile(sourceRepo, 'main.tex', pendingTex.text, tok(), 'Footnote import: main.tex');
          chapters = parseLatexChapters(pendingTex.text, () => null);
        }
        q('#np-err').textContent = 'Creating the comments repo…';
        await createRepo(tok(), dataRepo);   // create the private data repo if it doesn't exist (422 = already there)
        q('#np-err').textContent = 'Setting up background email/notify…';
        try { await seedDataRepo(dataRepo, tok()); } catch (e) { console.warn('seed:', e.message); }   // non-fatal; can re-run later
        if (chapters && chapters.length) {   // seed chapters.json so the project opens ready, not empty
          q('#np-err').textContent = `Saving ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}…`;
          try { await commitSourceFile(dataRepo, 'chapters.json', JSON.stringify(chapters, null, 2), tok(), `import: ${chapters.length} chapters from main.tex`); }
          catch (e) { console.warn('chapters:', e.message); }
        }
        q('#np-err').textContent = 'Saving…';
        await writeProjects(hub(), tok(), next); close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
    setTimeout(() => q('#np-name').focus(), 30);
  }

  // Remove = unregister only. It never deletes the comments repo or the document on GitHub — the confirm
  // dialog says so and names the repo, so a click can't silently destroy a reviewer's work.
  function confirmRemove(list, project) {
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">Remove “${esc(project.name)}”?</div>
      <p class="fn-remove-note">This only takes it off your shelf here. Your comments repo <span class="fn-mono">${esc(project.dataRepo)}</span> and your document stay on GitHub — nothing is deleted, and you can add it back anytime. To delete the repo itself, do that from GitHub.</p>
      <div class="fn-err" id="rm-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="rm-x">Cancel</button><button class="fn-btn fn-btn-danger" id="rm-go">Remove from library</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#rm-x').onclick = close;
    q('#rm-go').onclick = async () => {
      q('#rm-go').disabled = true; q('#rm-err').textContent = 'Removing…';
      try { await writeProjects(hub(), tok(), removeProject(list, project.id)); close(); render(); }
      catch (e) { q('#rm-err').textContent = e.message; q('#rm-go').disabled = false; }
    };
  }

  // Close the manage menu on any outside click or Escape (added once for the launcher's lifetime).
  document.addEventListener('click', e => {
    if (!e.target.closest('#fn-menu') && !e.target.closest('.fn-book-manage')) closeManageMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeManageMenu(); });

  function render() { if (!tok()) return connect(); if (!hub()) return setupWorkspace(); projects(); }
  render();
}

// Footnote launcher — the multi-project homepage. Lists the owner's review projects from the hub repo's
// projects.json, lets them create a new one, and opens a project's reviewer. Serverless: all state is a
// projects.json in the owner's private hub repo, read/written with their token. The workspace (hub) repo
// can be set up entirely in the UI (stored as a localStorage override so nothing in the app repo is edited).
import { loadConfig, loadProjects, normalizeProject } from './config.js?v=c55a5ba';

// ---- pure helpers (unit-tested) ----

export function addProject(projects, entry) {
  const p = normalizeProject(entry);
  if ((projects || []).some(x => x.id === p.id)) throw new Error(`a project named that already exists (id "${p.id}")`);
  return [...(projects || []), p];
}
export function projectHref(cfg, id) {
  return `${cfg.ownerPortalFile || 'owner.html'}?project=${encodeURIComponent(id)}`;
}
export function defaultHubRepo(cfg) { return `${cfg.owner}/footnote-projects`; }
export function projectIdFromName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

// ---- I/O + DOM (browser only) ----

const API = 'https://api.github.com';
const HUB_KEY = 'footnote:hub';
const TOK_KEY = 'ghpat';
const hdr = t => ({ Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Footnote';

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

// The user's repos (full names), so fields can be PICKED instead of typed. Cached; paginates a few pages.
let _repoCache = null;
async function userRepos(t) {
  if (_repoCache) return _repoCache;
  const out = [];
  try {
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`${API}/user/repos?per_page=100&sort=updated&page=${page}`, { headers: hdr(t), cache: 'no-store' });
      if (!r.ok) break;
      const d = await r.json(); out.push(...d.map(x => x.full_name));
      if (d.length < 100) break;
    }
  } catch {}
  _repoCache = out; return out;
}
// Attach a GitHub-repo autocomplete to a text input (still typeable). Suggestions from the user's repos.
function attachRepoPicker(input, t) {
  const menu = document.createElement('div'); menu.className = 'fn-ac';
  input.insertAdjacentElement('afterend', menu);
  let repos = [];
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const m = repos.filter(r => r.toLowerCase().includes(q)).slice(0, 8);
    menu.innerHTML = m.map(r => `<div class="fn-ac-item">${esc(r)}</div>`).join('');
    menu.style.display = m.length ? 'block' : 'none';
    [...menu.children].forEach((el, i) => el.onmousedown = e => { e.preventDefault(); input.value = m[i]; menu.style.display = 'none'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  input.addEventListener('focus', async () => { if (!repos.length) repos = await userRepos(t); show(); });
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 160));
}

const MARK = accent => `<svg class="fn-mark" viewBox="0 0 52 52" aria-hidden="true"><rect x="3" y="3" width="46" height="46" rx="13" fill="${accent}"/><line x1="19" y1="13" x2="19" y2="39" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="39" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="39" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.7" fill="#fff"/></svg>`;

export async function launch() {
  const cfg = await loadConfig();
  const root = document.getElementById('app') || document.body;
  const tok = () => localStorage.getItem(TOK_KEY);
  const hub = () => localStorage.getItem(HUB_KEY) || cfg.hubRepo || '';
  document.documentElement.style.setProperty('--accent', cfg.brand.accent);

  function frame(inner, opts = {}) {
    root.innerHTML = `<div class="fn-shell">
      <header class="fn-top">
        <span class="fn-brand">${MARK(cfg.brand.accent)}<span class="fn-word">${esc(cfg.brand.name)}</span></span>
        ${opts.signout ? `<button class="fn-link" id="fn-signout">Disconnect</button>` : ''}
      </header>
      <div class="fn-rule"></div>
      <main class="fn-main">${inner}</main>
      <footer class="fn-foot"><sup>1</sup> Review native-LaTeX &amp; Word writing — entirely in your GitHub.</footer>
    </div>`;
    const so = document.getElementById('fn-signout');
    if (so) so.onclick = () => { localStorage.removeItem(TOK_KEY); render(); };
  }

  function connect() {
    frame(`<div class="fn-hero fn-reveal">
      <h1 class="fn-h1">Margin notes for<br><em>native-LaTeX</em> writing.</h1>
      <p class="fn-lead">A clean reading surface for your document, comments and suggested edits from your reviewers, and clean exports — running entirely on your GitHub. No server.</p>
      <div class="fn-card">
        <div class="fn-step">Connect GitHub</div>
        <label class="fn-field">Access token<input id="fn-tok" type="password" placeholder="github_pat_…" autocomplete="off"></label>
        <p class="fn-hint">Stored only in this browser. <a href="${TOKEN_URL}" target="_blank" rel="noopener">Generate one →</a></p>
        <div class="fn-err" id="fn-err"></div>
        <button class="fn-btn fn-btn-primary" id="fn-go">Connect</button>
      </div></div>`);
    const go = () => { const v = document.getElementById('fn-tok').value.trim();
      if (!v) { document.getElementById('fn-err').textContent = 'Paste your token to continue.'; return; }
      localStorage.setItem(TOK_KEY, v); render(); };
    document.getElementById('fn-go').onclick = go;
    document.getElementById('fn-tok').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  function setupWorkspace() {
    frame(`<div class="fn-hero fn-reveal">
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
    frame(`<div class="fn-loading fn-reveal">Loading your projects…</div>`, { signout: true });
    let list = [];
    try { list = await loadProjects({ ...cfg, hubRepo: hub() }, tok()); } catch {}
    const cards = list.map((p, i) => `<a class="fn-proj fn-reveal" style="--i:${i}" href="${projectHref(cfg, p.id)}">
        <span class="fn-proj-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="fn-proj-name">${esc(p.name)}</span>
        <span class="fn-proj-meta">${esc(p.doc.noun)}<span class="fn-dot">·</span><span class="fn-mono">${esc(p.dataRepo)}</span></span>
        <span class="fn-proj-go">Open →</span></a>`).join('');
    frame(`<div class="fn-head fn-reveal"><h1 class="fn-h1">Your projects</h1><button class="fn-btn fn-btn-primary" id="fn-new">＋ New project</button></div>
      ${list.length ? `<div class="fn-grid">${cards}</div>`
        : `<div class="fn-empty fn-reveal"><div class="fn-empty-mark">${MARK(cfg.brand.accent)}</div>
             <h2 class="fn-empty-h">Start your first project</h2>
             <p class="fn-empty-p">Point Footnote at a LaTeX or Word document and invite your reviewers.</p>
             <button class="fn-btn fn-btn-primary" id="fn-new2">Start a project</button></div>`}
      <div class="fn-ws">Workspace <span class="fn-mono">${esc(hub())}</span> · <button class="fn-link" id="fn-chg">change</button></div>`, { signout: true });
    const open = () => newProject(list);
    ['fn-new', 'fn-new2'].forEach(id => { const b = document.getElementById(id); if (b) b.onclick = open; });
    document.getElementById('fn-chg').onclick = () => { localStorage.removeItem(HUB_KEY); render(); };
  }

  function newProject(list) {
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">New project</div>
      <label class="fn-field">Project name<input id="np-name" placeholder="My Thesis" spellcheck="false"></label>
      <label class="fn-field">Your document's source repo <span class="fn-sub">the LaTeX you're reviewing — e.g. your dissertation repo (Overleaf-synced or local). Read-only; never edited here.</span><input id="np-src" placeholder="${esc(cfg.owner)}/phd-dissertation" spellcheck="false"></label>
      <label class="fn-field">New comments repo <span class="fn-sub">a separate private repo Footnote writes comments + the reading view into — NOT your document</span><input id="np-data" placeholder="${esc(cfg.owner)}/my-review-data" spellcheck="false"></label>
      <label class="fn-field">What is it? <span class="fn-sub">the word for the whole document</span><input id="np-noun" value="thesis" spellcheck="false"></label>
      <div class="fn-err" id="np-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="np-x">Cancel</button><button class="fn-btn fn-btn-primary" id="np-save">Create project</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    attachRepoPicker(q('#np-src'), tok()); attachRepoPicker(q('#np-data'), tok());
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-x').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), dataRepo = q('#np-data').value.trim();
      if (!name || !dataRepo) return q('#np-err').textContent = 'Name and data repo are required.';
      try {
        const next = addProject(list, { id: projectIdFromName(name), name, dataRepo, sourceRepo: q('#np-src').value.trim(), doc: { noun: q('#np-noun').value.trim() || 'document', unitNoun: 'chapter' } });
        q('#np-save').disabled = true; q('#np-err').textContent = 'Saving…';
        await writeProjects(hub(), tok(), next); close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
    setTimeout(() => q('#np-name').focus(), 30);
  }

  function render() { if (!tok()) return connect(); if (!hub()) return setupWorkspace(); projects(); }
  render();
}

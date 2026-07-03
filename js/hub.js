// Footnote launcher — the multi-project homepage. Lists the owner's review projects from the hub repo's
// projects.json, lets them create a new one, and opens a project's reviewer. Serverless: all state is a
// projects.json in the owner's private hub repo, read/written with their token.
import { loadConfig, loadProjects, normalizeProject, storageKey } from './config.js';

// ---- pure helpers (unit-tested) ----

// Append a validated project; reject duplicate ids.
export function addProject(projects, entry) {
  const p = normalizeProject(entry);
  if ((projects || []).some(x => x.id === p.id)) throw new Error(`a project with id "${p.id}" already exists`);
  return [...(projects || []), p];
}

// URL that opens the reviewer for a project.
export function projectHref(cfg, id) {
  return `${cfg.ownerPortalFile || 'owner.html'}?project=${encodeURIComponent(id)}`;
}

// ---- I/O + DOM (browser only) ----

const API = 'https://api.github.com';
const hdr = t => ({ Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' });

async function hubSha(cfg, t) {
  try {
    const r = await fetch(`${API}/repos/${cfg.hubRepo}/contents/projects.json?t=${Date.now()}`, { headers: hdr(t), cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).sha;
  } catch { return null; }
}

// Write projects.json back to the hub repo.
async function writeProjects(cfg, t, projects) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(projects, null, 2))));
  const sha = await hubSha(cfg, t);
  const r = await fetch(`${API}/repos/${cfg.hubRepo}/contents/projects.json`, {
    method: 'PUT', headers: hdr(t),
    body: JSON.stringify({ message: `projects: ${projects.length} project(s)`, content, sha: sha || undefined }) });
  if (!r.ok) throw new Error('save failed: ' + r.status);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tokKey = cfg => storageKey(cfg, 'ghpat');

export async function launch() {
  const cfg = await loadConfig();
  const root = document.getElementById('app') || document.body;
  const tok = () => localStorage.getItem('ghpat');   // shared with the reviewer (same origin)
  const brandMark = `<span style="display:inline-flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 52 52"><rect x="3" y="3" width="46" height="46" rx="12" fill="${cfg.brand.accent}"/><line x1="19" y1="14" x2="19" y2="38" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="38" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="38" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.6" fill="#fff"/></svg><strong style="font-size:17px">${esc(cfg.brand.name)}</strong></span>`;

  async function render() {
    const t = tok();
    if (!cfg.hubRepo) { root.innerHTML = shell(brandMark, `<div class="hub-empty">Set <code>hubRepo</code> in footnote.config.json to your projects registry repo (e.g. <code>${esc(cfg.owner)}/footnote-projects</code>), then reload.</div>`); return; }
    if (!t) { root.innerHTML = shell(brandMark, `<div class="hub-empty"><div style="font-size:15px;font-weight:600;margin-bottom:8px">Connect your GitHub</div><div style="color:#605e58;font-size:13px;margin-bottom:14px">Footnote reads your projects from <code>${esc(cfg.hubRepo)}</code>.</div><button class="hub-btn" id="hub-tok">Add access token</button></div>`);
      document.getElementById('hub-tok').onclick = () => { const v = prompt('Fine-grained GitHub token with access to your hub + data repos:'); if (v) { localStorage.setItem('ghpat', v.trim()); render(); } };
      return; }
    root.innerHTML = shell(brandMark, `<div class="hub-loading">Loading projects…</div>`);
    let projects = [];
    try { projects = await loadProjects(cfg, t); } catch {}
    const cards = projects.map(p => `<a class="hub-card" href="${projectHref(cfg, p.id)}">
        <div class="hub-card-name">${esc(p.name)}</div>
        <div class="hub-card-meta">${esc(p.doc.noun)} · ${esc(p.dataRepo)}</div></a>`).join('');
    root.innerHTML = shell(brandMark, `
      <div class="hub-head"><div class="hub-title">Your projects</div><button class="hub-btn" id="hub-new">+ New project</button></div>
      ${projects.length ? `<div class="hub-grid">${cards}</div>` : `<div class="hub-empty">No projects yet. Create one to start reviewing a document.</div>`}`);
    document.getElementById('hub-new').onclick = () => newProjectForm(projects);
  }

  function newProjectForm(projects) {
    const scrim = document.createElement('div'); scrim.className = 'hub-scrim';
    scrim.innerHTML = `<div class="hub-sheet">
      <div style="font-size:16px;font-weight:600;margin-bottom:12px">New project</div>
      <label class="hub-lab">Name<input id="np-name" placeholder="My Thesis"></label>
      <label class="hub-lab">Data repo (private, for comments)<input id="np-data" placeholder="${esc(cfg.owner)}/my-review-data"></label>
      <label class="hub-lab">LaTeX source repo (optional, Overleaf-synced or your own)<input id="np-src" placeholder="${esc(cfg.owner)}/my-thesis"></label>
      <label class="hub-lab">Document word<input id="np-noun" value="document"></label>
      <div id="np-err" style="color:#c0392b;font-size:12px;min-height:15px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="hub-btn" id="np-cancel">Cancel</button><button class="hub-btn hub-primary" id="np-save">Create</button></div></div>`;
    document.body.appendChild(scrim);
    const q = s => scrim.querySelector(s);
    const close = () => scrim.remove();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-cancel').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), dataRepo = q('#np-data').value.trim();
      if (!name || !dataRepo) { q('#np-err').textContent = 'Name and data repo are required.'; return; }
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      try {
        const next = addProject(projects, { id, name, dataRepo, sourceRepo: q('#np-src').value.trim(), doc: { noun: q('#np-noun').value.trim() || 'document', unitNoun: 'chapter' } });
        q('#np-save').disabled = true; q('#np-err').textContent = 'Saving…';
        await writeProjects(cfg, tok(), next);
        close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
  }

  render();
}

function shell(brand, inner) {
  return `<div class="hub-wrap"><header class="hub-topbar">${brand}</header><main class="hub-main">${inner}</main></div>`;
}

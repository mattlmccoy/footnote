// Agent catalog — the CLIENT view of the shipped agent catalog (B2). Renders the owner-facing catalog
// shown in AI Settings ONLY when the assistant is enabled. Pure helpers are unit-tested; the fetch has
// an injectable fetchImpl. This surface is owner-only and gated on assistantOn(); advisor.js never
// imports it (the reviewer surface stays AI-free).

import { dataRepoParts } from './config.js?v=76806e7';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Turn a raw catalog (from agents.json) + the currently-selected reviewAgents into display rows.
// `on` = this agent is in the selected set; `local` = it runs via the local runner (execution:"local").
// Pure: entries without an id are dropped; input not mutated.
export function agentCatalogView(catalog, reviewAgents) {
  const sel = new Set(reviewAgents || []);
  return (catalog || []).filter(a => a && a.id).map(a => ({
    id: a.id,
    displayName: a.displayName || a.id,
    description: a.description || '',
    category: a.category || 'critic',
    defaultOn: !!a.defaultOn,
    local: a.execution === 'local',
    on: sel.has(a.id),
  }));
}

// Render the catalog as a list of selectable cards. `editable` false → checkboxes disabled (a non-hub
// instance whose agents are fixed in config). Self-contained + escaped so it is unit-testable.
export function agentCatalogHtml(rows, { editable = false } = {}) {
  if (!rows || !rows.length) {
    return '<div style="font-size:11.5px;color:var(--text-3);padding:4px 0">No agents in the catalog yet.</div>';
  }
  const cards = rows.map(r => {
    const badge = (label, color) =>
      `<span style="font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;padding:1px 5px;border-radius:4px;background:${color};color:#fff;margin-left:6px">${label}</span>`;
    const cat = r.category === 'doer'
      ? badge('doer', 'var(--text-3)') : badge('critic', 'var(--accent, #2c64c4)');
    const local = r.local ? badge('local', '#8a6d3b') : '';
    return `<label class="ai-agent-card" style="display:flex;gap:9px;align-items:flex-start;padding:8px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);cursor:${editable ? 'pointer' : 'default'}">
      <input type="checkbox" data-agent="${esc(r.id)}"${r.on ? ' checked' : ''}${editable ? '' : ' disabled'} style="margin-top:2px">
      <span style="flex:1;min-width:0">
        <span style="font-weight:600;font-size:12px">${esc(r.displayName)}</span>${cat}${local}
        <span style="display:block;font-size:11px;color:var(--text-3);margin-top:2px">${esc(r.description)}</span>
      </span></label>`;
  }).join('');
  return `<div style="display:grid;gap:6px">${cards}</div>`;
}

// Fetch the agent catalog for the current instance: the data repo's OWN agents.json first (repo-level;
// includes any user-authored overlay agents), falling back to the app's shipped ./data-template/agents.json
// (the builtin mirror) when there is no token or the repo has none yet. Returns [] on total failure.
// fetchImpl + base are injectable for tests.
export async function loadAgentCatalog(token, cfg, fetchImpl, base) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return [];
  const asArray = (data) => (Array.isArray(data) ? data : (data && data.agents) || []);
  if (token && cfg && cfg.dataRepo) {
    try {
      const { owner, repo } = dataRepoParts(cfg);
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/agents.json?t=${Date.now()}`;
      const res = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (res && res.ok) {
        const d = await res.json();
        if (typeof d.content === 'string') {
          const arr = asArray(JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, ''))))));
          if (arr.length) return arr;
        }
      }
    } catch { /* fall through to the shipped mirror */ }
  }
  try {
    const root = base || (typeof location !== 'undefined' ? location.pathname.replace(/[^/]*$/, '') : './');
    const res = await f(`${root}data-template/agents.json`);
    if (res && res.ok) return asArray(await res.json());
  } catch { /* nothing available */ }
  return [];
}

// ---- B4: user-authored agents (client helpers) ----

// Split the catalog into active (selectable/runnable) and drafts (authored, awaiting the owner's
// review). A missing status counts as active, so builtins + existing overlay stay in `active`.
export function partitionCatalog(catalog) {
  const active = [], drafts = [];
  for (const a of (catalog || [])) {
    if (!a) continue;
    (a.status === 'draft' ? drafts : active).push(a);
  }
  return { active, drafts };
}

// The author-agent job payload from the owner's form (name + brief + optional hints). The caller adds
// the queue id/timestamp, like every other job. Pure.
export function buildAuthorJob(name, brief, hints = {}) {
  const job = { type: 'author-agent', name: String(name || '').trim(), brief: String(brief || '').trim() };
  if (hints.cwd) job.cwd = hints.cwd;
  if (hints.wantsTools) job.wantsTools = true;
  return job;
}

// Approve a draft → status:active (only an authored, non-builtin entry). Returns a new list. Pure.
export function approveAuthored(list, id) {
  return (list || []).map(a => (a && a.id === id && a.builtin !== true) ? { ...a, status: 'active' } : a);
}

// Delete an authored entry (never a builtin). Returns a new list. Pure.
export function deleteAuthored(list, id) {
  return (list || []).filter(a => !(a && a.id === id && a.builtin !== true));
}

// Merge a patch into an authored entry; id and builtin:false are never overridable via edit. Pure.
export function editAuthored(list, id, patch) {
  return (list || []).map(a => (a && a.id === id && a.builtin !== true)
    ? { ...a, ...(patch || {}), id: a.id, builtin: false } : a);
}

// Read-modify-write the data repo's agents.json: GET (content + sha), apply transformFn to the entry
// list, PUT it back. Mirrors writeProjectPatch; fetchImpl injectable. Returns the written list.
export async function writeAgentsJson(cfg, token, transformFn, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('no fetch available to write agents.json');
  const { owner, repo } = dataRepoParts(cfg);
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/agents.json`;
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let list = [], sha;
  const res = await f(`${base}?t=${Date.now()}`, { headers: h, cache: 'no-store' });
  if (res && res.ok) {
    const d = await res.json();
    sha = d.sha;
    if (typeof d.content === 'string') {
      const data = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, '')))));
      list = Array.isArray(data) ? data : (data.agents || []);
    }
  }
  const next = transformFn(list) || [];
  const body = { message: 'agents: update authored agents', content: btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 2)))) };
  if (sha) body.sha = sha;
  const put = await f(base, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!put || !put.ok) throw new Error(`could not write agents.json (status ${put && put.status})`);
  return next;
}

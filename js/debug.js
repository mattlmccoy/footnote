// js/debug.js — Hidden owner debug page. Read-only diagnostics. Pure helpers unit-tested;
// DOM + fetch orchestration browser-verified. Owner-side (no AI-clean constraint).

// Per-document drift verdict. `fill` (0..100) drives the little sync bar.
// Two provenance paths, in preference order:
//  1. built_from_commit — exact, but the render pipeline does not currently record it (it ships as ''),
//     so this path is effectively dormant until it does.
//  2. timestamps — when the source file last changed vs when this doc's HTML was last rendered. This is
//     the signal that actually works today.
// "not rendered" means ONLY that content/<id>.html is missing; a missing build ref is 'unknown', not
// 'nyr' (conflating them mislabeled every rendered doc as "not rendered").
export function classifySync({ rendered, builtFrom, mainSha, ahead, fileTouched, renderedAt, sourceAt } = {}) {
  if (!rendered) return { state: 'nyr', label: 'not rendered', fill: 0 };
  if (builtFrom && mainSha) {
    if (builtFrom === mainSha || ahead === 0) return { state: 'insync', label: 'in sync', fill: 100 };
    if (typeof ahead === 'number' && ahead > 0) {
      const fill = Math.max(10, Math.min(90, 100 - ahead * 15));
      return fileTouched
        ? { state: 'behind-touched', label: `${ahead} behind`, fill }
        : { state: 'behind-untouched', label: `${ahead} behind · file untouched`, fill };
    }
  }
  if (renderedAt && sourceAt) {
    return sourceAt > renderedAt                       // ISO-8601 Z strings compare lexicographically
      ? { state: 'stale', label: 'source newer', fill: 35 }
      : { state: 'insync', label: 'up to date', fill: 100 };
  }
  return { state: 'unknown', label: 'no source ref', fill: 0 };
}

// Worst-first severity order for a project's overall dot.
const _SEV = ['nyr', 'unknown', 'stale', 'behind-touched', 'behind-untouched', 'insync'];
export function rollupProject(docVerdicts, openCount) {
  const docs = docVerdicts || [];
  const behind = docs.filter(d => d.state === 'stale' || d.state === 'behind-touched' || d.state === 'behind-untouched').length;
  let worst = 'insync';
  for (const d of docs) if (_SEV.indexOf(d.state) < _SEV.indexOf(worst)) worst = d.state;
  return { docCount: docs.length, behind, open: openCount || 0, worst };
}

// The classic owner-login token needs these scopes (fine-grained tokens report no scope header → null).
export const REQUIRED_SCOPES = ['repo', 'workflow'];
export function parseScopes(headerVal) {
  if (headerVal == null) return null;
  return headerVal.split(',').map(s => s.trim()).filter(Boolean);
}
export function diffScopes(present, required) {
  if (present == null) return { ok: null, missing: [] };   // fine-grained token → can't assert from a header
  const missing = (required || []).filter(s => !present.includes(s));
  return { ok: missing.length === 0, missing };
}

// Parse the ms timestamp base36-encoded in a job id ('j_<base36>'); null if unparseable.
function _jobTs(id) {
  const m = /^j_([a-z0-9]+)$/i.exec(id || '');
  if (!m) return null;
  const n = parseInt(m[1], 36);
  return Number.isFinite(n) ? n : null;
}
export function queueAge(jobs, now) {
  const list = jobs || [];
  if (!list.length) return { count: 0, oldest: null };
  let oldest = list[0], oldestTs = _jobTs(list[0].id);
  for (const j of list) {
    const ts = _jobTs(j.id);
    if (ts != null && (oldestTs == null || ts < oldestTs)) { oldest = j; oldestTs = ts; }
  }
  return { count: list.length, oldest: { type: oldest.type || 'job', ageMs: oldestTs == null ? null : now - oldestTs } };
}

// Plain-text (Markdown) snapshot for the clipboard. Reads ONLY non-secret fields off `state`; the token
// and any secret VALUES are never referenced here, so they can't leak into the copied text.
export function buildSnapshot(state) {
  const s = state || {};
  const b = s.build || {}, g = s.github || {}, p = s.pipeline || {};
  const L = [];
  L.push(`# Footnote debug snapshot — ${s.now || ''}`);
  L.push('');
  L.push(`build: deployed ${b.deployedSha || '?'} (${b.deployedTime || '?'}) · this page ${b.pageStale ? 'STALE' : 'current'}`);
  L.push(`github: ${g.login || '?'} · token ${g.tokenValid ? 'valid' : 'INVALID'} · scopes ${(g.scopes || []).join(', ') || '(fine-grained)'} · rate ${g.rateRemaining ?? '?'} · net ${g.net || '?'}`);
  if (s.secretNames) L.push(`secrets present: ${s.secretNames.join(', ')}`);
  L.push(`pipeline: mode ${p.mode || '?'} · ${p.queueCount || 0} pending${p.oldestType ? ` · oldest ${p.oldestType} ${p.oldestAgeMin ?? '?'}m` : ''}`);
  L.push('');
  for (const pr of s.projects || []) {
    L.push(`## ${pr.id} — ${pr.docCount} docs · ${pr.behind} behind · ${pr.open} open`);
    for (const d of pr.docs || []) {
      L.push(`- ${d.id} · ${d.rendered ? 'rendered' : 'NOT rendered'} · built ${d.builtFrom || '—'} · ${d.state} · open ${d.open}`);
    }
  }
  return L.join('\n');
}

import { resolveProject, loadConfig, loadProjects } from './config.js?v=f58d6b0';
import { isActiveComment } from './model.js?v=c284b81';
import { fetchWithTimeout } from './nethelpers.js?v=a764ebc';
import { formatBuildTime } from './buildinfo.js?v=2e84ce0';

const API = 'https://api.github.com';
const _b64json = d => JSON.parse(decodeURIComponent(escape(atob(String(d.content).replace(/\s/g, '')))));

// One authenticated GET, bounded by the repo's shared timeout+retry. Returns { ok, status, headers, json };
// json is null on a non-ok/parse failure. Never throws (a transport failure → { ok:false, status:0 }).
export async function dbgGet(token, url, fetchImpl) {
  try {
    const r = await fetchWithTimeout(
      `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' },
      { fetchImpl },
    );
    let json = null; try { json = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, headers: r.headers, json };
  } catch { return { ok: false, status: 0, headers: { get: () => null }, json: null }; }
}

async function _contentJson(token, repo, path, fetchImpl) {
  const r = await dbgGet(token, `${API}/repos/${repo}/contents/${path}`, fetchImpl);
  if (!r.ok || !r.json || typeof r.json.content !== 'string') return null;
  try { return _b64json(r.json); } catch { return null; }
}


// Last commit date touching `path` in `repo` — the render-provenance fallback used when the pipeline
// never recorded built_from_commit. Returns an ISO string, or null when unknown.
async function _lastCommitAt(token, repo, path, fetchImpl) {
  if (!repo || !path) return null;
  const r = await dbgGet(token, `${API}/repos/${repo}/commits?path=${path}&per_page=1`, fetchImpl);
  const c = Array.isArray(r.json) ? r.json[0] : null;
  return (c && c.commit && c.commit.committer && c.commit.committer.date) || null;
}

// Collect one project's per-document sync verdicts + rollup.
export async function collectProject(token, appCfg, projects, projectId, fetchImpl) {
  const cfg = resolveProject(appCfg, projects, projectId);
  const dataRepo = cfg.dataRepo, sourceRepo = cfg.sourceRepo;
  const dpfx = cfg.dataPrefix || '';
  const spfx = cfg.srcPrefix || '';
  const chR = await dbgGet(token, `${API}/repos/${dataRepo}/contents/${dpfx}chapters.json`, fetchImpl);
  // A transport/auth failure (NOT a real 404) means we can't trust an empty result → surface it, don't render green.
  const chaptersFetchFailed = !chR.ok && chR.status !== 404;
  let chaptersRaw = null;
  if (chR.ok && chR.json && typeof chR.json.content === 'string') { try { chaptersRaw = _b64json(chR.json); } catch { chaptersRaw = null; } }
  const chapterList = Array.isArray(chaptersRaw) ? chaptersRaw : (chaptersRaw && chaptersRaw.chapters) || [];
  // One tree read serves two purposes: which docs are rendered, and where the advisor comment stores live.
  const treeR = await dbgGet(token, `${API}/repos/${dataRepo}/git/trees/main?recursive=1`, fetchImpl);
  const treePaths = (treeR.json?.tree || []).filter(x => x.type === 'blob').map(x => x.path);
  const rendered = new Set(treePaths
    .filter(p => p.startsWith(`${dpfx}content/`) && p.endsWith('.html'))
    .map(p => p.slice((dpfx + 'content/').length, -'.html'.length)));
  // advisor/<advisorId>/<chapterId>.json — reviewer comments live in their OWN stores, separate from
  // reviews/. Counting only reviews/ under-reports open work (a reviewer's open comment would read as 0).
  const advByChapter = new Map();
  const advRe = new RegExp(`^${dpfx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}advisor/[^/]+/(.+)\\.json$`);
  for (const p of treePaths) {
    const m = advRe.exec(p);
    if (!m) continue;
    const arr = advByChapter.get(m[1]) || []; arr.push(p); advByChapter.set(m[1], arr);
  }
  // source main HEAD (once per project)
  const mainR = sourceRepo ? await dbgGet(token, `${API}/repos/${sourceRepo}/commits/main`, fetchImpl) : { json: null };
  const mainSha = mainR.json?.sha || '';
  const compareCache = new Map();
  const docs = [];
  let open = 0;
  for (const ch of chapterList) {
    const isRendered = rendered.has(ch.id);
    const review = await _contentJson(token, dataRepo, `${dpfx}reviews/${ch.id}.json`, fetchImpl);
    const builtFrom = review?.built_from_commit || '';
    let openN = (review?.comments || []).filter(isActiveComment).length;
    for (const ap of advByChapter.get(ch.id) || []) {          // + this chapter's reviewer stores
      const aj = await _contentJson(token, dataRepo, ap, fetchImpl);
      // status 'open' is a reviewer's unsubmitted draft the author never sees — mirror the owner portal.
      openN += (aj?.comments || []).filter(c => c.status !== 'open' && isActiveComment(c)).length;
    }
    open += openN;
    let ahead = null, fileTouched = null;
    if (builtFrom && mainSha && builtFrom !== mainSha && sourceRepo) {
      if (!compareCache.has(builtFrom)) {
        const cmp = await dbgGet(token, `${API}/repos/${sourceRepo}/compare/${builtFrom}...${mainSha}`, fetchImpl);
        compareCache.set(builtFrom, cmp.json || { ahead_by: null, files: [] });
      }
      const cmp = compareCache.get(builtFrom);
      ahead = typeof cmp.ahead_by === 'number' ? cmp.ahead_by : null;
      fileTouched = !!(cmp.files || []).some(fl => fl.filename === ch.sourceFile);
    }
    let renderedAt = null, sourceAt = null;
    if (isRendered && !builtFrom) {                       // no exact ref → fall back to commit timestamps
      renderedAt = await _lastCommitAt(token, dataRepo, `${dpfx}content/${ch.id}.html`, fetchImpl);
      sourceAt = ch.sourceFile ? await _lastCommitAt(token, sourceRepo, `${spfx}${ch.sourceFile}`, fetchImpl) : null;
    }
    const verdict = classifySync({ rendered: isRendered, builtFrom, mainSha, ahead, fileTouched, renderedAt, sourceAt });
    docs.push({ id: ch.id, n: ch.n, title: ch.title, rendered: isRendered, builtFrom, open: openN, ...verdict });
  }
  const result = { id: cfg.projectId, name: cfg.projectName, dataRepo, sourceRepo, docs, rollup: rollupProject(docs, open) };
  if (chaptersFetchFailed) result.error = `could not read chapters.json (status ${chR.status})`;
  return result;
}

// Collect every project (sequential to stay gentle on the rate limit).
export async function collectAll(token, appCfg, projects, fetchImpl) {
  const out = [];
  for (const p of projects || []) {
    try { out.push(await collectProject(token, appCfg, projects, p.id, fetchImpl)); }
    catch (e) { out.push({ id: p.id, name: p.name, error: String(e && e.message || e), docs: [], rollup: rollupProject([], 0) }); }
  }
  return out;
}

// Build/GitHub/pipeline signals that don't belong to a single project. `projects[0]` is treated as the
// primary project for the mode + job-queue readout (jobs/mode are per Review-repo).
export async function collectGlobal(token, appCfg, projects, fetchImpl) {
  const f = fetchImpl || fetch;
  const g = { login: null, tokenValid: false, scopes: null, rateRemaining: null, net: 'ok' };
  const who = await dbgGet(token, `${API}/user`, fetchImpl);
  g.tokenValid = who.ok; g.login = who.json?.login || null;
  g.scopes = parseScopes(who.headers?.get ? who.headers.get('x-oauth-scopes') : null);
  const rl = await dbgGet(token, `${API}/rate_limit`, fetchImpl);
  g.rateRemaining = rl.json?.rate?.remaining ?? null;
  let build = { deployedSha: '', deployedTime: '', pageStale: false };
  try { const b = await (await f('build.json?t=' + Date.now(), { cache: 'no-store' })).json();
    build.deployedSha = b.sha || ''; build.deployedTime = formatBuildTime(b.time || ''); } catch {}
  // pipeline (mode + job queue) for the primary project, if any
  let mode = 'local', queue = { count: 0, oldest: null }, pipelineProject = null;
  const primary = (projects || [])[0];
  if (primary) {
    try {
      const cfg = resolveProject(appCfg, projects, primary.id);
      mode = cfg.processingMode || 'local';
      pipelineProject = primary.id;
      const jobsRaw = await _contentJson(token, cfg.dataRepo, `${cfg.dataPrefix || ''}jobs.json`, fetchImpl);
      queue = queueAge(Array.isArray(jobsRaw) ? jobsRaw : [], Date.now());
    } catch {}
  }
  return { github: g, build, mode, queue, pipelineProject };
}

const _dot = st => ({ insync: 'ok', stale: 'warn', 'behind-untouched': 'warn', 'behind-touched': 'warn', nyr: 'bad', unknown: 'dim' }[st] || 'dim');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function render(state, doc) {
  const d = doc || document;
  const root = d.getElementById('root');
  if (!state.authenticated) { root.innerHTML = `<p style="color:var(--dim)">Not authenticated — open this page from the owner portal (Alt+click the build orb) so your token is available.</p>`; return; }
  const g = state.github, b = state.build;
  const card = (title, rows) => `<div style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:11px 13px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin-bottom:8px">${title}</div>${rows}</div>`;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${k}</span><span style="color:var(--dim)">${v}</span></div>`;
  const q = state.queue || { count: 0, oldest: null };
  const projHtml = (state.projects || []).map(p => {
    const rl = p.rollup || { docCount: 0, behind: 0, open: 0, worst: 'insync' };
    const table = (p.docs || []).map(x => `<tr>
      <td style="padding:6px 10px;border-top:1px solid var(--line)">${esc(x.n)} · ${esc(x.title)}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line)"><span style="color:var(--${_dot(x.state)})">●</span> ${esc(x.label || x.state)}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line);font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc((x.builtFrom || '—').slice(0, 7))}</td>
      <td style="padding:6px 10px;border-top:1px solid var(--line)">${x.open || 0}</td></tr>`).join('');
    return `<details style="border:1px solid var(--line);border-radius:9px;margin-bottom:8px" ${state.projects.length === 1 ? 'open' : ''}>
      <summary style="padding:10px 13px;cursor:pointer"><span style="color:var(--${_dot(rl.worst)})">●</span>
        <b>${esc(p.name || p.id)}</b> <span style="color:var(--dim);font-size:11.5px">${rl.docCount} docs · ${rl.behind} behind · ${rl.open} open${p.error ? ' · ERROR: ' + esc(p.error) : ''}</span></summary>
      <table style="width:100%;border-collapse:collapse;font-size:12px">${table}</table></details>`;
  }).join('');
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:14px">
      <h1 style="font-size:15px;margin:0">Footnote · Debug</h1>
      <span style="font-size:11px;color:var(--dim)">deployed ${esc(b.deployedSha)} · this page ${b.pageStale ? 'STALE' : 'current'}</span>
      <button id="dbg-copy" style="margin-left:auto;font:inherit;font-size:12px;background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;color:var(--accent);cursor:pointer">Copy snapshot</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      ${card('GitHub connection', row('Token', g.tokenValid ? 'valid · ' + esc(g.login) : 'INVALID') + row('Scopes', g.scopes ? esc(g.scopes.join(', ')) : '(fine-grained)') + row('Rate limit', esc(g.rateRemaining ?? '?')) + row('Net', esc(g.net)))}
      ${card('Pipeline', row('Mode', esc(state.mode)) + row('Queue', q.count ? `${q.count} pending${q.oldest ? ' · oldest ' + esc(q.oldest.type) : ''}` : 'idle') + row('Deployed', esc(b.deployedTime)))}
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin:0 2px 8px">Projects (${(state.projects || []).length})</div>
    ${projHtml || '<p style="color:var(--dim)">No projects.</p>'}`;
  const copyBtn = d.getElementById('dbg-copy');
  if (copyBtn) copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(buildSnapshot(state.snapshot)); copyBtn.textContent = 'Copied ✓'; setTimeout(() => (copyBtn.textContent = 'Copy snapshot'), 1500); }
    catch { copyBtn.textContent = 'Copy failed'; }
  };
}

// Assemble the snapshot object render() hands to buildSnapshot on copy.
function _snapshotOf(state, nowIso) {
  const q = state.queue || { count: 0, oldest: null };
  return { now: nowIso, build: state.build, github: state.github,
    pipeline: { mode: state.mode, queueCount: q.count || 0, oldestType: q.oldest?.type || null,
      oldestAgeMin: q.oldest?.ageMs != null ? Math.round(q.oldest.ageMs / 60000) : null },
    projects: (state.projects || []).map(p => ({ id: p.id, docCount: p.rollup.docCount, behind: p.rollup.behind, open: p.rollup.open,
      docs: (p.docs || []).map(dd => ({ id: dd.id, rendered: dd.rendered, builtFrom: (dd.builtFrom || '').slice(0, 7), state: dd.state, open: dd.open })) })) };
}

// The launcher (js/hub.js) resolves the hub repo as localStorage['footnote:hub'] || cfg.hubRepo ||
// '<owner>/footnote-projects', and the shipped config's `owner` is a placeholder replaced at runtime by the
// /user login. The debug page must mirror this or loadProjects (which needs appCfg.hubRepo) returns [].
export function effectiveHubCfg(appCfg, login, localHub) {
  const owner = login || (appCfg && appCfg.owner) || '';
  const hubRepo = localHub || (appCfg && appCfg.hubRepo) || (owner ? `${owner}/footnote-projects` : '');
  return { ...appCfg, owner, hubRepo, workspaceRepo: hubRepo };
}

export async function boot() {
  const token = (function () { try { return localStorage.getItem('ghpat'); } catch { return null; } })();
  if (!token) { render({ authenticated: false }, document); return; }
  const rawCfg = await loadConfig();
  let login = ''; try { const who = await dbgGet(token, `${API}/user`); login = who.json?.login || ''; } catch {}
  let localHub = ''; try { localHub = localStorage.getItem('footnote:hub') || ''; } catch {}
  const appCfg = effectiveHubCfg(rawCfg, login, localHub);
  const projects = await loadProjects(appCfg, token);
  const global = await collectGlobal(token, appCfg, projects);
  const deep = await collectAll(token, appCfg, projects);
  const nowIso = new Date().toISOString();
  const state = { authenticated: true, ...global, projects: deep };
  state.snapshot = _snapshotOf(state, nowIso);
  render(state, document);
}

if (typeof document !== 'undefined') boot();

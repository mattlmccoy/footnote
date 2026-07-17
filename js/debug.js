// js/debug.js — Hidden owner debug page. Read-only diagnostics. Pure helpers unit-tested;
// DOM + fetch orchestration browser-verified. Owner-side (no AI-clean constraint).

// Per-document drift verdict. `fill` (0..100) drives the little sync bar.
export function classifySync({ rendered, builtFrom, mainSha, ahead, fileTouched } = {}) {
  if (!rendered || !builtFrom) return { state: 'nyr', label: 'not rendered', fill: 0 };
  if (!mainSha) return { state: 'unknown', label: 'unknown', fill: 0 };
  if (builtFrom === mainSha || ahead === 0) return { state: 'insync', label: 'in sync', fill: 100 };
  if (typeof ahead === 'number' && ahead > 0) {
    const fill = Math.max(10, Math.min(90, 100 - ahead * 15));
    return fileTouched
      ? { state: 'behind-touched', label: `${ahead} behind`, fill }
      : { state: 'behind-untouched', label: `${ahead} behind · file untouched`, fill };
  }
  return { state: 'unknown', label: 'unknown', fill: 0 };
}

// Worst-first severity order for a project's overall dot.
const _SEV = ['nyr', 'unknown', 'behind-touched', 'behind-untouched', 'insync'];
export function rollupProject(docVerdicts, openCount) {
  const docs = docVerdicts || [];
  const behind = docs.filter(d => d.state === 'behind-touched' || d.state === 'behind-untouched').length;
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

import { resolveProject } from './config.js?v=dev';
import { isActiveComment } from './model.js?v=dev';
import { fetchWithTimeout } from './nethelpers.js?v=dev';

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

// Collect one project's per-document sync verdicts + rollup.
export async function collectProject(token, appCfg, projects, projectId, fetchImpl) {
  const cfg = resolveProject(appCfg, projects, projectId);
  const dataRepo = cfg.dataRepo, sourceRepo = cfg.sourceRepo;
  const dpfx = cfg.dataPrefix || '';
  const chR = await dbgGet(token, `${API}/repos/${dataRepo}/contents/${dpfx}chapters.json`, fetchImpl);
  // A transport/auth failure (NOT a real 404) means we can't trust an empty result → surface it, don't render green.
  const chaptersFetchFailed = !chR.ok && chR.status !== 404;
  let chaptersRaw = null;
  if (chR.ok && chR.json && typeof chR.json.content === 'string') { try { chaptersRaw = _b64json(chR.json); } catch { chaptersRaw = null; } }
  const chapterList = Array.isArray(chaptersRaw) ? chaptersRaw : (chaptersRaw && chaptersRaw.chapters) || [];
  // rendered set: content/<id>.html present in the data-repo tree
  const treeR = await dbgGet(token, `${API}/repos/${dataRepo}/git/trees/main?recursive=1`, fetchImpl);
  const rendered = new Set((treeR.json?.tree || []).filter(x => x.type === 'blob')
    .map(x => x.path).filter(p => p.startsWith(`${dpfx}content/`) && p.endsWith('.html'))
    .map(p => p.slice((dpfx + 'content/').length, -'.html'.length)));
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
    const openN = (review?.comments || []).filter(isActiveComment).length;
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
    const verdict = classifySync({ rendered: isRendered, builtFrom, mainSha, ahead, fileTouched });
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

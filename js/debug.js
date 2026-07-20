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

// The staged-edit branch for a doc, if the source repo has one. Branch naming verified against the real
// source repo (review-edits/__outline__, review-edits/citations-audit, …). null when there is none.
export function editBranchFor(branches, docId) {
  if (!branches || !docId) return null;
  const want = `review-edits/${docId}`;
  return branches.includes(want) ? want : null;
}

// Coarse human age for the oldest queued job. null in → null out (unknown stays unknown).
export function humanAge(ms) {
  if (ms == null) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// "4,731 / 5,000" — the denominator matters (a bare number hides how close to the ceiling you are).
// "4,731 / 5,000" never said WHICH WAY it counted, so it read equally well as usage. Spell it out, and
// include the reset — "low" means something very different 2 minutes before a refill than 50 minutes.
export function fmtRate(remaining, limit, reset = null, now = Date.now()) {
  if (remaining == null) return '?';                     // unmeasured is not healthy: never fill in a number
  const r = Number(remaining).toLocaleString('en-US');
  if (limit == null) return r;
  const lim = Number(limit).toLocaleString('en-US');
  const used = Math.max(0, Number(limit) - Number(remaining));
  // An hourly window only ANCHORS when a request actually counts. Until then GitHub reports
  // reset = now + the full window length, so a page that spends nothing (everything answered 304)
  // shows a flat "resets in 60 min" forever — a countdown that never moves reads as a broken clock.
  // Report the true state instead: nothing has been used, so there is nothing counting down.
  if (used === 0) return `${r} of ${lim} · nothing used this hour`;
  let out = `${r} left of ${lim} · ${used.toLocaleString('en-US')} used`;
  if (reset != null) {
    const ms = Number(reset) - now;
    out += ms <= 0 ? ' · resets now' : ms < 60_000 ? ' · resets in <1 min' : ` · resets in ${Math.round(ms / 60_000)} min`;
  }
  return out;
}

// content/built.json (ci_render write_build_manifest) = {unitId: {sha, ts}} — which source commit a
// unit's HTML was rendered from. '' when unrecorded, so an unknown ref is never mistaken for a real one.
export function builtShaFor(manifest, docId) {
  const e = manifest && docId ? manifest[docId] : null;
  return (e && e.sha) || '';
}

// Run `fn` over `items` with at most `limit` in flight, preserving input order. The per-document
// collection was sequential (14 docs ≈ 7.4s); concurrent it is ~12x faster, but an unbounded fan-out
// invites GitHub's secondary rate limits. A rejected item yields null in its slot rather than losing
// the whole batch — one bad document must not blank the page.
export async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      try { out[i] = await fn(list[i], i); }
      catch { out[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return out;
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

// When a job was requested, in ms. Prefers the explicit `requested_ts` field (ISO) and falls back to the
// ms timestamp base36-encoded in a 'j_<base36>' id. null when neither is parseable.
function _jobTs(job) {
  const j = job || {};
  if (j.requested_ts) { const t = Date.parse(j.requested_ts); if (Number.isFinite(t)) return t; }
  const m = /^j_([a-z0-9]+)$/i.exec(j.id || '');
  if (!m) return null;
  const n = parseInt(m[1], 36);
  return Number.isFinite(n) ? n : null;
}
// jobs.json is an append-only LOG, not a queue: finished work stays in it forever. Outstanding work is
// `status != 'done'` — the same filter the engine uses to build its todo list (data-template/ci_apply.py).
// Counting every entry made a healthy 57-job history read as "57 pending".
export function queueAge(jobs, now) {
  const list = (jobs || []).filter(j => j && j.status !== 'done');
  if (!list.length) return { count: 0, oldest: null };
  let oldest = list[0], oldestTs = _jobTs(list[0]);
  for (const j of list) {
    const ts = _jobTs(j);
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
import { condApi } from './condfetch.js?v=acd31f3';   // conditional reads: an unchanged diagnostic costs no rate limit
import { budgetSnapshot } from './ratebudget.js?v=dbe477a';   // budget observed from real response headers
import { formatBuildTime } from './buildinfo.js?v=2e84ce0';
import { unitLabel } from './unitlabel.js?v=dev';   // 'Chapter 3' / 'Appendix A' — never a raw .n
import { parseVersion, latestFromHtml, isStale } from './version.js?v=b8a0753';

const API = 'https://api.github.com';
const DOC_CONCURRENCY = 8;   // measured: 14 docs 7.4s sequential -> ~0.6s; capped to stay clear of burst limits
const _b64json = d => JSON.parse(decodeURIComponent(escape(atob(String(d.content).replace(/\s/g, '')))));

// One authenticated GET, bounded by the repo's shared timeout+retry. Returns { ok, status, headers, json };
// json is null on a non-ok/parse failure. Never throws (a transport failure → { ok:false, status:0 }).
// Conditional by default: this page re-reads the same diagnostics on every load, and an unchanged read
// answered 304 costs no rate limit — which matters here more than anywhere, because the collector fans
// out per project and per document. /rate_limit is exempt (see condApi's noCache): it must stay live.
export async function dbgGet(token, url, fetchImpl) {
  try {
    const r = await condApi(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      token, noCache: /\/rate_limit\b/.test(url),
      fetchImpl: (u, o) => fetchWithTimeout(u, o, { fetchImpl }),
    });
    return { ok: r.ok, status: r.status, headers: r.headers || { get: () => null }, json: r.json };
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
  // staged-edit branches on the source repo (verified to exist: review-edits/<id>)
  const brR = sourceRepo ? await dbgGet(token, `${API}/repos/${sourceRepo}/branches?per_page=100`, fetchImpl) : { json: null };
  const branches = Array.isArray(brR.json) ? brR.json.map(b => b && b.name).filter(Boolean) : [];
  // commit-exact provenance, written by the render pipeline beside counts.json
  const builtManifest = (await _contentJson(token, dataRepo, `${dpfx}content/built.json`, fetchImpl)) || {};
  // Compare results are cached by PROMISE, not value: under concurrency two docs built from the same
  // commit would otherwise both fire the request before either finished caching.
  const compareCache = new Map();
  const compareFor = (builtFrom) => {
    if (!compareCache.has(builtFrom)) {
      compareCache.set(builtFrom, dbgGet(token, `${API}/repos/${sourceRepo}/compare/${builtFrom}...${mainSha}`, fetchImpl)
        .then(r => r.json || { ahead_by: null, files: [] })
        .catch(() => ({ ahead_by: null, files: [] })));
    }
    return compareCache.get(builtFrom);
  };

  // One document's verdict. Independent per doc, so these run concurrently (bounded).
  const collectDoc = async (ch) => {
    const isRendered = rendered.has(ch.id);
    const review = await _contentJson(token, dataRepo, `${dpfx}reviews/${ch.id}.json`, fetchImpl);
    // manifest first (the render pipeline records it); the legacy reviews field is a fallback
    const builtFrom = builtShaFor(builtManifest, ch.id) || review?.built_from_commit || '';
    let openN = (review?.comments || []).filter(isActiveComment).length;
    const advFiles = await Promise.all((advByChapter.get(ch.id) || [])
      .map(ap => _contentJson(token, dataRepo, ap, fetchImpl)));
    for (const aj of advFiles) {                              // + this chapter's reviewer stores
      // status 'open' is a reviewer's unsubmitted draft the author never sees — mirror the owner portal.
      openN += (aj?.comments || []).filter(c => c.status !== 'open' && isActiveComment(c)).length;
    }
    let ahead = null, fileTouched = null;
    if (builtFrom && mainSha && builtFrom !== mainSha && sourceRepo) {
      const cmp = await compareFor(builtFrom);
      ahead = typeof cmp.ahead_by === 'number' ? cmp.ahead_by : null;
      fileTouched = !!(cmp.files || []).some(fl => fl.filename === ch.sourceFile);
    }
    let renderedAt = null, sourceAt = null;
    if (isRendered && !builtFrom) {                       // no exact ref → fall back to commit timestamps
      [renderedAt, sourceAt] = await Promise.all([
        _lastCommitAt(token, dataRepo, `${dpfx}content/${ch.id}.html`, fetchImpl),
        ch.sourceFile ? _lastCommitAt(token, sourceRepo, `${spfx}${ch.sourceFile}`, fetchImpl) : Promise.resolve(null),
      ]);
    }
    const verdict = classifySync({ rendered: isRendered, builtFrom, mainSha, ahead, fileTouched, renderedAt, sourceAt });
    return { id: ch.id, n: ch.n, kind: ch.kind || null, title: ch.title, rendered: isRendered, builtFrom,
             open: openN, editBranch: editBranchFor(branches, ch.id), ...verdict };
  };

  const docs = (await mapLimit(chapterList, DOC_CONCURRENCY, collectDoc)).filter(Boolean);
  const open = docs.reduce((a, d) => a + (d.open || 0), 0);
  const result = { id: cfg.projectId, name: cfg.projectName, dataRepo, sourceRepo, docs,
                   unitNoun: (cfg.doc && cfg.doc.unitNoun) || 'chapter', rollup: rollupProject(docs, open) };
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
// Identity + budget. The budget is taken from the RESPONSE HEADERS of the calls we already make, not
// from GET /rate_limit: measured against the live API, that endpoint returns a lagging, eventually-
// consistent aggregate — it read ~100 requests higher than the header on the very same token, and sat
// still while real spending moved the header. The header is what our requests actually see, and reading
// it costs nothing because it rides along on every response (ratebudget.js observes them all).
export async function collectGitHub(token, fetchImpl) {
  const g = { login: null, tokenValid: false, scopes: null, rateRemaining: null, rateLimit: null, rateReset: null, latencyMs: null, net: 'ok' };
  const t0 = Date.now();
  const who = await dbgGet(token, `${API}/user`, fetchImpl);
  g.latencyMs = Date.now() - t0;                       // real round-trip to api.github.com
  g.tokenValid = who.ok; g.login = who.json?.login || null;
  g.scopes = parseScopes(who.headers?.get ? who.headers.get('x-oauth-scopes') : null);
  const b = budgetSnapshot();                          // null fields until a real response has been seen
  g.rateRemaining = b.remaining; g.rateLimit = b.limit; g.rateReset = b.reset;
  return g;
}

export async function collectGlobal(token, appCfg, projects, fetchImpl) {
  const f = fetchImpl || fetch;
  const g = await collectGitHub(token, fetchImpl);
  let build = { deployedSha: '', deployedTime: '', pageStale: false };
  try { const b = await (await f('build.json?t=' + Date.now(), { cache: 'no-store' })).json();
    build.deployedSha = b.sha || ''; build.deployedTime = formatBuildTime(b.time || ''); } catch {}
  // Honest staleness: this module's own cache-bust hash vs the one debug.html currently serves. (The
  // site-wide build.json sha is a COMMIT sha — a different namespace — so comparing to it would be noise.)
  build.pageSha = parseVersion(import.meta.url);
  try {
    const html = await (await f('debug.html?t=' + Date.now(), { cache: 'no-store' })).text();
    build.pageStale = isStale(build.pageSha, latestFromHtml(html, 'debug.js'));
  } catch {}
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
  const g = state.github || {}, b = state.build || {}, q = state.queue || { count: 0, oldest: null };
  const loading = !!state.loading;
  // A value still in flight renders as a shimmering bar, never as a plausible-looking zero.
  const sk = (w) => `<span style="display:inline-block;width:${w}px;height:9px;border-radius:4px;background:var(--line);opacity:.65;animation:dbgPulse 1.2s ease-in-out infinite"></span>`;
  const val = (v, w) => (v === undefined || v === null ? sk(w) : v);

  const pill = (txt, tone) => `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:600;background:var(--${tone}bg);color:var(--${tone})">${txt}</span>`;
  const dot = (tone) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--${tone});margin-right:7px;vertical-align:middle"></span>`;
  const card = (title, rows) => `<div style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:12px 14px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin-bottom:9px">${title}</div>${rows}</div>`;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:3.5px 0"><span>${k}</span><span style="color:var(--dim);text-align:right">${v}</span></div>`;

  // ---- per-project tables (with real column headers) ----
  const noMarker = '<style>#root summary::-webkit-details-marker{display:none}'
    + '@keyframes dbgPulse{0%,100%{opacity:.35}50%{opacity:.75}}'
    + '@keyframes dbgRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'
    + '#root .dbg-in{animation:dbgRise .35s ease-out both}</style>';
  const topBar = loading
    ? `<div style="position:fixed;left:0;top:0;right:0;height:2px;background:var(--line);z-index:50"><i style="display:block;height:100%;width:${Math.round(state.progress || 0)}%;background:var(--accent);transition:width .35s ease"></i></div>`
    : '';
  const th = (t, extra = '') => `<th style="text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);font-weight:600;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;${extra}">${t}</th>`;
  const td = (v, extra = '') => `<td style="padding:7px 10px;border-top:1px solid var(--line);${extra}">${v}</td>`;
  const bar = (v) => `<span style="position:relative;display:inline-block;width:64px;height:6px;border-radius:4px;background:var(--line);overflow:hidden;vertical-align:middle;margin-right:9px"><i style="position:absolute;left:0;top:0;bottom:0;width:${Math.max(0, Math.min(100, v.fill || 0))}%;border-radius:4px;background:var(--${_dot(v.state)})"></i></span>`;

  const projHtml = (state.projects || []).map((p, pi) => {
    const rl = p.rollup || { docCount: 0, behind: 0, open: 0, worst: 'insync' };
    const rows = (p.docs || []).map(x => `<tr>
      ${td(`${esc(unitLabel({ n: x.n, kind: x.kind }, p.unitNoun))} · ${esc(x.title)}`)}
      ${td(x.rendered ? 'yes' : `${dot('bad')}missing`, 'white-space:nowrap;' + (x.rendered ? '' : 'color:var(--bad)'))}
      ${td(esc((x.builtFrom || '—').slice(0, 7)), 'font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dim)')}
      ${td(`${bar(x)}<span style="color:var(--${_dot(x.state)})">${esc(x.label || x.state)}</span>`, 'white-space:nowrap')}
      ${td(x.editBranch ? `<span style="font-size:10.5px;padding:2px 7px;border-radius:5px;background:var(--warnbg);color:var(--warn);font-family:ui-monospace,Menlo,monospace">${esc(x.editBranch)}</span>` : '<span style="color:var(--dim)">—</span>')}
      ${td(String(x.open || 0), 'text-align:right')}
    </tr>`).join('');
    return `<details class="dbg-in" style="border:1px solid var(--line);border-radius:9px;margin-bottom:9px;overflow:hidden" ${pi === 0 ? 'open' : ''}>
      <summary style="padding:11px 13px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:0"><span style="color:var(--dim);margin-right:8px;font-size:10px">${pi === 0 ? '&#9660;' : '&#9654;'}</span>${dot(_dot(rl.worst))}<b>${esc(p.name || p.id)}</b>
        <span style="color:var(--dim);font-size:11.5px;margin-left:6px">${rl.docCount} docs · ${rl.behind} behind main · ${rl.open} open comment${rl.open === 1 ? '' : 's'}${p.error ? ' · ERROR: ' + esc(p.error) : ''}</span></summary>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr>${th('Document')}${th('Rendered')}${th('Built from')}${th('vs source main')}${th('Edits')}${th('Open', 'text-align:right')}</tr></thead>
        <tbody>${rows}</tbody></table></details>`;
  }).join('');

  root.innerHTML = `${noMarker}${topBar}
    <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:11px;margin-bottom:15px">
      <h1 style="font-size:15.5px;margin:0;letter-spacing:-.2px">Footnote · Debug</h1>
      ${state.build ? pill('deployed ' + esc(b.deployedSha || '?'), 'ok') : sk(86)}
      <span style="font-size:11.5px;color:var(--dim)">this page: <span style="font-family:ui-monospace,Menlo,monospace">${esc(b.pageSha || b.deployedSha || '?')}</span> · ${b.pageStale ? '<span style="color:var(--warn)">stale</span>' : 'up to date'}</span>
      <span style="margin-left:auto;font-size:11.5px;color:var(--dim)">${loading ? 'collecting…' : `refreshed ${esc(state.refreshedAt || '')}`}${state.timings ? ` · <span title="${esc(state.timings.detail || '')}" style="font-family:ui-monospace,Menlo,monospace">${esc(state.timings.total)}</span>` : ''} · <a href="#" id="dbg-reload" style="color:var(--accent)">reload</a></span>
      <button id="dbg-copy" style="font:inherit;font-size:12px;background:none;border:1px solid var(--line);border-radius:6px;padding:4px 11px;color:var(--accent);cursor:pointer">Copy snapshot</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:17px">
      ${card('GitHub connection',
        row('Owner token', state.github ? (g.tokenValid ? `valid · ${esc(g.login)}` : '<span style="color:var(--bad)">INVALID</span>') : sk(96)) +
        row('Scopes', !state.github ? sk(120) : (g.scopes ? `<span style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px">${esc(g.scopes.join(' · '))}</span>` : '(fine-grained)')) +
        row('Reachability', state.github ? `api.github.com${g.latencyMs != null ? ' · ' + g.latencyMs + ' ms' : ''}` : sk(104)) +
        row('Rate limit', state.github ? esc(fmtRate(g.rateRemaining, g.rateLimit, g.rateReset)) : sk(72)))}
      ${card('Pipeline',
        row('Processing mode', state.mode ? pill(esc(state.mode), state.mode === 'cloud' ? 'warn' : 'ok') : sk(48)) +
        row(`${dot(q.count ? 'warn' : 'ok')}Job queue`, state.github ? (q.count ? `${q.count} pending` : 'idle') : sk(40)) +
        row('Oldest job', !state.github ? sk(84) : (q.oldest ? `${esc(q.oldest.type)}${humanAge(q.oldest.ageMs) ? ' · ' + humanAge(q.oldest.ageMs) : ''}` : '—')) +
        row('Last deploy', !state.build ? sk(110) : esc(b.deployedTime || '?')))}
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:600;margin:0 2px 9px">Projects${
      loading && !(state.projects || []).length && !(state.pendingProjects || []).length
        ? '' : ` (${(state.projects || []).length + (state.pendingProjects || []).length})`}</div>
    ${projHtml}${(state.pendingProjects || []).map(pp => `
      <div style="border:1px solid var(--line);border-radius:9px;margin-bottom:9px;padding:11px 13px;display:flex;align-items:center;gap:9px;color:var(--dim)">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);animation:dbgPulse 1.2s ease-in-out infinite"></span>
        <b style="color:var(--dim)">${esc(pp.name || pp.id)}</b><span style="font-size:11.5px">reading documents…</span></div>`).join('')}
    ${(!projHtml && !(state.pendingProjects || []).length)
        ? (loading ? '<p style="color:var(--dim)">reading projects…</p>' : '<p style="color:var(--dim)">No projects.</p>')
        : ''}`;

  const copyBtn = d.getElementById('dbg-copy');
  if (copyBtn) copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(buildSnapshot(state.snapshot)); copyBtn.textContent = 'Copied ✓'; setTimeout(() => (copyBtn.textContent = 'Copy snapshot'), 1500); }
    catch { copyBtn.textContent = 'Copy failed'; }
  };
  const rl = d.getElementById('dbg-reload');
  if (rl) rl.onclick = (e) => { e.preventDefault(); location.reload(); };
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

  // Progressive reveal: paint at every phase instead of after the whole ~3.5s collection, so the
  // GitHub card is readable in well under a second (often the only number you came for). Values still
  // in flight render as shimmering bars — never as a plausible zero.
  const t0 = Date.now();
  const marks = [];
  let state = { authenticated: true, loading: true, progress: 6, projects: [], pendingProjects: [] };
  const paint = (patch, progress) => {
    state = { ...state, ...patch, ...(progress == null ? {} : { progress }) };
    render(state, document);
  };
  paint({}, 6);

  const rawCfg = await loadConfig();
  let login = ''; try { const who = await dbgGet(token, `${API}/user`); login = who.json?.login || ''; } catch {}
  let localHub = ''; try { localHub = localStorage.getItem('footnote:hub') || ''; } catch {}
  const appCfg = effectiveHubCfg(rawCfg, login, localHub);
  const projects = await loadProjects(appCfg, token);
  marks.push(['config', Date.now() - t0]);
  paint({ pendingProjects: projects.map(p => ({ id: p.id, name: p.name })) }, 18);

  const tG = Date.now();
  const global = await collectGlobal(token, appCfg, projects);
  marks.push(['github', Date.now() - tG]);
  paint({ ...global }, 32);                                   // cards land here (~0.8s)

  const deep = [];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const tP = Date.now();
    try { deep.push(await collectProject(token, appCfg, projects, p.id)); }
    catch (e) { deep.push({ id: p.id, name: p.name, error: String((e && e.message) || e), docs: [], rollup: rollupProject([], 0) }); }
    marks.push([p.id, Date.now() - tP]);
    paint({ projects: [...deep], pendingProjects: projects.slice(i + 1).map(x => ({ id: x.id, name: x.name })) },
          32 + Math.round(((i + 1) / Math.max(1, projects.length)) * 66));
  }

  const totalMs = Date.now() - t0;
  const fmt = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  state = { ...state, loading: false, progress: 100, projects: deep, pendingProjects: [],
    refreshedAt: new Date().toLocaleTimeString([], { hour12: false }),
    timings: { total: fmt(totalMs), detail: marks.map(([n, ms]) => `${n} ${fmt(ms)}`).join(' · ') } };
  state.snapshot = _snapshotOf(state, new Date().toISOString());
  render(state, document);
}

if (typeof document !== 'undefined') boot();

// Footnote configuration — the single source of truth, read by BOTH the browser front-end
// (app.js / advisor.js / gh.js / ghsecrets.js) AND the Python CI (which reads the same
// footnote.config.json). Every adopter-specific value lives here; nothing Matt-specific is
// hardcoded anywhere else. Pure helpers are unit-tested; loadConfig fetches + caches.

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

// Only identity is required. `chapters` is NOT here: it is discovered by parsing the adopter's own
// document (LaTeX/Word) and stored in the data repo's chapters.json, never shipped in config.
const REQUIRED = ['owner', 'dataRepo'];

const DEFAULTS = {
  brand: { name: 'Footnote', logo: 'brand/footnote-mark.png', accent: '#2c64c4' },
  doc: { noun: 'document', unitNoun: 'chapter', title: '', field: '' },
  storagePrefix: 'footnote',
  ownerPortalFile: '',
  advisorPortalFile: 'advisor.html',
  inviteWorkflow: 'invite.yml',
  ownerAuthorTag: 'owner',
  reviewAgents: [],
  advisors: [],
  chapters: [],   // fallback only; the live list is loadChapters() from the data repo
  deadline: null,
  hubRepo: '',    // multi-project registry repo (owner/footnote-projects); projects.json lives there
  workspaceRepo: '',   // consolidated mode: ONE repo holds every project as a subfolder <id>/…
  dataPrefix: '',      // path prefix into the data repo for this project ('' = legacy root; '<id>/' = workspace)
  srcPrefix: '',       // path prefix into the source repo for this project ('' = legacy root; '<id>/source/')
};

// Validate required keys and apply defaults for every optional key. Nested brand/doc merge
// key-by-key so an adopter can set brand.name without losing the default logo/accent.
export function normalizeConfig(raw) {
  const cfg = raw || {};
  const missing = REQUIRED.filter(k => cfg[k] == null);
  if (missing.length) {
    throw new ConfigError(`footnote.config.json is missing required keys: ${missing.join(', ')}`);
  }
  return {
    ...DEFAULTS,
    ...cfg,
    brand: { ...DEFAULTS.brand, ...(cfg.brand || {}) },
    doc: { ...DEFAULTS.doc, ...(cfg.doc || {}) },
    reviewAgents: cfg.reviewAgents || DEFAULTS.reviewAgents,
    advisors: cfg.advisors || DEFAULTS.advisors,
    deadline: cfg.deadline || null,
  };
}

export function dataRepoParts(cfg) {
  const [owner, repo] = String(cfg.dataRepo).split('/');
  return { owner, repo };
}

// Namespace a localStorage key so two Footnote instances in one browser never collide.
export function storageKey(cfg, name) {
  return `${cfg.storagePrefix}:${name}`;
}

// Resolve a chapter id → {n, title, sourceFile}. Unknown id falls back to {n:'?', title:id}
// (parity OWNER-010 / ADV-035 — a comment on a since-removed chapter still renders a label).
export function chapterMeta(cfg, id) {
  const c = (cfg.chapters || []).find(x => x.id === id);
  if (!c) return { n: '?', title: id, sourceFile: null };
  return { n: c.n, title: c.title, sourceFile: c.sourceFile || null };
}

// Whole days until the deadline, clamped ≥0. Null when the instance has no deadline
// (parity OWNER-163 — the countdown is optional).
export function daysToDeadline(cfg, now = new Date()) {
  if (!cfg.deadline || !cfg.deadline.date) return null;
  const ms = new Date(cfg.deadline.date) - now;
  return Math.max(0, Math.ceil(ms / 86400000));
}

// The {id,name,shared} list used to generate committee shells (replaces hand-committed
// CCS.html/CJS.html/review-lab.html). Every named advisor is a non-shared shell; a single
// shared "general" lab shell is always appended.
export function advisorShellConfig(cfg) {
  const named = (cfg.advisors || []).map(a => ({ id: a.id, name: a.name || a.id, shared: false }));
  return [...named, { id: 'general', name: 'Lab review', shared: true }];
}

let _cache = null;

// Fetch footnote.config.json (relative to the page), normalize, and cache. fetchImpl defaults
// to the global fetch; tests inject a fake. opts.force bypasses the cache (used by tests).
export async function loadConfig(fetchImpl, opts = {}) {
  if (_cache && !opts.force) return _cache;
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new ConfigError('no fetch available to load footnote.config.json');
  const res = await f('./footnote.config.json');
  if (!res || !res.ok) {
    throw new ConfigError(`could not load footnote.config.json (status ${res && res.status})`);
  }
  const raw = await res.json();
  _cache = normalizeConfig(raw);
  return _cache;
}

// Synchronous accessor for the already-loaded config. Boot calls loadConfig() once before any
// render; every module (gh.js, ghsecrets.js, app.js, advisor.js) then reads the cached singleton
// synchronously when it builds a URL or a storage key. Throws if called before loadConfig.
export function getConfig() {
  if (!_cache) throw new ConfigError('config not loaded — call loadConfig() at boot before getConfig()');
  return _cache;
}

// Replace the cached config with the EFFECTIVE one (e.g. after resolveProject in multi-project mode), so
// every module that reads getConfig() (gh.js, ghsecrets.js, loadChapters) uses the selected project's dataRepo.
export function setConfig(cfg) { _cache = cfg; return _cache; }

// Advisors hold only a data-repo key (no hub access), so their invite link carries the project's data repo
// directly as ?data=owner/repo. Read + validate it, else fall back to the app config's dataRepo.
export function dataRepoFromParams(search, fallback) {
  const p = new URLSearchParams(search || '').get('data');
  return (p && /^[\w.-]+\/[\w.-]+$/.test(p)) ? p : (fallback || '');
}

// ---- Multi-project: a hub repo's projects.json lists projects; each carries its own data repo, doc
// nouns, deadline and advisors. The app-level config (footnote.config.json) supplies brand/hub/storage.

const PROJECT_REQUIRED = ['id', 'name', 'dataRepo'];
const PROJECT_DEFAULTS = {
  doc: { noun: 'document', unitNoun: 'chapter', title: '', field: '' },
  advisors: [],
  reviewAgents: [],
  deadline: null,
  sourceRepo: '',
  workspace: false,   // true = this project lives under <workspaceRepo>/<id>/ (consolidated); false = own repos (legacy)
};

// Validate + default one project entry from projects.json.
export function normalizeProject(raw) {
  const p = raw || {};
  const missing = PROJECT_REQUIRED.filter(k => p[k] == null || p[k] === '');
  if (missing.length) throw new ConfigError(`project is missing required keys: ${missing.join(', ')}`);
  return {
    ...PROJECT_DEFAULTS,
    ...p,
    doc: { ...PROJECT_DEFAULTS.doc, ...(p.doc || {}) },
    advisors: p.advisors || [],
    reviewAgents: p.reviewAgents || [],
    deadline: p.deadline || null,
  };
}

// Merge the app config with the selected project → the effective config the reviewer uses. Project
// fields (dataRepo, doc, deadline, advisors, sourceRepo) win; brand/storage/portal files inherit from app.
export function resolveProject(appCfg, projects, projectId) {
  const p = (projects || []).find(x => x.id === projectId);
  if (!p) throw new ConfigError(`unknown project: ${projectId}`);
  // Consolidated (workspace) mode: this project's DATA lives under <workspaceRepo>/<id>/ so one repo holds
  // every project (kills per-paper repo bloat). The workspace repo is the hub repo unless overridden. Source
  // is in the workspace too (<id>/source/) for uploads, OR an external repo the user points at (github mode).
  // Legacy mode: the project's own dataRepo/sourceRepo at the repo root (prefixes stay '').
  const wsRepo = appCfg.workspaceRepo || appCfg.hubRepo;
  const workspace = !!p.workspace && !!wsRepo;
  const sourceInWs = workspace && (!p.sourceRepo || p.sourceRepo === wsRepo);
  const dataRepo = workspace ? wsRepo : p.dataRepo;
  const sourceRepo = sourceInWs ? wsRepo : (p.sourceRepo || appCfg.sourceRepo);
  return normalizeConfig({
    ...appCfg,
    dataRepo,
    sourceRepo,
    dataPrefix: workspace ? `${p.id}/` : '',
    srcPrefix: sourceInWs ? `${p.id}/source/` : '',
    doc: { ...appCfg.doc, ...p.doc },
    deadline: p.deadline || null,
    advisors: p.advisors || [],
    reviewAgents: p.reviewAgents || appCfg.reviewAgents,
    projectId: p.id,
    projectName: p.name,
  });
}

// Prepend the project's data-repo prefix to a path ('' for legacy → passthrough; '<id>/' for workspace).
export function dataPath(cfg, path) {
  return `${(cfg && cfg.dataPrefix) || ''}${path}`;
}

// Detail shown after "Source connected ·" in the setup checklist. An uploaded workspace project
// has sourceRepo = the workspace repo (source lives at <id>/source/), which reads like a repo the
// user connected — it's an upload. srcPrefix (set only for in-workspace uploads) disambiguates.
// Returns { repo } to render an escaped repo slug, or { text } for a fixed phrase.
export function sourceLabel(cfg, parsed) {
  const uploaded = !!(cfg && cfg.srcPrefix);
  if (cfg && cfg.sourceRepo && !uploaded) return { repo: cfg.sourceRepo };
  if (uploaded) return { text: 'uploaded' };
  return { text: parsed ? '' : 'point Footnote at your LaTeX, or upload it' };
}

// Build a reviewer (advisor) portal invite URL. Advisors have no hub access, so the link carries the data
// repo (&data=) directly; for a consolidated workspace project it also carries the project id (&p=<id>) so
// the advisor bundle prefixes all its data paths with <id>/. base is the site URL (…/, trailing slash).
export function advisorInviteUrl(base, { id, name, dataRepo, projectId, accessKey } = {}) {
  const enc = encodeURIComponent;
  let url = `${base}advisor.html?a=${enc(id || '')}&n=${enc(name || '')}&data=${enc(dataRepo || '')}`;
  if (projectId) url += `&p=${enc(projectId)}`;
  if (accessKey) url += `&k=${enc(accessKey)}`;   // magic link: reviewer clicks and is in, no paste
  return url;
}

// Fetch + normalize the projects list from the hub repo. [] with no token / no hubRepo / 404.
export async function loadProjects(appCfg, token, fetchImpl) {
  if (!token || !appCfg.hubRepo) return [];
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return [];
  const url = `https://api.github.com/repos/${appCfg.hubRepo}/contents/projects.json?t=${Date.now()}`;
  let res;
  try { res = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' }); }
  catch { return []; }
  if (!res || !res.ok) return [];
  const d = await res.json();
  if (typeof d.content !== 'string') return [];
  let data;
  try { data = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, ''))))); }
  catch { return []; }
  const list = Array.isArray(data) ? data : (data.projects || []);
  return list.map(normalizeProject);
}

// Patch one project's fields in the hub's projects.json (e.g. set sourceRepo after an import) and write
// it back in place. Loads the raw file for its sha, shallow-merges `patch` into the matching entry (id
// stays fixed), and PUTs. Returns the updated normalized project list. fetchImpl is injectable for tests.
export async function writeProjectPatch(appCfg, projectId, patch, token, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new ConfigError('no fetch available to write projects.json');
  const url = `https://api.github.com/repos/${appCfg.hubRepo}/contents/projects.json?t=${Date.now()}`;
  const res = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res || !res.ok) throw new ConfigError(`could not read projects.json (status ${res && res.status})`);
  const d = await res.json();
  const raw = JSON.parse(decodeURIComponent(escape(atob(String(d.content).replace(/\s/g, '')))));
  const list = Array.isArray(raw) ? raw : (raw.projects || []);
  if (!list.some(p => p.id === projectId)) throw new ConfigError(`unknown project: ${projectId}`);
  const next = list.map(p => (p.id === projectId ? { ...p, ...(patch || {}), id: p.id } : p));
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 2))));
  const put = await f(`https://api.github.com/repos/${appCfg.hubRepo}/contents/projects.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `project ${projectId}: update`, content, sha: d.sha }),
  });
  if (!put.ok) throw new ConfigError(`could not write projects.json (status ${put.status})`);
  return next.map(normalizeProject);
}

// The live chapter list is discovered by parsing the adopter's document and stored as chapters.json
// in the DATA repo (not shipped in config). Fetch it with the reader's token. Returns [] when there is
// no token or no chapters.json yet (fresh instance → the app shows the "import your document" state).
// Accepts either a bare array or a { chapters: [...] } wrapper. fetchImpl is injectable for tests.
export async function loadChapters(token, fetchImpl) {
  if (!token) return [];
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return [];
  const cfg = getConfig();
  const { owner, repo } = dataRepoParts(cfg);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dataPath(cfg, 'chapters.json')}?t=${Date.now()}`;
  let res;
  try {
    res = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  } catch { return []; }
  if (!res || !res.ok) return [];   // 404 = not imported yet
  const d = await res.json();
  if (typeof d.content !== 'string') return [];
  let data;
  try { data = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, ''))))); }
  catch { return []; }
  return Array.isArray(data) ? data : (data.chapters || []);
}

// Whether the optional AI assistant (Send to Claude / run review agents) is on. OFF by default — the
// deterministic review→stage→approve→merge path is the core product. Enabled either by a per-user local
// flag (Settings toggle → localStorage 'footnote:assistant' === '1') or by an instance that ships a
// reviewAgents list in its config. `flag` is the raw localStorage value (string | null).
export function assistantEnabled(cfg, flag) {
  return flag === '1' || ((cfg && cfg.reviewAgents) || []).length > 0;
}

// Which actions the top-bar send menu offers, given the master switch and the configured agents.
// This is the single source of truth for gating the Claude surface: when the assistant is OFF the
// menu shows ONLY the deterministic Export action — no apply-edits (Claude) row, no run-agents row.
// When ON it reveals apply-edits, plus run-agents only when the instance configures reviewAgents.
// Ordered list of action ids; app.js maps each id to its menu HTML.
export function sendMenuActions(assistantOn, reviewAgents) {
  if (!assistantOn) return ['export'];
  const actions = ['apply-edits'];
  if (((reviewAgents) || []).length > 0) actions.push('run-agents');
  actions.push('export');
  return actions;
}

// Test-only: reset the module cache.
export function _resetConfigCache() { _cache = null; }

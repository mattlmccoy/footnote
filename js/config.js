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
  doc: { noun: 'document', unitNoun: 'chapter', title: '' },
  storagePrefix: 'footnote',
  ownerPortalFile: '',
  advisorPortalFile: 'advisor.html',
  inviteWorkflow: 'invite.yml',
  ownerAuthorTag: 'owner',
  reviewAgents: [],
  advisors: [],
  chapters: [],   // fallback only; the live list is loadChapters() from the data repo
  deadline: null,
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

// The live chapter list is discovered by parsing the adopter's document and stored as chapters.json
// in the DATA repo (not shipped in config). Fetch it with the reader's token. Returns [] when there is
// no token or no chapters.json yet (fresh instance → the app shows the "import your document" state).
// Accepts either a bare array or a { chapters: [...] } wrapper. fetchImpl is injectable for tests.
export async function loadChapters(token, fetchImpl) {
  if (!token) return [];
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return [];
  const { owner, repo } = dataRepoParts(getConfig());
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/chapters.json?t=${Date.now()}`;
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

// Test-only: reset the module cache.
export function _resetConfigCache() { _cache = null; }

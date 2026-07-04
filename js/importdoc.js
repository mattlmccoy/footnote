// Pure helpers for the document import + convert flow. No I/O — unit-tested in tests/importdoc.test.mjs.
// The import UI (app.js / hub.js) uses these to decide how to handle an uploaded file and where to put it.

// Which converter handles an uploaded file, by extension. 'tex' = commit as-is; 'docx' = pandoc Action.
// Anything else (md/pdf/none) is unsupported → null.
export function importFormat(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'tex') return 'tex';
  if (ext === 'docx') return 'docx';
  return null;
}

// Where a file of the given format is committed in the SOURCE repo:
//  - 'tex'  → 'main.tex' (the canonical entry the reader/export pipeline expects)
//  - 'docx' → '_import/upload.docx' (staging path the convert Action reads, then deletes)
export function stagingPath(format) {
  if (format === 'tex') return 'main.tex';
  if (format === 'docx') return '_import/upload.docx';
  return null;
}

// URL-safe, lowercase repo slug from a title (mirrors hub.js projectIdFromName, generic 'project' fallback).
function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

// Suggested source-repo full name for a new project: owner/<slug>-source (owner optional).
export function sourceRepoSuggestion(projectName, owner) {
  const name = `${slug(projectName)}-source`;
  return owner ? `${owner}/${name}` : name;
}

// Suggested private comments/data-repo full name: owner/<slug>-footnote-data (owner optional).
export function dataRepoSuggestion(projectName, owner) {
  const name = `${slug(projectName)}-footnote-data`;
  return owner ? `${owner}/${name}` : name;
}

// Resolve the source + comments repo names for a NEW project. Beginners never type a repo name: both are
// auto-derived from the project name. `mode` is where their writing lives — 'local' (upload) / 'overleaf'
// (sync then create) auto-name the source repo; 'github' uses the repo they pick. Advanced overrides win.
export function planNewProjectRepos({ mode, name, owner, sourceOverride, dataOverride } = {}) {
  const dataRepo = (dataOverride || '').trim() || dataRepoSuggestion(name, owner);
  const sourceRepo = mode === 'github'
    ? (sourceOverride || '').trim()
    : ((sourceOverride || '').trim() || sourceRepoSuggestion(name, owner));
  return { sourceRepo, dataRepo };
}

// ---- source-repo I/O (injectable fetch; default global fetch in the browser) ----
// These write to the ADOPTER's OWN source repo with their OWN token — no Footnote-held credential.

const API = 'https://api.github.com';
const b64 = s => (typeof btoa !== 'undefined'
  ? btoa(unescape(encodeURIComponent(s)))
  : Buffer.from(s, 'utf8').toString('base64'));   // Node fallback for tests
const _fetch = f => f || (typeof fetch !== 'undefined' ? fetch : null);

// Create the source repo if it doesn't exist (idempotent: 422 = already there). auto_init gives it a
// default branch so a root file can be committed immediately. private by default (it's the user's writing).
export async function ensureRepo(token, fullName, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const name = String(fullName).split('/').pop();
  const r = await f(`${API}/user/repos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: true, auto_init: true, description: 'Footnote document source' }),
  });
  if (r.status === 422) return;                    // already exists — fine
  if (!r.ok) throw new Error(`create ${fullName} failed (${r.status}) — check the token scope`);
}

// Return the blob sha of a file in a repo, or null if it doesn't exist (overwrite-guard primitive).
export async function repoFileSha(repo, path, token, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const r = await f(`${API}/repos/${repo}/contents/${path}?t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read ${repo}/${path} failed (${r.status})`);
  return (await r.json()).sha;
}

// Commit text to a repo path (create or update in place). Returns the new content sha.
export async function commitSourceFile(repo, path, text, token, msg, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const sha = await repoFileSha(repo, path, token, f).catch(() => null);
  const r = await f(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, content: b64(text), sha: sha || undefined }),
  });
  if (!r.ok) throw new Error(`commit ${repo}/${path} failed (${r.status})`);
  return (await r.json()).content.sha;
}

// Pure helpers for the document import + convert flow. No I/O — unit-tested in tests/importdoc.test.mjs.
// The import UI (app.js / hub.js) uses these to decide how to handle an uploaded file and where to put it.
import { parseLatexOutline } from './docparse.js?v=534763c';

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

// Resolve the concrete repos + project fields for a NEW project from the two axes chosen in the New
// Project sheet: `style` ('workspace' | 'independent') and `mode` (where the source is: 'local' upload |
// 'github' | 'overleaf'). Returns the addProject fields (workspace/dataRepo/sourceRepo/uploaded) plus
// `creates` = the repos to ensure exist (never an external source repo). Beginners never type a repo name
// (auto-derived from the project name); Advanced overrides win. Pure so the sheet's click handler stays
// thin and the whole matrix is unit-tested.
export function newProjectPlan(style, mode, name, cfg, opts = {}) {
  const owner = cfg.owner;
  const wsRepo = cfg.workspaceRepo || cfg.hubRepo;
  const uploaded = mode === 'local';
  const externalSrc = uploaded ? '' : (opts.sourceOverride || opts.sourceRepo || '').trim();
  if (style === 'workspace') {
    return { workspace: true, dataRepo: wsRepo, sourceRepo: externalSrc, uploaded, creates: [wsRepo] };
  }
  // independent: this document gets its own repos
  const dataRepo = (opts.dataOverride || '').trim() || dataRepoSuggestion(name, owner);
  const sourceRepo = externalSrc || (opts.sourceOverride || '').trim() || sourceRepoSuggestion(name, owner);
  const creates = uploaded ? [dataRepo, sourceRepo] : [dataRepo];  // never create an external source repo
  return { workspace: false, dataRepo, sourceRepo, uploaded, creates };
}

// ---- folder upload: a real article needs its figures + .bib, so we commit the whole project ----

// Which uploaded .tex is the document root: prefer a file literally named main.tex, else the one that
// carries \documentclass + \begin{document}, else the first .tex. files: [{ path, text }]. → path | null.
export function pickEntryTex(files) {
  const tex = (files || []).filter(f => /\.tex$/i.test(f.path));
  if (!tex.length) return null;
  const named = tex.find(f => /(^|\/)main\.tex$/i.test(f.path));
  if (named) return named.path;
  const root = tex.find(f => /\\documentclass/.test(f.text || '') && /\\begin\s*\{document\}/.test(f.text || ''));
  return (root || tex[0]).path;
}

// webkitdirectory paths are prefixed with the chosen folder name; strip that first segment so files land
// at the source-repo root (mydraft/figures/x.pdf → figures/x.pdf).
export function stripTopFolder(relPath) {
  const p = String(relPath);
  const i = p.indexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

// Commit text files as utf8; everything else (figures) as raw bytes. Source extensions are text.
const TEXT_EXT = /\.(tex|bib|cls|sty|bst|txt|md|json|yml|yaml|csv|clo|ltx)$/i;
export function isTextPath(path) { return TEXT_EXT.test(String(path)); }

// From a read folder ([{path, isText, text?, base64?}]), find the entry .tex and build the
// \include/\input resolver map keyed WITHOUT the .tex extension (matching parseLatexChapters /
// detectUnitLevel's resolveFile contract). Returns { entry, entryText, map }; entry is null and
// entryText '' when the folder has no .tex. Pure + testable — the New Project + reviewer import
// flows both use it so folder handling can't drift between them.
export function folderTexIndex(files) {
  const texts = (files || []).filter(f => f.isText);
  const entry = pickEntryTex(texts);
  const map = {};
  for (const f of texts) if (/\.tex$/i.test(f.path)) map[f.path.replace(/\.tex$/i, '')] = f.text;
  const entryText = entry ? (texts.find(f => f.path === entry)?.text ?? '') : '';
  return { entry, entryText, map };
}

// The nested "Proposed outline" tree from a folder's .tex files: reuses folderTexIndex's entry + \input
// resolver, then parseLatexOutline. null when the folder has no .tex entry. Pure — one source-true
// extraction used by both the reviewer import (browser) and the gen-outline CLI (refresh-source).
export function outlineFromFiles(files) {
  const { entry, entryText, map } = folderTexIndex(files);
  if (!entry) return null;
  return parseLatexOutline(entryText, p => (p in map ? map[p] : null));
}

// Normalize a heading for prev-matching: lowercase, collapse whitespace, trim (matches outline_gen.py).
const _normHead = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Index every prior node that HAS a synopsis key (even '') by normalized heading text, so regeneration can
// re-attach exactly the curated notes. Presence matters: a section with no synopsis key stays keyless.
function _priorSynopsisIndex(prev) {
  const idx = {};
  const walk = nodes => (nodes || []).forEach(n => {
    if (n && Object.prototype.hasOwnProperty.call(n, 'synopsis')) idx[_normHead(n.title)] = n.synopsis;
    walk(n.sections); walk(n.subsections);
  });
  if (prev) walk(prev.chapters);
  return idx;
}

// Merge a freshly-generated outline with a prior outline.json so human curation survives structural
// regeneration (mirrors phd-dissertation/export/outline_gen.py, the behavior it replaces). The prior outline
// is authoritative for annotations: synopses are NEVER invented — a node gets the prior synopsis for its
// heading text (including an empty one), and any generated synopsis with no prior match is DROPPED so
// regeneration never injects auto-text into a curated outline. title = prev.title || generated.title;
// intro = prev.intro when present. Pure: returns `generated` unchanged when prev is null/empty. Mutates
// `generated` in place and returns it.
export function mergeOutlinePrev(generated, prev) {
  if (!generated || !prev) return generated;
  const idx = _priorSynopsisIndex(prev);
  const apply = nodes => (nodes || []).forEach(n => {
    const key = _normHead(n.title);
    if (Object.prototype.hasOwnProperty.call(idx, key)) n.synopsis = idx[key];
    else delete n.synopsis;
    apply(n.sections); apply(n.subsections);
  });
  apply(generated.chapters);
  if (prev.title) generated.title = prev.title;
  if (prev.intro !== undefined) generated.intro = prev.intro;
  return generated;
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

// PUT already-base64 content to a repo path (create or update in place). Returns the new content sha.
async function putBase64(repo, path, base64, token, msg, f) {
  const sha = await repoFileSha(repo, path, token, f).catch(() => null);
  const r = await f(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, content: base64, sha: sha || undefined }),
  });
  if (!r.ok) throw new Error(`commit ${repo}/${path} failed (${r.status})`);
  return (await r.json()).content.sha;
}

// Commit text to a repo path (create or update in place). Returns the new content sha.
export async function commitSourceFile(repo, path, text, token, msg, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  return putBase64(repo, path, b64(text), token, msg, f);
}

// Commit an already-base64-encoded binary (e.g. a figure) to a repo path. Returns the new content sha.
export async function commitSourceBinary(repo, path, base64, token, msg, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  return putBase64(repo, path, base64, token, msg, f);
}

// ---- migrator: fold a legacy per-project repo into the workspace under <id>/ ----

// Map a legacy repo's paths to their workspace destinations (<id>/ for data, <id>/source/ for source),
// skipping the repo's own git/CI plumbing (the workspace has its own). Returns [{from, to}].
export function planMigration(paths, id, sub = '') {
  return (paths || [])
    .filter(p => !p.startsWith('.git/') && !p.startsWith('.github/') && p !== '.gitignore')
    .map(p => ({ from: p, to: `${id}/${sub}${p}` }));
}

// List every blob path in a repo's default branch (for copying a legacy repo wholesale).
export async function listRepoTree(repo, token, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const r = await f(`${API}/repos/${repo}/git/trees/main?recursive=1&t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store',
  });
  if (!r.ok) throw new Error(`tree ${repo} failed (${r.status})`);
  return ((await r.json()).tree || []).filter(x => x.type === 'blob').map(x => x.path);
}

// Fetch a file's raw base64 content from a repo (whitespace-stripped so it re-PUTs cleanly, binary-safe).
export async function getRepoBlob(repo, path, token, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const r = await f(`${API}/repos/${repo}/contents/${path}?t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store',
  });
  if (!r.ok) throw new Error(`read ${repo}/${path} failed (${r.status})`);
  return String((await r.json()).content || '').replace(/\s/g, '');
}

// Copy a legacy project's own repos INTO the workspace repo under <id>/ (data) and <id>/source/ (source).
// Binary-safe (base64 passthrough). onProgress(msg) is optional. Returns { data, src } file counts. The
// caller flips the project to workspace mode (writeProjectPatch) after this resolves.
export async function migrateProjectToWorkspace(project, workspaceRepo, token, onProgress, fetchImpl) {
  const f = _fetch(fetchImpl); if (!f) throw new Error('no fetch available');
  const id = project.id;
  const copy = async (fromRepo, sub) => {
    if (!fromRepo || fromRepo === workspaceRepo) return 0;
    const plan = planMigration(await listRepoTree(fromRepo, token, f), id, sub);
    let i = 0;
    for (const { from, to } of plan) {
      if (onProgress) onProgress(`Copying ${++i}/${plan.length} · ${to}`);
      await commitSourceBinary(workspaceRepo, to, await getRepoBlob(fromRepo, from, token, f), token, `migrate: ${to}`, f);
    }
    return plan.length;
  };
  const data = await copy(project.dataRepo, '');
  const src = (project.sourceRepo && project.sourceRepo !== project.dataRepo) ? await copy(project.sourceRepo, 'source/') : 0;
  return { data, src };
}

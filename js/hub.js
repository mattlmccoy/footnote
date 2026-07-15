// Footnote launcher — the multi-project homepage. Lists the owner's review projects from the hub repo's
// projects.json, lets them create a new one, and opens a project's reviewer. Serverless: all state is a
// projects.json in the owner's private hub repo, read/written with their token. The workspace (hub) repo
// can be set up entirely in the UI (stored as a localStorage override so nothing in the app repo is edited).
import { loadConfig, loadProjects, normalizeProject, writeProjectPatch, projectStorage, loadAccount, writeAccount } from './config.js?v=98c897b';
import { groupByWorkspace, workspaceNames, moveDocPatch, defaultWorkspaceName } from './workspaces.js?v=48fa24b';
import { storageBadge, storageLabel, storageInfo } from './storagecopy.js?v=d7cc02b';
import { addWorkspace, removeWorkspace, normalizeAccount, overleafSealTargets, overleafExpiryDue, overleafSaveTargets, needsOverleafSeal, withSealedRepo } from './account.js?v=0000000';
import { seedDataRepo, ensureRenderPipeline, ensureOverleafPipeline } from './seed.js?v=c823c55';
import { getPublicKey, putSecret, dispatchOverleaf, overleafRun } from './ghsecrets.js?v=9f27b8e';
import { sealToBase64 } from './vendor/seal.js?v=175ae7b';
import { overleafMarker, secretName, bridgeUrlHint, conflictSummary, overleafNewProjectPatch } from './overleaf.js?v=5e5b959';
import { importFormat, sourceRepoSuggestion, dataRepoSuggestion, planNewProjectRepos, newProjectPlan, ensureRepo, commitSourceFile, commitSourceBinary, migrateProjectToWorkspace, folderTexIndex, stripTopFolder, isTextPath } from './importdoc.js?v=14b7d2d';
import { parseLatexChapters, detectUnitLevel, resolveUnitNoun } from './docparse.js?v=534763c';
import { startWatch as startNetWatch } from './netstatus.js?v=131b82f';
import { showBuildTag } from './buildinfo.js?v=bb62768';
import { brandMark as MARK } from './brandmark.js?v=a2aa2c8';   // shared Footnote logo (real mark, single source)
import { classicTokenUrl, fineGrainedUrl, OWNER_KEY_PERMISSIONS } from './tokenscopes.js?v=cf28223';
startNetWatch();
showBuildTag(import.meta.url);

// ---- pure helpers (unit-tested) ----

export function addProject(projects, entry) {
  const p = normalizeProject(entry);
  if ((projects || []).some(x => x.id === p.id)) throw new Error(`a project named that already exists (id "${p.id}")`);
  return [...(projects || []), p];
}
export function removeProject(projects, id) {
  return (projects || []).filter(p => p.id !== id);
}
export function updateProject(projects, id, patch) {
  return (projects || []).map(p => {
    if (p.id !== id) return p;
    const merged = { ...p, ...(patch || {}), id: p.id };   // id is stable — edits never change it
    if (patch && patch.doc) merged.doc = { ...(p.doc || {}), ...patch.doc };   // keep unitNoun etc.
    return normalizeProject(merged);
  });
}
export function projectHref(cfg, id) {
  return `${cfg.ownerPortalFile || 'owner.html'}?project=${encodeURIComponent(id)}`;
}
export function defaultHubRepo(cfg) { return `${cfg.owner}/footnote-projects`; }
export function projectIdFromName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
// A doc noun as a LaTeX source filename — the "code hint" doc-type tag on a book spine (thesis.tex).
export function texFileName(noun) {
  const slug = String(noun == null ? '' : noun).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'document'}.tex`;
}
// Book-spine palette for the shelf — warm editorial hues that harmonize with the paper background.
// Each project gets a spine color by its position so the shelf reads like a row of different books.
export const SPINES = ['#2c64c4', '#b5643c', '#4a7c59', '#7a4b73', '#c08a2d', '#2f7d80', '#93313e'];
export function spineColor(i) { return SPINES[((i % SPINES.length) + SPINES.length) % SPINES.length]; }
// First name for the greeting: first word of the GitHub display name, else the login, else a generic.
export function greetName(user) {
  const u = user || {};
  const first = String(u.name || '').trim().split(/\s+/)[0];
  return first || u.login || 'there';
}
// First-run onboarding: which of the three setup steps the user is on (null once they have a project).
export const ONBOARD_STEPS = ['Connect', 'Workspace', 'First project'];
export function onboardingStep({ hasToken, hasHub, hasProjects } = {}) {
  if (hasProjects) return null;                       // onboarding complete
  const index = !hasToken ? 0 : !hasHub ? 1 : 2;
  return { index, total: ONBOARD_STEPS.length, label: ONBOARD_STEPS[index] };
}

// ---- M3: account Settings — pure builders + seal orchestration (unit-tested) ----

// GitHub-access status for the Settings page. Takes the token but keeps only a boolean — the token value is
// NEVER stored or rendered (the user's own credential). Copy is plain-English, no token echo.
export function githubAccessStatus(token) {
  const connected = !!(token && String(token).trim());
  return connected
    ? { connected: true, label: 'Connected', detail: 'Your GitHub token is set in this browser and sent only to GitHub.' }
    : { connected: false, label: 'Not connected', detail: 'Connect a GitHub token to use Footnote.' };
}

// Overleaf-seal view for the Settings page, derived from account.json. `now` is injected so the 1-year
// expiry test is deterministic. Never carries the token — only which repos it was sealed into and when.
export function overleafSettingsView(account, now) {
  const a = normalizeAccount(account);
  const setAt = a.overleaf.setAt || '';
  return {
    sealedRepos: a.overleaf.sealedRepos,
    setAt,
    sealed: a.overleaf.sealedRepos.length > 0 || !!setAt,
    expiryDue: overleafExpiryDue(setAt, now || new Date()),
  };
}

// Seal the account-wide Overleaf token into EACH target repo (one public-key fetch + one sealed PUT per repo),
// reusing ghsecrets/getPublicKey+putSecret (injected as deps so this is unit-testable without the network).
// Returns ONLY the list of repos sealed — the raw token value is never returned, stored, or logged.
export async function sealOverleafIntoRepos(token, repos, value, deps) {
  const { getPublicKey, putSecret, sealFn } = deps;
  const sealed = [];
  for (const repo of repos) {
    const pk = await getPublicKey(token, repo);
    await putSecret(token, pk, sealFn, 'OVERLEAF_TOKEN', value, repo);
    sealed.push(repo);
  }
  return sealed;
}

// Pretty date for the "sealed on" line (empty string when never sealed).
function sealedOnLabel(setAt) {
  if (!setAt) return '';
  const d = new Date(setAt);
  return isNaN(d) ? setAt : d.toISOString().slice(0, 10);
}

// The Settings page inner HTML (three sections). Pure string builder so the sections, empty states, and the
// 1-year renewal reminder are unit-tested; the DOM wiring (buttons/handlers) lives in renderAccountSettings.
// NOTE: this NEVER receives or renders the Overleaf/GitHub token value — only booleans, repo names, dates.
export function settingsInnerHtml({ github, overleaf, names, sealTargets, workspaceRepo }) {
  const esch = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const targets = sealTargets || [];
  const wsNames = names || [];

  const gh = `<section class="fn-set-sec">
      <div class="fn-set-h">GitHub access</div>
      <div class="fn-set-row"><span class="fn-set-dot ${github.connected ? 'on' : 'off'}"></span>
        <div><div class="fn-set-lbl">${esch(github.label)}</div><div class="fn-set-sub">${esch(github.detail)}</div></div></div>
      ${github.connected ? '' : `<button class="fn-btn fn-btn-primary" id="fn-set-connect">Connect GitHub</button>`}
    </section>`;

  const olTargets = targets.length
    ? `It will be sealed into ${targets.length} document repo${targets.length === 1 ? '' : 's'} now (${targets.map(r => `<span class="fn-mono">${esch(r)}</span>`).join(', ')}), and every new Overleaf document connects automatically.`
    : `Save it now even before you link any Overleaf document — new Overleaf documents then connect automatically.`;
  // When a token is saved locally, lead with the auto-connect assurance. The token value is NEVER rendered.
  const olSaved = overleaf.tokenSaved
    ? `<div class="fn-set-sub">Overleaf token saved — new documents connect automatically.</div>`
    : '';
  const olState = overleaf.sealed
    ? `<div class="fn-set-sub">Token sealed${overleaf.setAt ? ` on <span class="fn-mono">${esch(sealedOnLabel(overleaf.setAt))}</span>` : ''}${overleaf.sealedRepos.length ? ` into ${overleaf.sealedRepos.map(r => `<span class="fn-mono">${esch(r)}</span>`).join(', ')}` : ''}.</div>`
    : (overleaf.tokenSaved ? '' : `<div class="fn-set-sub">Not set yet.</div>`);
  const olExpiry = overleaf.expiryDue
    ? `<div class="fn-set-warn">⚠ Your Overleaf token was sealed over a year ago. Overleaf git tokens expire after a year — generate a new one and re-seal it below to keep sync working.</div>`
    : '';
  const ol = `<section class="fn-set-sec">
      <div class="fn-set-h">Overleaf token</div>
      <div class="fn-set-sub">One Overleaf git-bridge token, sealed into your document repos so cloud sync can run. ${olTargets}</div>
      ${olSaved}
      ${olState}
      ${olExpiry}
      <div class="fn-set-inline">
        <input id="fn-set-oltok" type="password" placeholder="Overleaf git-bridge token" autocomplete="off" spellcheck="false">
        <button class="fn-btn fn-btn-primary" id="fn-set-olseal">Save Overleaf token</button>
      </div>
      <div class="fn-hint" id="fn-set-olstatus"></div>
    </section>`;

  const wsRows = wsNames.length
    ? wsNames.map(n => `<div class="fn-set-wsrow" data-ws="${esch(n)}">
          <span class="fn-set-wsname">${esch(n)}</span>
          <span class="fn-set-wsact">
            <button class="fn-link" data-ws-rename="${esch(n)}">Rename</button>
            <button class="fn-link fn-set-wsdel" data-ws-del="${esch(n)}">Delete</button>
          </span></div>`).join('')
    : `<div class="fn-set-sub">No workspaces yet. Add one to group your documents on the shelf.</div>`;
  const ws = `<section class="fn-set-sec">
      <div class="fn-set-h">Workspaces</div>
      <div class="fn-set-sub">Group your documents on the shelf. Deleting a workspace keeps its documents — they move back to your default group.</div>
      <div class="fn-set-wslist">${wsRows}</div>
      <div class="fn-set-inline">
        <input id="fn-set-wsnew" placeholder="New workspace name" spellcheck="false">
        <button class="fn-btn" id="fn-set-wsadd">＋ Add workspace</button>
      </div>
    </section>`;

  return `<div class="fn-head fn-reveal"><span class="fn-eyebrow">Account</span><h1 class="fn-h1">Settings</h1>
      <button class="fn-link" id="fn-set-back">← Back to library</button></div>
    <div class="fn-settings fn-reveal">${gh}${ol}${ws}</div>`;
}

// ---- I/O + DOM (browser only) ----

const API = 'https://api.github.com';
const HUB_KEY = 'footnote:hub';
const TOK_KEY = 'ghpat';
// The account-wide Overleaf git-bridge token, stored locally (mirrors the GitHub `ghpat` token) so it can be
// saved once and re-sealed into any newly linked document's repo without re-prompting. It is the user's own
// credential — only ever passed to putSecret as a sealed value; NEVER logged or rendered into the DOM.
const OVL_KEY = 'footnote:overleaftoken';
const hdr = t => ({ Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The Owner key. Classic repo + workflow is one-click AND correctly scoped (repo → Contents + Secrets +
// Actions + Variables; workflow → the background Actions). The fine-grained page can't preselect the repo
// or permissions via URL, so we deep-link it and spell out the exact permission list (tokenscopes.js).
const TOKEN_URL = classicTokenUrl();
const FG_URL = fineGrainedUrl('Footnote');
// The fine-grained Owner-key permission list, rendered inline in the Connect help.
const OWNER_FG_LIST = OWNER_KEY_PERMISSIONS
  .filter(p => p.level === 'Read and write')
  .map(p => `<b>${p.name}</b>`).join(', ');

// ---- M4: New Project storage relabel + ⓘ, and the workspace picker (pure HTML builders + one wiring fn) ----

// The storage segmented control for the New Project sheet. Wording comes ONLY from storagecopy.js (single
// source of truth): "Shared repo" (data-style="workspace") vs "Individual repo" (data-style="independent") —
// the internal style values are UNCHANGED, so storage selection behaves exactly as before. Each label carries
// an ⓘ that toggles a below-control info panel with the approved storageInfo copy (see wireStorageInfo).
export function storageControlHtml() {
  const seg = (style, kind) =>
    `<button type="button" class="fn-seg-b${style === 'workspace' ? ' on' : ''}" data-style="${style}">${esc(storageLabel(kind))}<span class="fn-i" data-info="${kind}" role="button" tabindex="0" aria-label="Preview ${esc(storageLabel(kind))}">ⓘ</span></button>`;
  // ONE always-visible description panel that reflects the SELECTED option (initialized to the default-selected
  // "shared"). It updates the instant you pick Shared vs Individual — no need to click the ⓘ (which now just
  // previews the OTHER option's copy without selecting it).
  return `<div class="fn-field-lbl">How should this be stored?</div>
      <div class="fn-seg fn-seg-info" id="np-style">
        ${seg('workspace', 'shared')}
        ${seg('independent', 'individual')}
      </div>
      <div class="fn-info-pop" id="np-store-info">${esc(storageInfo('shared'))}</div>`;
}

// The "Workspace ▾" picker at the top of the New Project sheet: the default group (empty value), every
// offered workspace name, then "New workspace…". `preWs` (the ＋ tile's data-ws, or the most-recent group)
// is preselected. The picked value is the GROUPING label — spread into the new project as `workspaceLabel`
// (never `workspace`, the storage boolean) at save time.
export function workspacePickerHtml({ names = [], def = 'My documents', preWs = '' } = {}) {
  const sel = (preWs || '').trim();
  const opt = (value, label) => `<option value="${esc(value)}"${value === sel ? ' selected' : ''}>${esc(label)}</option>`;
  const groups = (names || []).map(n => opt(n, n)).join('');
  return `<label class="fn-field">Workspace <span class="fn-sub">which group this document lives in</span>
        <select id="np-ws">${opt('', def || 'My documents')}${groups}<option value="__new__">＋ New workspace…</option></select></label>`;
}

// Wire the storage description panel within `scope` (the New Project scrim). The panel (#np-store-info) always
// shows the SELECTED option's copy: selecting Shared/Individual updates it immediately (via addEventListener so
// it coexists with the sheet's own selection handler), and the ⓘ PREVIEWS the other option's copy without
// selecting. Pure DOM plumbing over the markers storageControlHtml emits.
export function wireStorageInfo(scope) {
  const panel = scope.querySelector('#np-store-info');
  const kindOf = seg => (seg.dataset.style === 'workspace' ? 'shared' : 'individual');
  const setInfo = kind => { if (panel) panel.textContent = storageInfo(kind); };
  const selected = scope.querySelector('#np-style .fn-seg-b.on');
  setInfo(selected ? kindOf(selected) : 'shared');            // initialize to the selected option
  scope.querySelectorAll('#np-style .fn-seg-b').forEach(seg =>
    seg.addEventListener('click', () => setInfo(kindOf(seg))));   // selecting updates the description
  scope.querySelectorAll('.fn-i').forEach(i =>
    i.addEventListener('click', e => { e.stopPropagation(); setInfo(i.dataset.info); }));  // ⓘ previews the other
}

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

// The user's repos, so fields can be PICKED instead of typed. Cache is KEYED BY TOKEN so switching to a
// new (e.g. private-enabled) token always refetches. Records whether any private repo was visible.
let _repoCache = null;   // { token, names, priv, count, status, error }
async function userRepos(t) {
  if (_repoCache && _repoCache.token === t) return _repoCache;
  const out = []; let priv = 0, status = 0, error = '';
  try {
    // visibility=all + all affiliations so PRIVATE and org repos are included (given a token that can see them).
    for (let page = 1; page <= 6; page++) {
      const r = await fetch(`${API}/user/repos?per_page=100&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&page=${page}`, { headers: hdr(t), cache: 'no-store' });
      status = r.status;
      if (!r.ok) { error = 'HTTP ' + r.status; break; }
      const d = await r.json(); if (!Array.isArray(d)) { error = 'unexpected response'; break; }
      for (const x of d) if (x.private) priv++;
      out.push(...d.map(x => x.full_name));
      if (d.length < 100) break;
    }
  } catch (e) { error = (e && e.message) || 'network error'; }
  _repoCache = { token: t, names: out, priv, count: out.length, seenPrivate: priv > 0, status, error };
  return _repoCache;
}
// Attach a GitHub-repo autocomplete to a text input (still typeable). Suggestions from the user's repos.
function attachRepoPicker(input, t) {
  const menu = document.createElement('div'); menu.className = 'fn-ac';
  input.insertAdjacentElement('afterend', menu);
  let data = { names: [], priv: 0, count: 0, seenPrivate: true, status: 0, error: '' };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const m = data.names.filter(r => r.toLowerCase().includes(q)).slice(0, 8);
    // Live footer: shows the ACTUAL result so token/scope problems are visible, not silent.
    let foot;
    if (data.error) foot = `<div class="fn-ac-hint">Couldn't list your repos — <b>${esc(data.error)}</b>. The token may be wrong or lack access.</div>`;
    else if (data.priv === 0) foot = `<div class="fn-ac-hint">${data.count} repos found, <b>0 private</b>. Your token can't see private repos — make a <a href="${FG_URL}" target="_blank" rel="noopener">fine-grained token</a> with <b>All repositories</b>, or a <a href="${TOKEN_URL}" target="_blank" rel="noopener">classic token</a> with <code>repo</code> scope, then Disconnect &amp; reconnect.</div>`;
    else foot = `<div class="fn-ac-diag">${data.count} repos · ${data.priv} private</div>`;
    menu.innerHTML = m.map(r => `<div class="fn-ac-item">${esc(r)}</div>`).join('') + foot;
    menu.style.display = 'block';
    [...menu.querySelectorAll('.fn-ac-item')].forEach((el, i) => el.onmousedown = e => { e.preventDefault(); input.value = m[i]; menu.style.display = 'none'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  input.addEventListener('focus', async () => { data = await userRepos(t); show(); });
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 200));
}

// Line-number gutter for the shell's left margin (code-editor motif; purely decorative).
const GUTTER = Array.from({ length: 18 }, (_, i) => `<span>${i + 1}</span>`).join('');

// Creator credit + contact — Footnote's own authorship (global product identity, not the adopter's data).
const IC_MAIL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>`;
const IC_GH = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const IC_ISSUE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/></svg>`;
const FOOTER = `<footer class="fn-foot">
  <span class="fn-cred">Footnote · Built by <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener">@mattlmccoy</a></span>
  <span class="fn-foot-links">
    <a href="mailto:mail@matthewmccoy.info" title="Email" aria-label="Email">${IC_MAIL}</a>
    <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub profile">${IC_GH}</a>
    <a href="https://github.com/mattlmccoy/footnote/issues" target="_blank" rel="noopener" title="Report an issue" aria-label="Report an issue">${IC_ISSUE}</a>
  </span>
</footer>`;

// First-run progress: the 3 setup steps with the current one highlighted (idx = 0-based current step).
const stepperHtml = idx => `<div class="fn-steps">${ONBOARD_STEPS
  .map((s, i) => `<span class="fn-stepx ${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}"><b>${i + 1}</b>${esc(s)}</span>`)
  .join('<i class="fn-stepsep">→</i>')}</div>`;

export async function launch() {
  const cfg = await loadConfig();
  const root = document.getElementById('app') || document.body;
  const tok = () => localStorage.getItem(TOK_KEY);
  const overleafToken = () => localStorage.getItem(OVL_KEY);
  const setOverleafToken = (v) => localStorage.setItem(OVL_KEY, v);
  const hub = () => localStorage.getItem(HUB_KEY) || cfg.hubRepo || '';

  // Auto-connect: once the account Overleaf token is saved (Settings), seal it into a newly linked document's
  // repo so linking any doc needs no manual "Seal token" step. Best-effort — a seal failure NEVER blocks the
  // link (wrapped in try/catch). No-ops when no token is saved (backward-compatible: the manual per-project
  // seal still works) or when `repo` is already sealed. The token is only ever passed to putSecret as a sealed
  // value; it is never logged (console.warn carries only the error message, never the token).
  async function ensureOverleafTokenSealed(repo) {
    const val = overleafToken();
    if (!val || !repo) return;
    try {
      const appCfg = { ...cfg, hubRepo: hub(), workspaceRepo: hub() };
      // undefined = the account load FAILED (transient/403/5xx) → baseline unknown; null = genuinely no account
      // yet (a fresh one is the correct baseline); object = loaded.
      const account = await loadAccount(appCfg, tok());
      const loadFailed = account === undefined;
      // Sealing the secret is the primary goal — do it whenever the repo isn't known to be sealed. On a failed
      // load we can't know what's sealed, so treat the baseline as empty (null) for the guard and just re-seal
      // (idempotent PUT — harmless). We must NOT record it, though: rewriting account.json from an unknown
      // baseline would wipe the user's workspaces + prior sealedRepos.
      if (!needsOverleafSeal(repo, loadFailed ? null : account)) return;   // already sealed → nothing to do
      const pk = await getPublicKey(tok(), repo);
      await putSecret(tok(), pk, sealToBase64, 'OVERLEAF_TOKEN', val, repo);
      if (loadFailed) return;                                             // sealed, but never write from unknown baseline
      const next = withSealedRepo(account, repo);                        // account is null (no-account) or a loaded object
      if (!next.overleaf.setAt) next.overleaf.setAt = new Date().toISOString();
      await writeAccount(appCfg, next, tok());
    } catch (e) { console.warn('overleaf auto-seal:', e.message); }
  }
  document.documentElement.style.setProperty('--accent', cfg.brand.accent);

  // Derive the real GitHub username from the token so defaults aren't the "your-github-username"
  // placeholder, and grab the display name + avatar for the greeting. Runs at launch + after connect.
  let _ownerFetched = false;
  let _user = {};   // { login, name, avatar }
  async function refreshOwner() {
    const t = tok(); if (!t || _ownerFetched) return;
    try {
      const u = await (await fetch(`${API}/user`, { headers: hdr(t) })).json();
      if (u && u.login) { cfg.owner = u.login; _user = { login: u.login, name: u.name, avatar: u.avatar_url }; _ownerFetched = true; }
    } catch {}
  }
  await refreshOwner();

  function frame(inner, opts = {}) {
    const avatar = _user.avatar ? `<img class="fn-avatar" src="${esc(_user.avatar)}" alt="" referrerpolicy="no-referrer">` : '';
    const gear = opts.settings ? `<button class="fn-link fn-gear" id="fn-settings" title="Settings" aria-label="Account settings">⚙</button>` : '';
    const userbar = opts.signout ? `<div class="fn-userbar">
        ${avatar}<span class="fn-hi">Hi, ${esc(greetName(_user))}</span>
        <a class="fn-link" href="tutorials/index.html">Help</a>
        ${gear}
        <button class="fn-link" id="fn-signout">Disconnect</button>
      </div>` : '';
    root.innerHTML = `<div class="fn-shell">
      <header class="fn-top">
        <span class="fn-brand">${MARK(cfg.brand.accent)}<span class="fn-word">${esc(cfg.brand.name)}</span></span>
        ${userbar}
      </header>
      <main class="fn-main"><div class="fn-rule" aria-hidden="true">${GUTTER}</div>${inner}</main>
      ${FOOTER}
    </div>`;
    const so = document.getElementById('fn-signout');
    if (so) so.onclick = () => { localStorage.removeItem(TOK_KEY); render(); };
    const gs = document.getElementById('fn-settings');
    if (gs) gs.onclick = () => renderAccountSettings();
  }

  function connect() {
    frame(`<style>
      .fn-shell{max-width:1160px}
      .fn-split{display:grid;grid-template-columns:minmax(0,1fr) 520px;gap:54px;align-items:center;margin-top:8px}
      .fn-split .fn-lead{max-width:32em}
      .fn-vid{display:block;position:relative;width:520px;aspect-ratio:16/10;border-radius:16px;overflow:hidden;border:1px solid var(--line);box-shadow:0 34px 80px -26px rgba(20,24,48,.55);background:#0c0f1e;text-decoration:none}
      .fn-vid iframe{position:absolute;top:0;left:0;width:1300px;height:812px;border:0;transform:scale(.4);transform-origin:top left;pointer-events:none}
      .fn-vid-badge{position:absolute;left:13px;bottom:13px;z-index:2;display:inline-flex;align-items:center;gap:7px;background:rgba(12,15,30,.62);color:#fff;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:22px;backdrop-filter:blur(4px);transition:background .15s}
      .fn-vid:hover .fn-vid-badge{background:#2c64c4}
      .fn-vid-badge .pg{display:inline-flex;width:17px;height:17px;border-radius:50%;background:#fff;color:#2c64c4;align-items:center;justify-content:center;font-size:8px;padding-left:1px}
      @media(max-width:960px){ .fn-shell{max-width:880px} .fn-split{grid-template-columns:1fr} .fn-vid-col{display:none} }
    </style>
    <div class="fn-hero fn-reveal">
      ${stepperHtml(0)}
      <div class="fn-split">
        <div class="fn-split-l">
          <h1 class="fn-h1">Margin notes for<br><em>native-LaTeX</em> writing.</h1>
          <p class="fn-lead">A clean reading surface for your document, comments and suggested edits from your reviewers, and clean exports — running entirely on your GitHub. No server.</p>
          <div class="fn-card">
            <div class="fn-step">Connect GitHub</div>
            <label class="fn-field">Owner key <span class="fn-sub">your GitHub token — must include your <b>private</b> repos</span><span class="fn-term"><span class="fn-termsig">❯</span><input id="fn-tok" type="password" placeholder="ghp_… or github_pat_…" autocomplete="off"></span></label>
            <p class="fn-hint fn-trust">Runs in your browser against your own GitHub — the token is stored only here and sent only to GitHub, never to us.</p>
            <details class="fn-help">
              <summary>How do I get a token?</summary>
              <div class="fn-help-body">
                <p><a href="${TOKEN_URL}" target="_blank" rel="noopener">Classic token →</a> <span class="fn-help-tag">recommended · one click</span><br>
                  <span class="fn-sub">The link pre-selects <code>repo</code> + <code>workflow</code> — the correctly-scoped Owner key in one click. Covers everything Footnote does (comments, rendering, AI, email, exports). Broader, but the simplest working path.</span></p>
                <p><a href="${FG_URL}" target="_blank" rel="noopener">Fine-grained token →</a> <span class="fn-help-tag">least privilege</span><br>
                  <span class="fn-sub"><b>Repository access: All repositories</b>, then set ${OWNER_FG_LIST} to <b>Read and write</b>. Scopes Footnote to exactly what it needs, but GitHub can’t pre-fill this page — set each permission by hand.</span></p>
                <p class="fn-sub">New to wiring up Overleaf, GitHub, and Footnote? <a href="tutorials/setup.html" target="_blank" rel="noopener">Step-by-step setup guide →</a></p>
              </div>
            </details>
            <div class="fn-err" id="fn-err"></div>
            <button class="fn-btn fn-btn-primary" id="fn-go">Connect</button>
          </div>
        </div>
        <div class="fn-vid-col">
          <a class="fn-vid" href="tutorials/walkthrough.html" title="Watch the full walkthrough">
            <iframe src="tutorials/walkthrough.html?embed=1" title="Footnote walkthrough" loading="lazy" scrolling="no" tabindex="-1"></iframe>
            <span class="fn-vid-badge"><span class="pg">▶</span>Watch the 90-second walkthrough</span>
          </a>
        </div>
      </div>
    </div>`);
    const go = async () => { const v = document.getElementById('fn-tok').value.trim();
      if (!v) { document.getElementById('fn-err').textContent = 'Paste your token to continue.'; return; }
      localStorage.setItem(TOK_KEY, v); _ownerFetched = false; await refreshOwner(); render(); };
    document.getElementById('fn-go').onclick = go;
    document.getElementById('fn-tok').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  function setupWorkspace() {
    frame(`<div class="fn-hero fn-reveal">
      ${stepperHtml(1)}
      <h1 class="fn-h1">Set up your <em>workspace</em>.</h1>
      <p class="fn-lead">This one private repo is your whole Footnote workspace. It keeps your projects, their documents, and every comment together, one folder per project. Create it now, or choose one you already have.</p>
      <div class="fn-card">
        <div class="fn-step">Workspace repo</div>
        <label class="fn-field">Repository name <span class="fn-sub">one private repo, e.g. footnote-projects</span><input id="fn-hub" value="${esc(defaultHubRepo(cfg))}" spellcheck="false"></label>
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

  // One face-out book on the shelf. `i` is the project's position in the FULL list so the spine color stays
  // stable regardless of which workspace group it renders under. Markup is unchanged from the flat shelf;
  // the storage/Overleaf badges are additive.
  function bookCard(p, i) {
    // Show WHERE the LaTeX lives (source), not the comments repo — that's what identifies a document
    // on the shelf. projectStorage reports it honestly for every shape (uploaded / external / workspace).
    const st = projectStorage({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, p);
    const srcLine = st.source.mode === 'uploaded'
      ? (st.source.inWorkspace ? 'uploaded · in workspace' : `uploaded · ${st.source.repo}`)
      : (st.source.repo ? st.source.repo : 'no source yet');
    const sb = storageBadge(st.source.inWorkspace ? 'shared' : 'individual');
    const ol = p.overleaf ? `<span class="fn-badge fn-badge-ol" title="Overleaf-linked">🔗 Overleaf</span>` : '';
    const badges = `<span class="fn-book-badges"><span class="fn-badge fn-badge-${sb.kind}" title="${esc(sb.label)}">${sb.glyph} ${esc(sb.label)}</span>${ol}</span>`;
    return `<a class="fn-book fn-reveal" style="--i:${i};--spine:${spineColor(i)}" href="${projectHref(cfg, p.id)}">
        <span class="fn-book-spine"></span>
        <button class="fn-book-manage" data-mid="${esc(p.id)}" title="Manage project" aria-label="Manage ${esc(p.name)}">⋯</button>
        <span class="fn-book-type">${esc(texFileName(p.doc.noun).replace(/\.tex$/, ''))}<span class="fn-ext">.tex</span></span>
        <span class="fn-book-title">${esc(p.name)}</span>
        <span class="fn-book-repo" title="source">${esc(srcLine)}</span>
        ${badges}
        <span class="fn-book-go">open</span></a>`;
  }

  async function projects() {
    frame(`<div class="fn-loading fn-reveal">Loading your library…</div>`, { signout: true });
    let list = [];
    try { list = await loadProjects({ ...cfg, hubRepo: hub() }, tok()); } catch {}
    // Account-level config (workspaces list). Absent (404 → null) for existing users, which groups the whole
    // list into ONE default workspace → isOnlyGroup=true → the flat shelf renders exactly as before.
    const account = await loadAccount({ ...cfg, hubRepo: hub() }, tok()).catch(() => null);
    // The grouping label lives in the DEDICATED string field `workspaceLabel` (read by groupByWorkspace),
    // distinct from `project.workspace` (the storage boolean read by projectStorage). No projection needed:
    // pass the real list. `i` is the project's position in the full list so spine colors stay stable.
    const card = p => bookCard(p, list.indexOf(p));
    const groups = groupByWorkspace(list, account);
    // "Add a book" tile — the flat (single-group) shelf keeps today's exact tile (id=fn-new); grouped shelves
    // get one per group, carrying data-ws so New Project can default to that workspace (M4).
    const flatAddTile = `<button class="fn-book fn-book-new fn-reveal" style="--i:${list.length}" id="fn-new">
        <span class="fn-book-plus">＋</span><span class="fn-book-newlabel"><span class="bs">\\</span>newproject</span><span class="fn-book-newhint">start a document</span></button>`;
    const groupAddTile = ws => `<button class="fn-book fn-book-new fn-reveal fn-book-new-ws" style="--i:${list.length}" data-ws="${esc(ws)}">
        <span class="fn-book-plus">＋</span><span class="fn-book-newlabel"><span class="bs">\\</span>newproject</span><span class="fn-book-newhint">start a document</span></button>`;
    // Single group (existing user / one workspace): the flat shelf, byte-compatible with today (no headers).
    const shelfHtml = groups.length === 1
      ? `<div class="fn-shelf">${groups[0].docs.map(card).join('')}${flatAddTile}</div><div class="fn-shelf-board"></div>`
      : groups.map(g => {
          const cards = g.docs.map(card).join('');
          const header = `<div class="fn-wshead"><span class="fn-wsname">${esc(g.name)}</span><span class="fn-wscount">${g.docs.length} doc${g.docs.length === 1 ? '' : 's'}</span></div>`;
          return `${header}<div class="fn-shelf">${cards}${groupAddTile(g.name)}</div><div class="fn-shelf-board"></div>`;
        }).join('');
    frame(`<div class="fn-head fn-reveal"><span class="fn-eyebrow">Your library</span><h1 class="fn-h1">Documents in review</h1></div>
      ${list.length
        ? shelfHtml
        : `${stepperHtml(2)}<div class="fn-empty fn-reveal"><div class="fn-empty-mark">${MARK(cfg.brand.accent)}</div>
             <h2 class="fn-empty-h">Your shelf is empty</h2>
             <p class="fn-empty-p">Point Footnote at a LaTeX or Word document and invite your reviewers. It becomes the first book on your shelf.</p>
             <button class="fn-btn fn-btn-primary" id="fn-new2">Add your first document</button></div>`}
      <div class="fn-ws">Workspace <span class="fn-mono">${esc(hub())}</span> · <button class="fn-link" id="fn-chg">change</button></div>`, { signout: true, settings: true });
    const open = (preWs = '') => projectSheet(list, null, account, preWs);
    ['fn-new', 'fn-new2'].forEach(id => { const b = document.getElementById(id); if (b) b.onclick = () => open(''); });
    // Per-group new-document tiles (grouped shelves) also open New Project, preselecting THAT group (data-ws).
    root.querySelectorAll('.fn-book-new-ws').forEach(b => { b.onclick = () => open(b.getAttribute('data-ws') || ''); });
    document.getElementById('fn-chg').onclick = () => { localStorage.removeItem(HUB_KEY); render(); };
    // per-book manage menu (Edit / Remove / Move). The ⋯ button must not open the project.
    list.forEach(p => {
      const mb = root.querySelector(`.fn-book-manage[data-mid="${cssId(p.id)}"]`);
      if (mb) mb.onclick = e => { e.preventDefault(); e.stopPropagation(); openManageMenu(mb, p, list, account); };
    });
  }

  function cssId(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  function closeManageMenu() { const m = document.getElementById('fn-menu'); if (m) m.remove(); }
  function openManageMenu(anchor, project, list, account) {
    closeManageMenu();
    const menu = document.createElement('div'); menu.className = 'fn-menu'; menu.id = 'fn-menu';
    // Legacy projects (own repos) can be folded into the one workspace repo; workspace projects can't re-migrate.
    // NB: `project.workspace` here is the STORAGE boolean (consolidated-repo flag), NOT the grouping label.
    const canMigrate = !project.workspace && hub() && project.dataRepo && project.dataRepo !== hub();
    menu.innerHTML = `<button class="fn-menu-item" data-act="edit">Edit details</button>
      <button class="fn-menu-item" data-act="move">Move to workspace ▸</button>
      ${canMigrate ? `<button class="fn-menu-item" data-act="migrate">Move into workspace repo</button>` : ''}
      <button class="fn-menu-item fn-menu-danger" data-act="remove">Remove from library</button>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.querySelector('[data-act="edit"]').onclick = () => { closeManageMenu(); projectSheet(list, project); };
    // stopPropagation: showMoveTargets rebuilds this menu's innerHTML in place, which detaches the clicked
    // button; without this the document-level outside-click handler would then see a detached target and
    // close the menu before the targets pane is visible.
    menu.querySelector('[data-act="move"]').onclick = e => { e.stopPropagation(); showMoveTargets(menu, project, list, account); };
    menu.querySelector('[data-act="remove"]').onclick = () => { closeManageMenu(); confirmRemove(list, project); };
    if (canMigrate) menu.querySelector('[data-act="migrate"]').onclick = () => { closeManageMenu(); confirmMigrate(list, project); };
  }

  // Second pane of the manage menu: pick a workspace to move this document into. The grouping label is
  // persisted to the DEDICATED `workspaceLabel` field (never `project.workspace`, the storage boolean), so a
  // move only re-groups the card — it never changes where the document's repos/comments live.
  function showMoveTargets(menu, project, list, account) {
    const names = workspaceNames(list, account);
    const def = defaultWorkspaceName(account, hub());
    const current = typeof project.workspaceLabel === 'string' ? project.workspaceLabel.trim() : '';
    const row = (label, value, isCurrent) =>
      `<button class="fn-menu-item${isCurrent ? ' fn-menu-cur' : ''}" data-mv="${esc(value)}"${isCurrent ? ' disabled' : ''}>${isCurrent ? '✓ ' : ''}${esc(label)}</button>`;
    const items = [row(def, '', current === '')]
      .concat(names.map(n => row(n, n, current === n)))
      .concat([`<button class="fn-menu-item fn-menu-new" data-mv-new="1">＋ New workspace…</button>`]);
    menu.innerHTML = `<div class="fn-menu-head">Move to workspace</div>${items.join('')}`;
    const doMove = async (name, isNew) => {
      closeManageMenu();
      try {
        if (isNew) {
          const raw = (prompt('New workspace name:') || '').trim();
          if (!raw) return render();
          name = raw;
          const next = addWorkspace(account, name);
          await writeAccount({ ...cfg, hubRepo: hub() }, next, tok());
        }
        // moveDocPatch returns { workspaceLabel } — the grouping label only; the storage boolean is untouched.
        await writeProjectPatch({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, project.id, moveDocPatch(name), tok());
        render();
      } catch (e) { console.warn('move:', e.message); render(); }
    };
    menu.querySelectorAll('[data-mv]').forEach(b => { if (!b.disabled) b.onclick = () => doMove(b.getAttribute('data-mv'), false); });
    const nb = menu.querySelector('[data-mv-new]'); if (nb) nb.onclick = () => doMove('', true);
  }

  // Copy a legacy project's own source + data repos INTO the one workspace repo under <id>/, then flip it
  // to workspace mode. Non-destructive: the old repos stay on GitHub (nothing is deleted).
  function confirmMigrate(list, project) {
    const wsRepo = hub();
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">Move “${esc(project.name)}” into your workspace</div>
      <p class="fn-remove-note">This copies this project's files into <span class="fn-mono">${esc(wsRepo)}</span> under <span class="fn-mono">${esc(project.id)}/</span> and switches it to the consolidated layout — no more separate repos for it. Your existing repos <span class="fn-mono">${esc(project.dataRepo)}</span>${project.sourceRepo ? ` and <span class="fn-mono">${esc(project.sourceRepo)}</span>` : ''} are left untouched on GitHub (nothing is deleted); you can remove them yourself later.</p>
      <div class="fn-err" id="mg-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="mg-x">Cancel</button><button class="fn-btn fn-btn-primary" id="mg-go">Move into workspace</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#mg-x').onclick = close;
    q('#mg-go').onclick = async () => {
      const err = q('#mg-err'); q('#mg-go').disabled = true;
      try {
        err.textContent = `Preparing ${wsRepo}…`;
        await createRepo(tok(), wsRepo);   // ensure the workspace repo exists
        try { await seedDataRepo(wsRepo, tok(), undefined, undefined, `${project.id}/`); } catch (e) { console.warn('seed:', e.message); }
        await migrateProjectToWorkspace(project, wsRepo, tok(), msg => { err.textContent = msg; });
        err.textContent = 'Switching to the workspace layout…';
        await writeProjectPatch({ ...cfg, hubRepo: wsRepo, workspaceRepo: wsRepo }, project.id, { workspace: true, dataRepo: wsRepo, sourceRepo: '' }, tok());
        close(); render();
      } catch (e) { err.textContent = e.message; q('#mg-go').disabled = false; }
    };
  }

  // One sheet for both New (existing=null) and Edit. On edit the comments repo is read-only (it's the
  // project's identity + holds all existing comments) and no repo is created/seeded — only projects.json changes.
  function projectSheet(list, existing, account, preWs) {
    if (existing) return editProjectSheet(list, existing);
    return newProjectSheet(list, account, preWs);
  }

  // Edit: rename, repoint the source repo, change the noun. Never creates/seeds repos; the comments repo
  // is the project's identity and stays fixed.
  function editProjectSheet(list, v) {
    // Where does this project's source actually live? An uploaded (workspace or dedicated) project has no
    // external source repo to type — showing an empty text box reads as broken. Branch on the real mode.
    const stor = projectStorage({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, v);
    const uploadedSrc = stor.source.mode === 'uploaded';
    const srcField = uploadedSrc
      ? `<div class="fn-field"><span class="fn-field-lbl">Your document's source</span>
           <div class="fn-src-static" style="padding:4px 0;color:var(--ink)">Uploaded ${stor.source.inWorkspace ? `into your workspace (<span class="fn-mono">${esc(stor.source.prefix)}</span>)` : `to <span class="fn-mono">${esc(stor.source.repo)}</span>`}</div>
           <button type="button" class="fn-link" id="np-src-ext">Point at an external repo instead</button>
           <input id="np-src" type="hidden" value=""></div>`
      : `<label class="fn-field">Your document's source repo <span class="fn-sub">the LaTeX you're reviewing (a GitHub repo, Overleaf-synced or not). Read-only; never edited here.</span><input id="np-src" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false" value="${esc(stor.source.repo || '')}"></label>`;
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">Edit project</div>
      <label class="fn-field">Project name<input id="np-name" placeholder="My Thesis" spellcheck="false" value="${esc(v.name)}"></label>
      ${srcField}
      <label class="fn-field">Comments repo <span class="fn-sub">where this project’s comments live — fixed once created</span><input id="np-data" value="${esc(stor.data.repo || '')}" disabled></label>
      <label class="fn-field">What is it? <span class="fn-sub">the word for the whole document</span><input id="np-noun" value="${esc((v.doc && v.doc.noun) || 'thesis')}" spellcheck="false"></label>
      ${v.workspace ? `<div class="fn-ovl" style="border-top:1px solid var(--line,#e2e7f0);margin-top:14px;padding-top:13px">
        <div class="fn-field-lbl" style="display:flex;align-items:center;gap:7px">🔗 Overleaf sync <span class="fn-sub" style="font-weight:400">edit in Overleaf, review here — bidirectional</span></div>
        <div id="ovl-conflict"></div>
        <div style="display:flex;gap:9px">
          <label class="fn-field" style="flex:1">Overleaf project ID <span class="fn-sub">from your project's Git/URL</span><input id="ovl-id" placeholder="62a1f9c4b8e2…" spellcheck="false"></label>
          <label class="fn-field" style="width:96px">Branch<input id="ovl-branch" value="main" spellcheck="false"></label>
        </div>
        <div class="fn-hint" id="ovl-hint"></div>
        <div class="fn-actions" style="justify-content:flex-start;gap:9px;flex-wrap:wrap;margin-top:4px">
          <button type="button" class="fn-btn" id="ovl-save">Save Overleaf link</button>
          <button type="button" class="fn-btn" id="ovl-token">Seal token</button>
          <button type="button" class="fn-btn fn-btn-primary" id="ovl-pull">Pull from Overleaf</button>
        </div>
        <div class="fn-hint" id="ovl-status"></div>
      </div>` : ''}
      <div class="fn-err" id="np-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="np-x">Cancel</button><button class="fn-btn fn-btn-primary" id="np-save">Save changes</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    if (!uploadedSrc) attachRepoPicker(q('#np-src'), tok());
    // "Point at an external repo instead": swap the read-only line for an editable picker. The uploaded copy
    // under <id>/source/ is kept; only project.sourceRepo changes, which repoints resolveProject at the repo.
    const ext = q('#np-src-ext');
    if (ext) ext.onclick = () => {
      const field = ext.closest('.fn-field');
      field.innerHTML = `Your document's source repo <span class="fn-sub">points Footnote at an external repo; your uploaded copy is kept.</span><input id="np-src" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false" value="">`;
      attachRepoPicker(q('#np-src'), tok());
      q('#np-src').focus();
    };
    if (v.workspace) wireOverleafSection(q, v);
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-x').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), noun = q('#np-noun').value.trim() || 'document';
      const srcVal = (q('#np-src').value || '').trim();
      if (!name) return q('#np-err').textContent = 'Name is required.';
      try {
        q('#np-save').disabled = true; q('#np-err').textContent = 'Saving…';
        // For an uploaded project, an empty field means "leave the uploaded source as-is" — only patch
        // sourceRepo when the user actually typed an external repo (or the project was already external).
        const patch = { name, doc: { noun } };
        if (srcVal || !uploadedSrc) patch.sourceRepo = srcVal;
        await writeProjects(hub(), tok(), updateProject(list, v.id, patch));
        close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
    setTimeout(() => q('#np-name').focus(), 30);
  }

  // Overleaf Tier-2 controls inside the Edit sheet (workspace projects only): link the project to its
  // Overleaf git-bridge id, seal the shared OVERLEAF_TOKEN, pull, and surface a conflict. All owner-token
  // ops on the workspace repo under <id>/. The sync engine is document-agnostic; this is just its console.
  function wireOverleafSection(q, v) {
    const wsRepo = v.dataRepo || hub();
    const ost = (msg, err) => { const s = q('#ovl-status'); if (!s) return; s.textContent = msg; s.style.color = err ? 'var(--danger,#c0392b)' : 'var(--muted,#5c6675)'; };
    const ovlHint = () => { const id = q('#ovl-id').value.trim(); q('#ovl-hint').innerHTML = id
      ? `Bridge <span class="fn-mono">${esc(bridgeUrlHint(id))}</span> · token sealed as <span class="fn-mono">OVERLEAF_TOKEN</span>`
      : 'Paste your Overleaf project id, seal your token, then Pull.'; };
    const readWs = async (path) => {
      try {
        const r = await fetch(`https://api.github.com/repos/${wsRepo}/contents/${v.id}/${path}`,
          { headers: { Authorization: `Bearer ${tok()}`, Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
        return r.ok ? JSON.parse(await r.text()) : null;
      } catch (e) { return null; }
    };
    q('#ovl-id').addEventListener('input', ovlHint); ovlHint();
    readWs('overleaf.json').then(m => { if (m) { q('#ovl-id').value = m.projectId || ''; q('#ovl-branch').value = m.branch || 'main'; ovlHint(); } });
    readWs('overleaf_conflict.json').then(c => { const sum = conflictSummary(c); if (sum) q('#ovl-conflict').innerHTML =
      `<div class="fn-hint" style="color:var(--warn,#b7791f)">⚠ ${esc(sum)} — Overleaf's version is on <span class="fn-mono">overleaf-sync/${esc(v.id)}</span>; your source is untouched.</div>`; });

    q('#ovl-save').onclick = async () => {
      const id = q('#ovl-id').value.trim(); if (!id) return ost('Enter your Overleaf project id first.', true);
      try { q('#ovl-save').disabled = true; ost('Saving Overleaf link…');
        await commitSourceFile(wsRepo, `${v.id}/overleaf.json`, JSON.stringify(overleafMarker(id, q('#ovl-branch').value), null, 2), tok(), `overleaf: link ${v.id}`);
        // Also record project.overleaf on the project list so the 🔗 badge + account seal-targets recognize
        // this B2 (edit-sheet) linkage uniformly with B1 (New Project "In Overleaf"). Additive: the file
        // marker above (which ci_overleaf.py needs) is untouched; this only mirrors it into projects.json.
        await writeProjectPatch({ ...cfg, hubRepo: hub(), workspaceRepo: hub() }, v.id, { overleaf: overleafMarker(id, q('#ovl-branch').value) }, tok());
        // If the account Overleaf token is already saved, auto-seal it into this doc's repo (no manual step).
        await ensureOverleafTokenSealed(wsRepo);
        ost(overleafToken() ? 'Linked and connected — your saved token is sealed here. Pull when ready.' : 'Linked. Seal your token, then Pull.');
      } catch (e) { ost(e.message, true); } finally { q('#ovl-save').disabled = false; }
    };
    q('#ovl-token').onclick = async () => {
      const val = (prompt('Paste your Overleaf git-bridge token (Overleaf → Account → Git integration). It is sealed into your repo secrets and never shown again.') || '').trim();
      if (!val) return;
      try { ost('Sealing token…'); const pk = await getPublicKey(tok()); await putSecret(tok(), pk, sealToBase64, 'OVERLEAF_TOKEN', val); ost('Token sealed as OVERLEAF_TOKEN.'); }
      catch (e) { ost(e.code === 'NOSCOPE' ? 'Your key needs Secrets: write to seal this (Settings → Access).' : e.message, true); }
    };
    q('#ovl-pull').onclick = async () => {
      try { q('#ovl-pull').disabled = true; ost('Preparing the sync workflow…');
        await ensureOverleafPipeline(wsRepo, tok());
        ost('Pulling from Overleaf…'); await dispatchOverleaf(tok(), v.id, false);
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 2500));
          const run = await overleafRun(tok()).catch(() => null);
          if (run && run.status === 'completed') return ost(run.conclusion === 'success' ? 'Synced — the reading view will rebuild.' : 'Sync finished: ' + run.conclusion, run.conclusion !== 'success');
          if (run) ost('Sync running…');
        }
        ost('Sync dispatched — see Actions for progress.');
      } catch (e) { ost(e.message === 'workflow-scope' ? 'Your key needs Workflows: write to run this (regenerate with repo+workflow).' : e.message, true); }
      finally { q('#ovl-pull').disabled = false; }
    };
  }

  // New project onboarding, organized around "Where's your writing?" so a beginner with a local file never
  // has to know what a repo is. Both repos are auto-named from the project name; power users override under
  // Advanced. mode='local' uploads a .tex (Footnote creates the repo + commits it); 'github'/'overleaf'
  // point at an existing repo.
  function newProjectSheet(list, account, preWs) {
    let mode = 'local', style = 'workspace', pendingTex = null, pendingFiles = null, detectedLevel = null;
    const wsRepo = hub();   // ONE workspace repo holds every project as a subfolder — no per-paper repos
    // Workspace picker: the offered names + the default group. `preWs` (the ＋ tile's data-ws) is preselected.
    // The picked value is the GROUPING label written to `workspaceLabel` at save — NEVER the storage boolean.
    const wsNames = workspaceNames(list, account);
    const wsDefault = defaultWorkspaceName(account, hub());
    let acct = account;   // may gain a workspace via "New workspace…" during save
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">New project</div>
      <label class="fn-field">Project name<input id="np-name" placeholder="My Thesis" spellcheck="false"></label>
      ${workspacePickerHtml({ names: wsNames, def: wsDefault, preWs })}
      ${storageControlHtml()}
      <div class="fn-field-lbl" style="margin-top:14px">Where's your writing?</div>
      <div class="fn-seg" id="np-modes">
        <button type="button" class="fn-seg-b on" data-mode="local">On my computer</button>
        <button type="button" class="fn-seg-b" data-mode="github">In a GitHub repo</button>
        <button type="button" class="fn-seg-b" data-mode="overleaf">In Overleaf</button>
      </div>
      <div id="np-panel"></div>
      <label class="fn-field">What is it? <span class="fn-sub">the word for the whole document</span><input id="np-noun" value="thesis" spellcheck="false"></label>
      <div class="fn-hint" id="np-store-hint"></div>
      <div class="fn-err" id="np-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="np-x">Cancel</button><button class="fn-btn fn-btn-primary" id="np-save">Create project</button></div></div>`;
    root.appendChild(scrim);
    wireStorageInfo(scrim);   // the storage ⓘ toggles reveal the approved copy
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    const slugPreview = () => projectIdFromName((q('#np-name') && q('#np-name').value.trim()) || 'project');
    const renderPanel = () => {
      const p = q('#np-panel');
      if (mode === 'local') {
        const srcDest = style === 'workspace' ? `${slugPreview()}/source/` : `${slugPreview()}-source`;
        p.innerHTML = `<label class="fn-drop"><i class="ti ti-folder"></i> <span id="np-folder-name">Upload your whole project folder</span><input id="np-folder" type="file" webkitdirectory directory multiple style="display:none"></label>
          <div class="fn-hint">Brings your figures + <code>.bib</code> along — committed under <code>${esc(srcDest)}</code>, so it renders complete. Or just a <label style="cursor:pointer;text-decoration:underline" for="np-tex">single .tex file</label>. <code>.docx</code> support is coming.
          <input id="np-tex" type="file" accept=".tex" style="display:none"></div>
          <div id="np-local-status" class="fn-hint"></div>`;
        q('#np-folder').onchange = async e => {
          const picked = [...e.target.files]; if (!picked.length) return;
          pendingTex = null; pendingFiles = null; detectedLevel = null;
          const st = q('#np-local-status'); st.textContent = `Reading ${picked.length} files…`; q('#np-err').textContent = '';
          try {
            const MAX = 40 * 1024 * 1024; let skipped = 0; const files = [];
            for (const f of picked) {
              const rel = stripTopFolder(f.webkitRelativePath || f.name);
              if (/(^|\/)\./.test(rel)) continue;                 // skip dotfiles / .git
              if (f.size > MAX) { skipped++; continue; }
              if (isTextPath(rel)) files.push({ path: rel, isText: true, text: await f.text() });
              else { const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]); files.push({ path: rel, isText: false, base64: btoa(bin) }); }
            }
            const { entry, entryText, map } = folderTexIndex(files);
            if (!entry) { st.textContent = ''; q('#np-err').textContent = 'No .tex file found in that folder.'; return; }
            pendingFiles = { files, entry, entryText, map };
            detectedLevel = detectUnitLevel(entryText, pth => (pth in map ? map[pth] : null));
            const nfig = files.filter(f => !f.isText).length;
            q('#np-folder-name').textContent = `${files.length} files · entry ${entry}`;
            st.innerHTML = `Ready: <b>${files.length}</b> files${nfig ? `, ${nfig} figure${nfig !== 1 ? 's' : ''}` : ''}${skipped ? `; ${skipped} skipped >40&nbsp;MB` : ''}.`;
          } catch (err) { st.textContent = ''; q('#np-err').textContent = 'Could not read the folder: ' + err.message; }
        };
        q('#np-tex').onchange = async e => {
          const f = e.target.files[0]; if (!f) return;
          if (importFormat(f.name) !== 'tex') { q('#np-err').textContent = 'Please choose a .tex file (.docx is coming soon).'; return; }
          pendingFiles = null; detectedLevel = null;
          pendingTex = { name: f.name, text: await f.text() }; q('#np-folder-name').textContent = f.name;
          q('#np-local-status').textContent = 'Single file — no figures. Use a folder to include them.'; q('#np-err').textContent = '';
        };
      } else {
        pendingTex = null; pendingFiles = null; detectedLevel = null;
        const overleaf = mode === 'overleaf';
        // Overleaf's native GitHub sync is one project ↔ one repo at the ROOT. That maps onto the independent
        // style (Overleaf keeps a dedicated repo current, Footnote re-renders on each push). In the workspace
        // style source must land in a subfolder Overleaf can't push to, so it's ZIP/folder re-import today.
        const overleafHint = style === 'independent'
          ? `In Overleaf: <b>Menu → GitHub → Sync</b> to a new repo, then pick it here. Overleaf keeps that repo updated and Footnote re-renders on each sync <span class="fn-sub">(needs Overleaf premium GitHub sync)</span>.`
          : `In Overleaf: <b>Menu → Download</b> your project, then upload the folder under <b>On my computer</b>. Automatic live sync into a workspace is coming; for live sync now, choose <b>Its own repos</b> above.`;
        const commentsWhere = style === 'workspace' ? 'the workspace' : 'this document’s own comments repo';
        p.innerHTML = `${overleaf ? `<div class="fn-hint">${overleafHint}</div>` : ''}
          <label class="fn-field">${overleaf ? 'Your synced GitHub repo' : 'Pick the repo with your LaTeX'}<input id="np-pick" placeholder="${esc(cfg.owner)}/your-latex-repo" spellcheck="false"></label>
          <div class="fn-hint">Footnote reads it (never edits it); your comments live in ${commentsWhere}.</div>`;
        attachRepoPicker(q('#np-pick'), tok());
      }
    };
    const storeHint = () => {
      const slug = slugPreview();
      q('#np-store-hint').innerHTML = style === 'workspace'
        ? `Lives in your workspace repo <span class="fn-mono">${esc(wsRepo)}</span> under <span class="fn-mono">${esc(slug)}/</span> — no new repo per paper.`
        : `Creates <span class="fn-mono">${esc(slug)}-footnote-data</span> for comments${mode === 'local' ? ` and <span class="fn-mono">${esc(slug)}-source</span> for your LaTeX` : ''}, just for this document.`;
    };
    q('#np-modes').querySelectorAll('.fn-seg-b').forEach(b => b.onclick = () => {
      if (mode === b.dataset.mode) return;
      mode = b.dataset.mode;
      q('#np-modes').querySelectorAll('.fn-seg-b').forEach(x => x.classList.toggle('on', x === b));
      renderPanel(); storeHint();
    });
    q('#np-style').querySelectorAll('.fn-seg-b').forEach(b => b.onclick = () => {
      if (style === b.dataset.style) return;
      style = b.dataset.style;
      q('#np-style').querySelectorAll('.fn-seg-b').forEach(x => x.classList.toggle('on', x === b));
      renderPanel(); storeHint();   // panel hints (Overleaf copy, commit destination) depend on style
    });
    q('#np-name').addEventListener('input', () => { storeHint(); if (mode === 'local' && !pendingTex && !pendingFiles) renderPanel(); });
    renderPanel(); storeHint();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#np-x').onclick = close;
    q('#np-save').onclick = async () => {
      const name = q('#np-name').value.trim(), noun = q('#np-noun').value.trim() || 'document';
      if (!name) return q('#np-err').textContent = 'Give your project a name.';
      if (!wsRepo) return q('#np-err').textContent = 'Set up your workspace repo first.';
      const id = projectIdFromName(name);
      const externalSrc = (mode !== 'local') ? q('#np-pick').value.trim() : '';
      if (mode === 'local' && !pendingTex && !pendingFiles) return q('#np-err').textContent = 'Upload your project folder (or a single .tex) to import.';
      if (mode !== 'local' && !externalSrc) return q('#np-err').textContent = 'Pick the repo where your LaTeX lives.';
      try {
        // Resolve the two axes (storage style x source mode) to concrete repos + paths. Workspace: DATA (and,
        // for uploads, source) live under <wsRepo>/<id>/…. Independent: this document gets its own data repo
        // (and, for uploads, its own source repo) at their roots. Detect the unit level from the uploaded
        // LaTeX so a journal article gets unitNoun 'section', not the 'chapter' default.
        const plan = newProjectPlan(style, mode, name, { ...cfg, hubRepo: wsRepo, workspaceRepo: wsRepo }, { sourceRepo: externalSrc });
        const dataRepo = plan.dataRepo;
        const srcRepo = plan.workspace ? wsRepo : plan.sourceRepo;      // repo the uploaded LaTeX is committed to
        const srcBase = plan.workspace ? `${id}/source/` : '';         // path prefix within that repo
        const seedPrefix = plan.workspace ? `${id}/` : '';             // per-project config folder vs repo root
        const chaptersPath = plan.workspace ? `${id}/chapters.json` : 'chapters.json';
        const localLevel = pendingFiles ? detectedLevel : (pendingTex ? detectUnitLevel(pendingTex.text, () => null) : null);
        const unitNoun = resolveUnitNoun('chapter', localLevel);
        // "In Overleaf" (tokenless B1): the picked repo is the Overleaf bridge repo (Overleaf's own GitHub
        // sync target). Record the marker so the owner portal offers "Refresh from Overleaf"; source stays external.
        const olPatch = mode === 'overleaf' ? overleafNewProjectPatch(externalSrc) : null;
        // Grouping label from the picker (M4.2). "New workspace…" prompts for a name and persists it to
        // account.json. The picked NAME goes into `workspaceLabel` (the grouping STRING via moveDocPatch) —
        // NEVER `workspace` (the storage boolean, set from plan.workspace). Picking the default writes ''.
        let workspaceLabel = '';
        const wsSel = q('#np-ws');
        if (wsSel) {
          workspaceLabel = wsSel.value;
          if (workspaceLabel === '__new__') {
            const raw = (prompt('New workspace name:') || '').trim();
            if (!raw) return q('#np-err').textContent = 'Name your new workspace, or pick an existing one.';
            workspaceLabel = raw;
            acct = addWorkspace(acct, raw);
            try { await writeAccount({ ...cfg, hubRepo: hub() }, acct, tok()); } catch (e) { console.warn('account:', e.message); }
          }
        }
        const next = addProject(list, { id, name, dataRepo, sourceRepo: plan.sourceRepo, workspace: plan.workspace, uploaded: plan.uploaded, doc: { noun, unitNoun }, ...moveDocPatch(workspaceLabel), ...(olPatch ? { overleaf: olPatch.overleaf } : {}) });
        q('#np-save').disabled = true;
        // Create every repo the plan needs (workspace repo, or the dedicated data (+ source) repos). createRepo
        // tolerates an already-existing repo (422). Never creates an external source repo the user points at.
        for (const repo of plan.creates) { q('#np-err').textContent = `Preparing ${repo}…`; await createRepo(tok(), repo); }
        // Seed the background CI: workflows/ci_*.py once at the repo root, this project's config under the prefix.
        q('#np-err').textContent = 'Setting up background email/notify…';
        try { await seedDataRepo(dataRepo, tok(), undefined, undefined, seedPrefix); } catch (e) { console.warn('seed:', e.message); }
        // GUARANTEE the render pipeline is in the data repo (idempotent) so the reading view auto-builds on the
        // source push below. A first seed can silently drop it; ensureRenderPipeline re-adds only what's missing.
        // A token without the `workflow` scope is the one unrecoverable case — surface it instead of dead-ending.
        let renderBlocked = false;
        try { await ensureRenderPipeline(dataRepo, tok()); }
        catch (e) { if (/workflow-scope/.test(e.message)) renderBlocked = true; else console.warn('render pipeline:', e.message); }
        let chapters = null;
        if (pendingFiles) {   // whole folder: commit every file under the source base preserving structure
          const { files, entry, entryText, map } = pendingFiles;
          let i = 0;
          for (const f of files) {
            q('#np-err').textContent = `Committing ${++i}/${files.length} · ${f.path}…`;
            const dest = `${srcBase}${f.path}`;
            if (f.isText) await commitSourceFile(srcRepo, dest, f.text, tok(), `Footnote import: ${dest}`);
            else await commitSourceBinary(srcRepo, dest, f.base64, tok(), `Footnote import: ${dest}`);
          }
          chapters = parseLatexChapters(entryText, pth => (pth in map ? map[pth] : null));
        } else if (pendingTex) {
          q('#np-err').textContent = `Committing ${srcBase}main.tex…`;
          await commitSourceFile(srcRepo, `${srcBase}main.tex`, pendingTex.text, tok(), `Footnote import: ${srcBase}main.tex`);
          chapters = parseLatexChapters(pendingTex.text, () => null);
        }
        if (chapters && chapters.length) {   // seed chapters.json (in the DATA repo) so the project opens ready
          q('#np-err').textContent = `Saving ${chapters.length} unit${chapters.length !== 1 ? 's' : ''}…`;
          try { await commitSourceFile(dataRepo, chaptersPath, JSON.stringify(chapters, null, 2), tok(), `import: ${chapters.length} units`); }
          catch (e) { console.warn('chapters:', e.message); }
        }
        q('#np-err').textContent = 'Saving…';
        await writeProjects(hub(), tok(), next);
        // If this new document is Overleaf-linked and the account token is already saved, auto-seal it into the
        // doc's data repo (where the sync CI runs) so no manual "Seal token" step is needed. Best-effort.
        if (mode === 'overleaf') await ensureOverleafTokenSealed(dataRepo);
        if (renderBlocked) {   // project is created, but the reading view can't build until the token is fixed
          render();            // still show the new project on the shelf
          q('#np-save').disabled = false;
          q('#np-err').innerHTML = `Imported — but your token is missing the <b>workflow</b> permission, so the reading view can’t build on your repo. <a href="${TOKEN_URL}" target="_blank" rel="noopener">Regenerate your token</a> (with <code>repo</code> + <code>workflow</code>), update it, then open the project.`;
          return;
        }
        close(); render();
      } catch (e) { q('#np-err').textContent = e.message; q('#np-save').disabled = false; }
    };
    setTimeout(() => q('#np-name').focus(), 30);
  }

  // Account Settings page (launcher-level ⚙). Three sections: GitHub access (status of the ghpat token),
  // the account-wide Overleaf token (sealed into every Overleaf-linked doc's repo + a 1-year renewal
  // reminder), and the Workspaces manager (add / rename / delete→reassign to the default group). account.json
  // is written LAZILY — only when the user actually saves a change here (existing users who never open this
  // see no account.json and zero behavior change). The Overleaf token is the user's own credential: it is
  // prompted, sealed, and discarded — never stored in projects.json/account.json, logged, or rendered back.
  async function renderAccountSettings() {
    const appCfg = { ...cfg, hubRepo: hub(), workspaceRepo: hub() };
    let list = [];
    try { list = await loadProjects(appCfg, tok()); } catch {}
    // undefined = load FAILED (transient/403/5xx → unknown baseline, must NOT overwrite account.json); null =
    // genuinely no account.json yet (404 → a fresh one is correct); object = loaded. loadAccount never throws.
    let account = await loadAccount(appCfg, tok());
    const draw = () => {
      const acct = normalizeAccount(account);
      // Save targets ALWAYS include the workspace/registry repo, so the token can be saved with zero linked docs
      // and auto-covers every shared-repo Overleaf document.
      const sealTargets = overleafSaveTargets(list, appCfg);
      frame(settingsInnerHtml({
        github: githubAccessStatus(tok()),
        overleaf: { ...overleafSettingsView(account, new Date()), tokenSaved: !!overleafToken() },
        names: acct.workspaces,
        sealTargets,
        workspaceRepo: hub(),
      }), { signout: true, settings: true });

      const back = document.getElementById('fn-set-back'); if (back) back.onclick = () => render();
      const conn = document.getElementById('fn-set-connect'); if (conn) conn.onclick = () => { localStorage.removeItem(TOK_KEY); render(); };

      // ---- Overleaf: store the token locally + seal it into every target repo (the workspace repo is always a
      // target, so this works with ZERO linked docs), then persist account.json.overleaf. ----
      const olStatus = m => { const s = document.getElementById('fn-set-olstatus'); if (s) s.textContent = m; };
      const sealBtn = document.getElementById('fn-set-olseal');
      if (sealBtn) sealBtn.onclick = async () => {
        const input = document.getElementById('fn-set-oltok');
        const val = (input && input.value || '').trim();
        if (!val) return olStatus('Paste your Overleaf git-bridge token first.');
        try {
          sealBtn.disabled = true; olStatus(`Saving your Overleaf token${sealTargets.length ? ` and sealing into ${sealTargets.length} repo${sealTargets.length === 1 ? '' : 's'}` : ''}…`);
          setOverleafToken(val);   // retain the raw token locally (own credential) so new docs auto-connect
          const sealed = await sealOverleafIntoRepos(tok(), sealTargets, val,
            { getPublicKey, putSecret, sealFn: sealToBase64 });
          if (input) input.value = '';   // never keep the token in the DOM
          if (account === undefined) {
            // The account load FAILED — token is saved + the secret is sealed (the primary goal), but we must NOT
            // overwrite account.json from an unknown baseline (that would wipe the user's workspaces + sealedRepos).
            olStatus('Token saved; couldn’t update your workspace list just now — try again.');
            sealBtn.disabled = false;
            return;
          }
          account = { ...normalizeAccount(account), overleaf: { sealedRepos: sealed, setAt: new Date().toISOString() } };
          await writeAccount(appCfg, account, tok());   // reliable baseline (loaded object or genuine no-account)
          draw();   // re-render with the saved/sealed state + fresh expiry check
        } catch (e) {
          olStatus(e.code === 'NOSCOPE' ? 'Your key needs Secrets: write to seal this (regenerate with repo scope).' : e.message);
          sealBtn.disabled = false;
        }
      };

      // ---- Workspaces: add / rename / delete(→reassign docs to default) — all persisted via writeAccount ----
      const addBtn = document.getElementById('fn-set-wsadd');
      if (addBtn) addBtn.onclick = async () => {
        const input = document.getElementById('fn-set-wsnew');
        const name = (input && input.value || '').trim();
        if (!name) return;
        try { addBtn.disabled = true; account = addWorkspace(account, name); await writeAccount(appCfg, account, tok()); draw(); }
        catch (e) { console.warn('add workspace:', e.message); addBtn.disabled = false; }
      };
      root.querySelectorAll('[data-ws-rename]').forEach(b => b.onclick = async () => {
        const oldName = b.getAttribute('data-ws-rename');
        const raw = (prompt('Rename workspace:', oldName) || '').trim();
        if (!raw || raw === oldName) return;
        try {
          // Rename = re-point every doc in the group + swap the name in account.workspaces (order preserved).
          const docs = list.filter(p => (typeof p.workspaceLabel === 'string' ? p.workspaceLabel.trim() : '') === oldName);
          for (const p of docs) await writeProjectPatch(appCfg, p.id, moveDocPatch(raw), tok());
          const acct = normalizeAccount(account);
          acct.workspaces = acct.workspaces.map(w => (w === oldName ? raw : w));
          account = acct; await writeAccount(appCfg, account, tok());
          list = await loadProjects(appCfg, tok()).catch(() => list);
          draw();
        } catch (e) { console.warn('rename workspace:', e.message); draw(); }
      });
      root.querySelectorAll('[data-ws-del]').forEach(b => b.onclick = async () => {
        const name = b.getAttribute('data-ws-del');
        const docs = list.filter(p => (typeof p.workspaceLabel === 'string' ? p.workspaceLabel.trim() : '') === name);
        if (!confirm(docs.length
          ? `Delete workspace “${name}”? Its ${docs.length} document${docs.length === 1 ? '' : 's'} move back to your default group (nothing is deleted).`
          : `Delete workspace “${name}”?`)) return;
        try {
          for (const p of docs) await writeProjectPatch(appCfg, p.id, moveDocPatch(''), tok());   // reassign to default
          account = removeWorkspace(account, name); await writeAccount(appCfg, account, tok());
          list = await loadProjects(appCfg, tok()).catch(() => list);
          draw();
        } catch (e) { console.warn('delete workspace:', e.message); draw(); }
      });
    };
    draw();
  }

  // Remove = unregister only. It never deletes the comments repo or the document on GitHub — the confirm
  // dialog says so and names the repo, so a click can't silently destroy a reviewer's work.
  function confirmRemove(list, project) {
    const scrim = document.createElement('div'); scrim.className = 'fn-scrim';
    scrim.innerHTML = `<div class="fn-sheet fn-reveal">
      <div class="fn-sheet-h">Remove “${esc(project.name)}”?</div>
      <p class="fn-remove-note">This only takes it off your shelf here. Your comments repo <span class="fn-mono">${esc(project.dataRepo)}</span> and your document stay on GitHub — nothing is deleted, and you can add it back anytime. To delete the repo itself, do that from GitHub.</p>
      <div class="fn-err" id="rm-err"></div>
      <div class="fn-actions fn-right"><button class="fn-btn" id="rm-x">Cancel</button><button class="fn-btn fn-btn-danger" id="rm-go">Remove from library</button></div></div>`;
    root.appendChild(scrim);
    const q = s => scrim.querySelector(s), close = () => scrim.remove();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    q('#rm-x').onclick = close;
    q('#rm-go').onclick = async () => {
      q('#rm-go').disabled = true; q('#rm-err').textContent = 'Removing…';
      try { await writeProjects(hub(), tok(), removeProject(list, project.id)); close(); render(); }
      catch (e) { q('#rm-err').textContent = e.message; q('#rm-go').disabled = false; }
    };
  }

  // Close the manage menu on any outside click or Escape (added once for the launcher's lifetime).
  document.addEventListener('click', e => {
    if (!e.target.closest('#fn-menu') && !e.target.closest('.fn-book-manage')) closeManageMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeManageMenu(); });

  function render() { if (!tok()) return connect(); if (!hub()) return setupWorkspace(); projects(); }
  render();
}

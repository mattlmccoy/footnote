// Phase 2 — seed a freshly-created data (comments) repo with the per-user background CI, so email invites
// and notifications run on the USER's own GitHub. Templates are fetched from the app's committed
// data-template/ (served by Pages; note .github is NOT servable, so template workflows live under
// data-template/workflows/ and are written to .github/workflows/ in the target). Pure manifest is
// unit-tested; seedDataRepo does the fetch+PUT I/O with an injectable fetch.

// { src (under data-template/), dest (path in the user's data repo) }
export const SEED_FILES = [
  { src: 'ci_invite.py',           dest: 'ci_invite.py' },
  { src: 'ci_notify_common.py',    dest: 'ci_notify_common.py' },
  { src: 'ci_notify_author.py',    dest: 'ci_notify_author.py' },
  { src: 'ci_notify_advisors.py',  dest: 'ci_notify_advisors.py' },
  { src: 'workflows/invite.yml',          dest: '.github/workflows/invite.yml' },
  { src: 'workflows/notify.yml',          dest: '.github/workflows/notify.yml' },
  { src: 'workflows/release-notify.yml',  dest: '.github/workflows/release-notify.yml' },
  // Phase 3 — the generic reading-view render pipeline (LaTeX → self-contained HTML + srcmap),
  // run on the adopter's own Actions by render.yml. export/* mirrors data-template/export/.
  { src: 'export/preprocess.py',   dest: 'export/preprocess.py' },
  { src: 'export/srcmap.py',       dest: 'export/srcmap.py' },
  { src: 'export/chapter-html.sh', dest: 'export/chapter-html.sh' },
  { src: 'export/shim.tex',        dest: 'export/shim.tex' },
  { src: 'export/ieee.csl',        dest: 'export/ieee.csl' },
  { src: 'ci_render.py',           dest: 'ci_render.py' },
  { src: 'workflows/render.yml',   dest: '.github/workflows/render.yml' },
  // Claude round-trip backend — the review job-queue consumer. Deterministic apply-direct today
  // (works with AI off); Claude-authored apply-edits/run-agents + merge land in later slices.
  // The shared pure core (ci_review_common) is reused by every engine script. Runs on the
  // adopter's own Actions via apply.yml.
  { src: 'ci_review_common.py',    dest: 'ci_review_common.py' },
  { src: 'ci_apply.py',            dest: 'ci_apply.py' },
  { src: 'workflows/apply.yml',    dest: '.github/workflows/apply.yml' },
  // Agent network B1 — the shipped agent catalog. ci_agents.py holds the engine-owned builtin
  // critics + the pure directive resolver run-agents uses; agents.json is the JSON mirror seeded for
  // the client to display and for user-authored (builtin:false) agents to live in (B4). Both are
  // repo-level, like the rest of the engine.
  { src: 'ci_agents.py',           dest: 'ci_agents.py' },
  { src: 'agents.json',            dest: 'agents.json' },
  // B5 local runner — drains run-agents jobs whose agents are execution:"local" (tool-using,
  // machine-bound user agents) on the operator's own machine instead of CI. Generic + document-
  // agnostic; the operator runs it locally (`python ci_local.py`). Shipped so it's available in-repo.
  { src: 'ci_local.py',            dest: 'ci_local.py' },
  // B4 — user-authored agents: the engine turns an owner's plain-language brief into a draft agent
  // in agents.json (reviewed before it runs). Used by both ci_apply (CI) and ci_local (local).
  { src: 'ci_authoring.py',        dest: 'ci_authoring.py' },
];

// Initial config files created fresh (honest empty state — email_configured stays false until a real send).
export function seedJsonFiles() {
  return [
    { path: 'advisors.json',       json: { advisors: [], email_configured: false } },
    { path: 'release.json',        json: { _comment: 'per-reviewer chapter gate: { reviewerId: { name, released:[chapterId], responses_released } }' } },
    { path: 'notify_config.json',  json: { author_email: '' } },
    { path: 'notify_state.json',   json: {} },
  ];
}

const b64 = s => btoa(unescape(encodeURIComponent(s)));
const API = 'https://api.github.com';

// The render subset of SEED_FILES — the pipeline that must exist in the data repo for the reading view
// to build (LaTeX → HTML on the user's own Actions). Seeded on New Project, but ALSO ensured on demand
// (self-heal) because a first seed can fail (missing workflow scope, transient error, stale bundle) and
// must be recoverable without re-importing the whole document.
export const RENDER_FILES = SEED_FILES.filter(({ dest }) =>
  dest.startsWith('export/') || dest === 'ci_render.py' || dest === '.github/workflows/render.yml');

// The Claude round-trip engine subset — the repo-level files that must exist for a queued Send-to-Claude
// / apply-direct / merge job to actually run on the user's Actions. Seeded on New Project, but ALSO
// ensured on demand (self-heal) so an EXISTING data repo created before the engine — or one where the
// first seed failed — gets it once, WITHOUT re-importing. Repo-level, so one seal covers every paper.
export const APPLY_FILES = SEED_FILES.filter(({ dest }) =>
  dest === 'ci_review_common.py' || dest === 'ci_apply.py' || dest === 'ci_agents.py' ||
  dest === 'agents.json' || dest === 'ci_local.py' || dest === 'ci_authoring.py' ||
  dest === '.github/workflows/apply.yml');

// The email/invite pipeline subset: the invite + notify CI and their workflows. A workspace data repo
// seeded render-only has render.yml but not invite.yml, so the email wizard 404s on the invite workflow
// and misreports it as a token-scope problem — ensureInvitePipeline self-heals that, idempotently.
export const INVITE_FILES = SEED_FILES.filter(({ dest }) =>
  dest === 'ci_invite.py' || dest === 'ci_notify_common.py' || dest === 'ci_notify_author.py' ||
  dest === 'ci_notify_advisors.py' || dest === '.github/workflows/invite.yml' ||
  dest === '.github/workflows/notify.yml' || dest === '.github/workflows/release-notify.yml');

// Shared idempotent seeder: PUT ONLY the missing files from `files` into the data repo. Returns
// { seeded:[], already:[] }. Throws Error('workflow-scope') when GitHub blocks a .github/workflows/ write
// with 403 (token lacks the `workflow` scope) so the caller can tell the user exactly how to fix it.
async function ensureFiles(files, dataRepo, token, fetchImpl, base, label) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('no fetch available to seed the data repo');
  const root = (base || (typeof location !== 'undefined' ? location.pathname.replace(/[^/]*$/, '') : './'));
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const norm = s => (s || '').replace(/\s/g, '');   // GitHub returns 76-col-wrapped base64; b64() emits none
  const out = { seeded: [], already: [] };
  for (const { src, dest } of files) {
    const res = await f(`${root}data-template/${src}`);
    if (!res || !res.ok) throw new Error(`couldn’t read template ${src}`);
    const content = b64(await res.text());
    // Refresh, not just seed: if the file exists but its content differs from the current template (a stale
    // seeded copy — e.g. an old ci_invite.py without the magic-link key), update it IN PLACE with its sha.
    // Identical content is left untouched (idempotent, no churn).
    const head = await f(`${API}/repos/${dataRepo}/contents/${dest}`, { headers: h });
    let sha;
    if (head && head.ok) {
      let meta = null; try { meta = await head.json(); } catch (e) {}
      if (meta && norm(meta.content) === norm(content)) { out.already.push(dest); continue; }   // up to date
      sha = meta && meta.sha;                                                                    // stale → update with sha
    }
    const put = await f(`${API}/repos/${dataRepo}/contents/${dest}`, {
      method: 'PUT',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `${sha ? 'refresh' : 'seed'}: ${label} — ${dest}`, content, ...(sha ? { sha } : {}) }),
    });
    if (put && put.ok) { out.seeded.push(dest); continue; }
    if (put && put.status === 403 && dest.startsWith('.github/workflows/')) throw new Error('workflow-scope');
    throw new Error(`seed ${dest}: ${put ? put.status : 'no response'}`);
  }
  return out;
}

// Self-heal the render pipeline (see RENDER_FILES). Safe to call on every "Build reading view".
export function ensureRenderPipeline(dataRepo, token, fetchImpl, base) {
  return ensureFiles(RENDER_FILES, dataRepo, token, fetchImpl, base, 'render pipeline');
}

// Self-heal the email/invite pipeline (see INVITE_FILES). Safe to call whenever the email wizard runs —
// idempotent, repo-level, so one call fixes every paper in the workspace without per-project setup.
export function ensureInvitePipeline(dataRepo, token, fetchImpl, base) {
  return ensureFiles(INVITE_FILES, dataRepo, token, fetchImpl, base, 'invite pipeline');
}

// Self-heal the Claude apply engine (see APPLY_FILES). Safe to call whenever AI setup runs — idempotent,
// repo-level, so one call fixes every paper in the workspace without per-project setup.
export function ensureApplyEngine(dataRepo, token, fetchImpl, base) {
  return ensureFiles(APPLY_FILES, dataRepo, token, fetchImpl, base, 'apply engine');
}

// Seed a data repo. base is where data-template/ is served from (default the current page). `prefix` (e.g.
// "<id>/") namespaces the per-project CONFIG (advisors.json etc.) for a consolidated workspace repo, while
// the CI CODE (workflows + ci_*.py) stays repo-level so one workspace repo runs one set of workflows for
// every project. Idempotent: a file that already exists (422) is left as-is (so seeding on every new
// workspace project only writes the workflows once). Requires a token with write access to the data repo.
export async function seedDataRepo(dataRepo, token, fetchImpl, base, prefix = '') {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('no fetch available to seed the data repo');
  const root = (base || (typeof location !== 'undefined' ? location.pathname.replace(/[^/]*$/, '') : './'));
  const put = async (path, content, msg) => {
    const r = await f(`https://api.github.com/repos/${dataRepo}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, content }),
    });
    if (!r.ok && r.status !== 422) throw new Error(`seed ${path}: ${r.status}`);
  };
  for (const { src, dest } of SEED_FILES) {   // CI code + workflows: repo-level, never prefixed
    const res = await f(`${root}data-template/${src}`);
    if (!res || !res.ok) throw new Error(`couldn’t read template ${src}`);
    await put(dest, b64(await res.text()), `seed: ${dest}`);
  }
  for (const { path, json } of seedJsonFiles()) {   // per-project config: under <prefix> in workspace mode
    await put(`${prefix}${path}`, b64(JSON.stringify(json, null, 2)), `seed: ${prefix}${path}`);
  }
}

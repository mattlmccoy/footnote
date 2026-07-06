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

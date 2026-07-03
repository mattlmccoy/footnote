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

// Seed a data repo. base is where data-template/ is served from (default the current page). Idempotent:
// a file that already exists (422) is left as-is. Requires a token with write access to the data repo.
export async function seedDataRepo(dataRepo, token, fetchImpl, base) {
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
  for (const { src, dest } of SEED_FILES) {
    const res = await f(`${root}data-template/${src}`);
    if (!res || !res.ok) throw new Error(`couldn’t read template ${src}`);
    await put(dest, b64(await res.text()), `seed: ${dest}`);
  }
  for (const { path, json } of seedJsonFiles()) {
    await put(path, b64(JSON.stringify(json, null, 2)), `seed: ${path}`);
  }
}

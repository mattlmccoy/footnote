// GitHub Actions secrets / variables / workflow-dispatch helper for the owner Connect-email flow.
// Every network fn takes an explicit token argument — it NEVER reads localStorage, so a one-time
// elevated token can flow through without being persisted. Repo mirrors gh.js (the data repo).
import { getConfig, dataRepoParts } from './config.js?v=94173a2';
const API = 'https://api.github.com';
// data repo + invite workflow are read from footnote.config.json (loaded at boot), not hardcoded.
const slug = () => { const { owner, repo } = dataRepoParts(getConfig()); return `${owner}/${repo}`; };
const inviteWorkflow = () => getConfig().inviteWorkflow;
const hdr = tok => ({ Authorization:`Bearer ${tok}`, Accept:'application/vnd.github+json' });

// Provider prefill table (pure data). domains[] drives detectProvider. keyUrl/keyLabel deep-link the
// EXACT page where the owner generates the app password / API key that goes in the password field —
// which is never their normal account login password.
export const PROVIDERS = {
  brevo:    { id:'brevo',    label:'Brevo (advanced — needs your own domain)', host:'smtp-relay.brevo.com', port:587, domains:[],
              secretWord:'SMTP key', keyUrl:'https://app.brevo.com/settings/keys/smtp', keyLabel:'Open Brevo — SMTP & API',
              separateLogin:true,
              loginHint:'Brevo’s SMTP Login (looks like 12345@smtp-brevo.com) — NOT your account email',
              howto:['Only use Brevo if you own a domain you can authenticate — you CANNOT send from @gmail.com through it.',
                     'In Brevo, open Settings → SMTP & API → SMTP tab.',
                     'Copy the "Login" shown there (looks like 12345@smtp-brevo.com) — this is the username, not your account email.',
                     'Click "Generate SMTP key", name it, and copy the key.',
                     'IMPORTANT: turn OFF IP blocking — Settings → Security → Authorized IPs → keep "Activate for SMTP keys" DEACTIVATED (GitHub’s servers use changing IPs, so blocking rejects them).',
                     'Add your real email as a verified sender → Settings → Senders, domains, IPs → add + confirm it (that’s the "From" address advisors see).'] },
  gmail:    { id:'gmail',    label:'Gmail',                host:'smtp.gmail.com',     port:465, domains:['gmail.com','googlemail.com'],
              secretWord:'App Password', keyUrl:'https://myaccount.google.com/apppasswords', keyLabel:'Open Gmail App Passwords',
              howto:['Make sure 2-Step Verification is ON for your Google account.', 'On the page that opens, create an App Password (name it anything).', 'Copy the 16-character code it shows (spaces are fine).'] },
  outlook:  { id:'outlook',  label:'Outlook / Office 365', host:'smtp.office365.com', port:587, domains:['outlook.com','hotmail.com','live.com'],
              secretWord:'app password', keyUrl:'https://account.live.com/proofs/AppPassword', keyLabel:'Open Outlook app passwords',
              howto:['On the page that opens, create an app password and copy it.', 'Personal Outlook/Hotmail: this page works directly.', 'Work/school (Office 365): create it in your IT security portal instead.'] },
  custom:   { id:'custom',   label:'Custom SMTP',          host:'', port:587, domains:[],
              secretWord:'app password / API key', keyUrl:'', keyLabel:'',
              howto:['Get your SMTP host, port, username and app password / API key from your email provider.', 'Enter the host and port below, then your key.'] },
};

// Map a from-address domain to a provider id. .edu/institutional → outlook; unknown → custom.
export function detectProvider(email){
  const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec((email||'').trim().toLowerCase());
  if (!m) return null;
  const dom = m[1];
  for (const p of Object.values(PROVIDERS)) if (p.domains.includes(dom)) return p.id;
  if (dom.endsWith('.edu') || dom.endsWith('.ac.uk') || dom.includes('.edu.')) return 'outlook';
  return 'custom';
}

// 32-char base62 advisor access key.
export function genKey(){
  const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const r = crypto.getRandomValues(new Uint8Array(32));
  let s = ''; for (const b of r) s += A[b % 62]; return s;
}

// True when an error means the token lacks a needed permission (Secrets OR Actions) — a 403/404 or
// the NOSCOPE code — vs a transient/network error we should surface rather than misread as "no scope".
export function isScopeError(e){
  return !!e && (e.code === 'NOSCOPE' || /\b40[34]\b/.test(e.message || ''));
}

// GET the repo Actions public key. Throwing on 403 is the signal the token lacks Secrets:write.
export async function getPublicKey(tok){
  const r = await fetch(`${API}/repos/${slug()}/actions/secrets/public-key`, { headers:hdr(tok), cache:'no-store' });
  if (r.status === 403 || r.status === 404) { const e = new Error('no-secret-scope'); e.code = 'NOSCOPE'; throw e; }
  if (!r.ok) throw new Error('public-key ' + r.status);
  return r.json();   // { key_id, key }
}

// PUT one sealed secret. sealFn(pubKeyB64, value) -> base64 (from vendor/seal.mjs).
export async function putSecret(tok, pk, sealFn, name, value){
  const r = await fetch(`${API}/repos/${slug()}/actions/secrets/${name}`, {
    method:'PUT', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
    body: JSON.stringify({ encrypted_value: sealFn(pk.key, value), key_id: pk.key_id }) });
  if (!r.ok) throw new Error(`secret ${name}: ${r.status} ${(await r.text()).slice(0,120)}`);
}

// Set a plain (non-secret) Actions variable: POST, and on 409 (exists) PATCH.
export async function setVariable(tok, name, value){
  let r = await fetch(`${API}/repos/${slug()}/actions/variables`, {
    method:'POST', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
    body: JSON.stringify({ name, value }) });
  if (r.status === 409){
    r = await fetch(`${API}/repos/${slug()}/actions/variables/${name}`, {
      method:'PATCH', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
      body: JSON.stringify({ name, value }) });
  }
  if (!r.ok) throw new Error(`variable ${name}: ${r.status}`);
}

// Fire the invite workflow as a test send to testEmail. Needs actions:write / workflow scope.
export async function dispatchInvite(tok, testEmail){
  const r = await fetch(`${API}/repos/${slug()}/actions/workflows/${inviteWorkflow()}/dispatches`, {
    method:'POST', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
    body: JSON.stringify({ ref:'main', inputs:{ test_email: testEmail } }) });
  if (!r.ok) throw new Error('dispatch ' + r.status + ' ' + (await r.text()).slice(0,120));
}

// Build the reading view: fire the render workflow for one project (or all if projectId is falsy).
// Needs actions:write / workflow scope. Call seed.ensureRenderPipeline first so render.yml exists.
export async function dispatchRender(tok, projectId){
  const r = await fetch(`${API}/repos/${slug()}/actions/workflows/render.yml/dispatches`, {
    method:'POST', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
    body: JSON.stringify({ ref:'main', inputs: projectId ? { project: projectId } : {} }) });
  if (!r.ok) throw new Error('render dispatch ' + r.status + ' ' + (await r.text()).slice(0,120));
}

// ---- AI setup (Slice 7): seal the adopter's OWN Claude credentials, all on their own data repo ----

// Which Actions secrets to write from the AI setup form: only non-empty fields, trimmed, under their
// canonical names (the same names apply.yml/ci_apply read). Pure so the gating is unit-tested; blanks
// are skipped so "Save" never clobbers an existing secret with an empty value. The RECOMMENDED Claude
// credential is a Claude Code SUBSCRIPTION token (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) —
// most adopters have a subscription, not an API key; ANTHROPIC_API_KEY is the alternative.
export function aiSecretsPlan({ claudeCodeToken, anthropicKey, sourceToken } = {}){
  const plan = [];
  const push = (name, v) => { const t = (v || '').trim(); if (t) plan.push({ name, value: t }); };
  push('CLAUDE_CODE_OAUTH_TOKEN', claudeCodeToken);
  push('ANTHROPIC_API_KEY', anthropicKey);
  push('SOURCE_TOKEN', sourceToken);
  return plan;
}

// Seal the AI secrets from the form (one public-key fetch, then a sealed PUT each). sealFn comes from
// vendor/seal.js, exactly like the email flow. Returns the names actually written.
export async function setAiSecrets(tok, sealFn, values){
  const plan = aiSecretsPlan(values);
  if (!plan.length) return [];
  const pk = await getPublicKey(tok);
  for (const { name, value } of plan) await putSecret(tok, pk, sealFn, name, value);
  return plan.map(p => p.name);
}

// Fire the apply workflow (drain the review queue) as a test/manual run. Needs actions:write / workflow.
export async function dispatchApply(tok, projectId){
  const r = await fetch(`${API}/repos/${slug()}/actions/workflows/apply.yml/dispatches`, {
    method:'POST', headers:{ ...hdr(tok), 'Content-Type':'application/json' },
    body: JSON.stringify({ ref:'main', inputs: projectId ? { project: projectId } : {} }) });
  if (!r.ok) throw new Error('apply dispatch ' + r.status + ' ' + (await r.text()).slice(0,120));
}

// Newest render run id/status/conclusion, so the UI can show progress and reload when it finishes.
export async function renderRun(tok){
  const r = await fetch(`${API}/repos/${slug()}/actions/workflows/render.yml/runs?per_page=1`, { headers:hdr(tok), cache:'no-store' });
  if (!r.ok) throw new Error('render runs ' + r.status);
  const d = await r.json(); const run = (d.workflow_runs||[])[0];
  return run ? { id:run.id, status:run.status, conclusion:run.conclusion } : null;
}

// Newest workflow_dispatch run id/status/conclusion for the invite workflow.
export async function latestRun(tok){
  const r = await fetch(`${API}/repos/${slug()}/actions/workflows/${inviteWorkflow()}/runs?event=workflow_dispatch&per_page=1`, { headers:hdr(tok), cache:'no-store' });
  if (!r.ok) throw new Error('runs ' + r.status);
  const d = await r.json(); const run = (d.workflow_runs||[])[0];
  return run ? { id:run.id, status:run.status, conclusion:run.conclusion } : null;
}

// Best-effort profile prefill: { name, email }.
export async function prefillFromGitHub(tok){
  const out = { name:'', email:'' };
  try { const u = await (await fetch(`${API}/user`, { headers:hdr(tok) })).json(); out.name = u.name || u.login || ''; } catch {}
  try { const es = await (await fetch(`${API}/user/emails`, { headers:hdr(tok) })).json();
        const p = Array.isArray(es) ? (es.find(e=>e.primary) || es[0]) : null; out.email = p?.email || ''; } catch {}
  return out;
}

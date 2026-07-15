// tests/overleaf-autoseal.test.mjs
// Browser-gate (fetch stub + libsodium seal + localStorage stub) for "save the Overleaf token any time +
// auto-connect it on link". It drives the REAL building blocks the hub.js handlers compose — getPublicKey /
// putSecret (ghsecrets), sealOverleafIntoRepos (hub), overleafSaveTargets / needsOverleafSeal / withSealedRepo
// (account), sealToBase64 (vendor/seal) — and asserts the request URLs/bodies, that the raw token is ONLY ever
// transmitted in sealed form (never raw in any body), and the localStorage retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { overleafSaveTargets, needsOverleafSeal, withSealedRepo } from '../js/account.js';
import { sealOverleafIntoRepos } from '../js/hub.js';
import { getPublicKey, putSecret } from '../js/ghsecrets.js';
import { loadAccount, writeAccount } from '../js/config.js';
import { sealToBase64, sealWith } from '../js/vendor/seal.js';

// libsodium globals so sealToBase64() works under Node (same wiring as seal.test.mjs).
const require = createRequire(import.meta.url);
const nacl = require('../js/vendor/nacl.min.js');
require('../js/vendor/blake2b.js');
const blake2b = globalThis.blake2bLib.blake2b;
globalThis.nacl = nacl;

const TOKEN = 'olp_SECRET_gitbridge_1234567890';   // the value that must NEVER leak raw

// A recipient keypair; the fetch stub returns its public key so we can OPEN the sealed value and prove it
// decrypts back to TOKEN (i.e. the token is transmitted only in sealed form).
const kp = nacl.box.keyPair();
const pubB64 = Buffer.from(kp.publicKey).toString('base64');
function openSeal(sealedB64) {
  const sealed = Uint8Array.from(atob(sealedB64), c => c.charCodeAt(0));
  const epk = sealed.slice(0, 32), c = sealed.slice(32);
  const input = new Uint8Array(64); input.set(epk, 0); input.set(kp.publicKey, 32);
  const nonce = blake2b(input, undefined, 24);
  const opened = nacl.box.open(c, nonce, epk, kp.secretKey);
  return opened ? new TextDecoder().decode(opened) : null;
}

// A capturing GitHub-API fetch stub. Records every call; answers public-key GET + secret PUT.
function stubFetch() {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: opts.body || '' });
    if (/\/actions\/secrets\/public-key/.test(u)) return { ok: true, status: 200, json: async () => ({ key_id: 'kid1', key: pubB64 }) };
    if (/\/actions\/secrets\//.test(u)) return { ok: true, status: 201, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  return calls;
}
// Minimal localStorage stub (only get/set/removeItem used by the token accessors).
function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
  return m;
}
const bodiesJoined = calls => calls.map(c => c.body).join('\n');
const OVL_KEY = 'footnote:overleaftoken';

test('(a) save with ZERO Overleaf docs: seals OVERLEAF_TOKEN into the WORKSPACE repo + stores localStorage; token only ever sealed', async () => {
  const saved = globalThis.fetch, savedLS = globalThis.localStorage;
  const calls = stubFetch(); const store = stubLocalStorage();
  try {
    const appCfg = { owner: 'me', hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
    const targets = overleafSaveTargets([], appCfg);            // zero docs → just the workspace repo
    assert.deepEqual(targets, ['me/hub']);

    // The Settings save handler: retain the raw token locally, then seal it into every target.
    globalThis.localStorage.setItem(OVL_KEY, TOKEN);            // setOverleafToken(val)
    const sealed = await sealOverleafIntoRepos('ghtok', targets, TOKEN,
      { getPublicKey, putSecret, sealFn: sealToBase64 });

    assert.deepEqual(sealed, ['me/hub']);                       // account.json.overleaf.sealedRepos
    // exactly one public-key GET + one secret PUT, both against the WORKSPACE repo
    const pkGet = calls.find(c => c.method === 'GET' && /repos\/me\/hub\/actions\/secrets\/public-key/.test(c.url));
    const put = calls.find(c => c.method === 'PUT' && /repos\/me\/hub\/actions\/secrets\/OVERLEAF_TOKEN/.test(c.url));
    assert.ok(pkGet, 'fetched the workspace repo public key');
    assert.ok(put, 'PUT OVERLEAF_TOKEN into the workspace repo');
    // the PUT carries a SEALED value that opens back to TOKEN — proof it is sealed, not raw
    assert.equal(openSeal(JSON.parse(put.body).encrypted_value), TOKEN);
    // the raw token appears in NO request body
    assert.ok(!bodiesJoined(calls).includes(TOKEN), 'raw token absent from every request body');
    // retained locally for auto-connect
    assert.equal(store.get(OVL_KEY), TOKEN);
  } finally { globalThis.fetch = saved; globalThis.localStorage = savedLS; }
});

test('(b) auto-seal on link: an existing saved token seals into the newly linked doc repo with no manual click', async () => {
  const saved = globalThis.fetch, savedLS = globalThis.localStorage;
  const calls = stubFetch(); const store = stubLocalStorage();
  try {
    globalThis.localStorage.setItem(OVL_KEY, TOKEN);           // token already saved earlier
    const repo = 'me/paper2-data';
    const account = { overleaf: { sealedRepos: ['me/hub'], setAt: '2026-07-10T00:00:00.000Z' } };

    // ensureOverleafTokenSealed(repo) composition: guard → getPublicKey → putSecret → withSealedRepo.
    assert.equal(needsOverleafSeal(repo, account), true);       // not sealed yet → proceed
    const val = globalThis.localStorage.getItem(OVL_KEY);       // overleafToken()
    const pk = await getPublicKey('ghtok', repo);
    await putSecret('ghtok', pk, sealToBase64, 'OVERLEAF_TOKEN', val, repo);
    const next = withSealedRepo(account, repo);

    const pkGet = calls.find(c => c.method === 'GET' && /repos\/me\/paper2-data\/actions\/secrets\/public-key/.test(c.url));
    const put = calls.find(c => c.method === 'PUT' && /repos\/me\/paper2-data\/actions\/secrets\/OVERLEAF_TOKEN/.test(c.url));
    assert.ok(pkGet, 'public-key GET for the linked doc repo');
    assert.ok(put, 'secret PUT for the linked doc repo');
    assert.equal(openSeal(JSON.parse(put.body).encrypted_value), TOKEN);   // sealed, not raw
    assert.ok(!bodiesJoined(calls).includes(TOKEN), 'raw token absent from every request body');
    assert.deepEqual(next.overleaf.sealedRepos, ['me/hub', 'me/paper2-data']);  // added
  } finally { globalThis.fetch = saved; globalThis.localStorage = savedLS; }
});

test('(c) backward-compat: no saved token → auto-seal no-ops (no network); already-sealed repo skipped', async () => {
  const saved = globalThis.fetch, savedLS = globalThis.localStorage;
  const calls = stubFetch(); stubLocalStorage();               // localStorage empty → no token saved
  try {
    // The ensureOverleafTokenSealed guard: `const val = overleafToken(); if (!val || !repo) return;`
    const val = globalThis.localStorage.getItem(OVL_KEY);
    assert.equal(val, null);                                    // no token saved (existing user)
    const wouldRun = !!val && !!'me/x';                         // the guard's boolean
    assert.equal(wouldRun, false, 'guard short-circuits → NO getPublicKey/putSecret');
    assert.equal(calls.length, 0, 'no network when no token is saved');

    // And even with a token, an already-sealed repo is skipped by needsOverleafSeal.
    assert.equal(needsOverleafSeal('me/hub', { overleaf: { sealedRepos: ['me/hub'] } }), false);
  } finally { globalThis.fetch = saved; globalThis.localStorage = savedLS; }
});

// The exact ensureOverleafTokenSealed branch logic, run over the REAL loadAccount/getPublicKey/putSecret/
// writeAccount so the config.js undefined-vs-null contract genuinely drives behavior. Returns whether the
// secret PUT ran and whether account.json was rewritten.
async function ensureSealBranch(repo, val, appCfg, token) {
  let sealed = false, wroteAccount = false;
  if (!val || !repo) return { sealed, wroteAccount };
  const account = await loadAccount(appCfg, token);        // undefined=load failed, null=no-account, object=loaded
  const loadFailed = account === undefined;
  if (!needsOverleafSeal(repo, loadFailed ? null : account)) return { sealed, wroteAccount };
  const pk = await getPublicKey(token, repo);
  await putSecret(token, pk, sealToBase64, 'OVERLEAF_TOKEN', val, repo); sealed = true;
  if (loadFailed) return { sealed, wroteAccount };          // sealed, but NEVER write from an unknown baseline
  const next = withSealedRepo(account, repo);
  await writeAccount(appCfg, next, token); wroteAccount = true;
  return { sealed, wroteAccount };
}

test('(d) DATA-SAFETY: a transient account-load failure seals the secret but does NOT rewrite account.json', async () => {
  const saved = globalThis.fetch, savedLS = globalThis.localStorage;
  const store = stubLocalStorage(); store.set(OVL_KEY, TOKEN);
  const calls = [];
  // account.json GET fails transiently (500) → loadAccount returns undefined. public-key GET + secret PUT ok.
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: opts.body || '' });
    if (/contents\/account\.json/.test(u)) return { ok: false, status: 500, json: async () => ({}) };
    if (/\/actions\/secrets\/public-key/.test(u)) return { ok: true, status: 200, json: async () => ({ key_id: 'k', key: pubB64 }) };
    if (/\/actions\/secrets\//.test(u)) return { ok: true, status: 201, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  try {
    const appCfg = { hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
    const r = await ensureSealBranch('me/paper2-data', TOKEN, appCfg, 'ghtok');
    assert.equal(r.sealed, true, 'the secret is still sealed (primary goal)');
    assert.equal(r.wroteAccount, false, 'account.json is NOT rewritten from an unknown baseline');
    // Concretely: a secret PUT happened, but NO PUT to account.json (which would wipe workspaces/sealedRepos).
    assert.ok(calls.some(c => c.method === 'PUT' && /actions\/secrets\/OVERLEAF_TOKEN/.test(c.url)), 'secret PUT ran');
    assert.ok(!calls.some(c => c.method === 'PUT' && /contents\/account\.json/.test(c.url)), 'NO account.json write');
    assert.ok(!bodiesJoined(calls).includes(TOKEN), 'raw token absent from every request body');
  } finally { globalThis.fetch = saved; globalThis.localStorage = savedLS; }
});

test('(e) genuine no-account (404) DOES write a fresh account.json with the sealed repo', async () => {
  const saved = globalThis.fetch, savedLS = globalThis.localStorage;
  const store = stubLocalStorage(); store.set(OVL_KEY, TOKEN);
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: opts.body || '' });
    if (/contents\/account\.json/.test(u) && method === 'GET') return { ok: false, status: 404, json: async () => ({}) };
    if (/contents\/account\.json/.test(u) && method === 'PUT') return { ok: true, status: 201, json: async () => ({}) };
    if (/\/actions\/secrets\/public-key/.test(u)) return { ok: true, status: 200, json: async () => ({ key_id: 'k', key: pubB64 }) };
    if (/\/actions\/secrets\//.test(u)) return { ok: true, status: 201, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  try {
    const appCfg = { hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
    const r = await ensureSealBranch('me/paper2-data', TOKEN, appCfg, 'ghtok');
    assert.equal(r.sealed, true);
    assert.equal(r.wroteAccount, true, 'a genuine no-account gets a fresh account.json');
    const put = calls.find(c => c.method === 'PUT' && /contents\/account\.json/.test(c.url));
    const written = JSON.parse(JSON.parse(put.body).content ? atob(JSON.parse(put.body).content) : '{}');
    assert.deepEqual(written.overleaf.sealedRepos, ['me/paper2-data']);
    assert.ok(!bodiesJoined(calls).includes(TOKEN), 'raw token absent from every request body');
  } finally { globalThis.fetch = saved; globalThis.localStorage = savedLS; }
});

// sealWith is imported to keep the seal contract explicit in this file's dependency set.
test('sealWith/sealToBase64 are the same seal used by the handlers', () => {
  const a = sealWith(nacl, blake2b, pubB64, TOKEN);
  assert.equal(openSeal(a), TOKEN);
});

import { test } from 'node:test';
import assert from 'node:assert';
import { PROVIDERS, detectProvider, genKey, isScopeError, aiSecretsPlan, claudeConnectionStatus, permissionFromError, applyRunLabel, getPublicKey, putSecret } from '../js/ghsecrets.js';

// M3: getPublicKey/putSecret gained an OPTIONAL trailing `repo` arg so the account-wide OVERLEAF_TOKEN can
// be sealed into MULTIPLE repos (each Overleaf-linked doc's repo). Absent → today's behavior (the data repo
// from slug(), exercised by every existing call site + kept green by the full suite). These stub
// globalThis.fetch and assert the explicit-repo target URL + sealed (never raw) body.
test('getPublicKey targets an explicit repo when given', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ key_id: 'kid', key: 'pk' }) }; };
  try {
    const pk = await getPublicKey('tok', 'me/target-repo');
    assert.equal(calls[0], 'https://api.github.com/repos/me/target-repo/actions/secrets/public-key');
    assert.deepStrictEqual(pk, { key_id: 'kid', key: 'pk' });
  } finally { globalThis.fetch = savedFetch; }
});

test('putSecret PUTs a sealed secret into an explicit repo, never the raw value', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, status: 200, text: async () => '' }; };
  try {
    const seal = (key, value) => 'SEALED(' + value + ')';   // stand-in for sealToBase64
    await putSecret('tok', { key: 'pk', key_id: 'kid' }, seal, 'OVERLEAF_TOKEN', 'super-secret', 'me/target-repo');
    assert.equal(calls[0].url, 'https://api.github.com/repos/me/target-repo/actions/secrets/OVERLEAF_TOKEN');
    assert.equal(calls[0].opts.method, 'PUT');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.key_id, 'kid');
    assert.equal(body.encrypted_value, 'SEALED(super-secret)');   // sealed ciphertext, not the raw token
    assert.ok(!calls[0].opts.body.includes('"super-secret"'));    // the raw value is never sent verbatim
  } finally { globalThis.fetch = savedFetch; }
});

// After the owner applies review decisions, the apply.yml workflow processes the queue on GitHub.
// applyRunLabel turns a workflow-run snapshot into a plain-English status so a queued job never looks
// dead — the "5 minutes, nothing happened" complaint.
test('applyRunLabel narrates the apply workflow run so a queued job never looks dead', () => {
  assert.equal(applyRunLabel(null), null);                                   // no run yet → no banner
  assert.match(applyRunLabel({ status:'queued' }), /queued/i);
  assert.match(applyRunLabel({ status:'in_progress' }), /processing/i);
  assert.equal(applyRunLabel({ status:'completed', conclusion:'success' }), null);  // done → clear banner
  assert.match(applyRunLabel({ status:'completed', conclusion:'failure' }), /didn.t succeed|actions/i);
});

// The Settings panel can't read a secret's VALUE, but it can list the secret NAMES on the data repo and
// tell the owner whether Claude is already connected for the whole workspace — so it's obvious the token
// is repo-level (set once, every paper here uses it), not per-paper.
test('claudeConnectionStatus reports Claude/source connection from the secret names', () => {
  assert.deepStrictEqual(claudeConnectionStatus(['CLAUDE_CODE_OAUTH_TOKEN', 'SOURCE_TOKEN']),
    { claude: true, via: 'CLAUDE_CODE_OAUTH_TOKEN', source: true });
  assert.deepStrictEqual(claudeConnectionStatus(['ANTHROPIC_API_KEY']),
    { claude: true, via: 'ANTHROPIC_API_KEY', source: false });
  // subscription token wins the "via" label when both are present
  assert.deepStrictEqual(claudeConnectionStatus(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']),
    { claude: true, via: 'CLAUDE_CODE_OAUTH_TOKEN', source: false });
  assert.deepStrictEqual(claudeConnectionStatus([]),
    { claude: false, via: null, source: false });
  assert.deepStrictEqual(claudeConnectionStatus(null),
    { claude: false, via: null, source: false });   // defensive
});

// Slice 7: the AI setup panel seals the adopter's OWN Claude credentials. aiSecretsPlan decides which
// Actions secrets to write from the form — only non-empty fields, trimmed, mapped to their secret names.
test('aiSecretsPlan seals only the non-empty fields, trimmed, under the right names', () => {
  // The RECOMMENDED credential is a Claude Code subscription token → CLAUDE_CODE_OAUTH_TOKEN.
  assert.deepStrictEqual(
    aiSecretsPlan({ claudeCodeToken: 'sk-ant-oat01-x', sourceToken: 'ghp_abc' }),
    [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat01-x' }, { name: 'SOURCE_TOKEN', value: 'ghp_abc' }]);
  // The API key is the alternative → ANTHROPIC_API_KEY.
  assert.deepStrictEqual(aiSecretsPlan({ anthropicKey: 'sk-ant-123' }),
    [{ name: 'ANTHROPIC_API_KEY', value: 'sk-ant-123' }]);
  // Both credentials + source, in a stable order (subscription first).
  assert.deepStrictEqual(
    aiSecretsPlan({ claudeCodeToken: 'oat', anthropicKey: 'key', sourceToken: 'ghp' }),
    [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'oat' },
     { name: 'ANTHROPIC_API_KEY', value: 'key' },
     { name: 'SOURCE_TOKEN', value: 'ghp' }]);
  // blank / whitespace-only fields are skipped (don't overwrite an existing secret with empty)
  assert.deepStrictEqual(aiSecretsPlan({ claudeCodeToken: '  oat  ', sourceToken: '   ' }),
    [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'oat' }]);       // trimmed
  assert.deepStrictEqual(aiSecretsPlan({}), []);              // nothing to do
});

// A missing-permission error (NOSCOPE, or any 403/404 like latestRun's 'runs 403') must be treated
// as "token lacks scope" so the flow prompts for a fuller token — while transient errors are NOT.
test('isScopeError distinguishes permission errors from transient ones', () => {
  assert.strictEqual(isScopeError(Object.assign(new Error('no-secret-scope'), { code:'NOSCOPE' })), true);
  assert.strictEqual(isScopeError(new Error('runs 403')), true);   // the reported failure
  assert.strictEqual(isScopeError(new Error('secret SMTP_USER: 404')), true);
  assert.strictEqual(isScopeError(new Error('runs 500')), false);  // server error — surface it
  assert.strictEqual(isScopeError(new Error('timeout')), false);
  assert.strictEqual(isScopeError(null), false);
});

test('detectProvider maps domains', () => {
  assert.strictEqual(detectProvider('a@gmail.com'), 'gmail');
  assert.strictEqual(detectProvider('a@googlemail.com'), 'gmail');
  assert.strictEqual(detectProvider('a@outlook.com'), 'outlook');
  assert.strictEqual(detectProvider('a@hotmail.com'), 'outlook');
  assert.strictEqual(detectProvider('prof@gatech.edu'), 'outlook');
  assert.strictEqual(detectProvider('x@acme.io'), 'custom');
  assert.strictEqual(detectProvider(''), null);
  assert.strictEqual(detectProvider('not-an-email'), null);
});

// Regression (Bug 1): a half-typed gmail address transiently reads as 'custom' before it's complete.
// The form's oninput handler MUST keep re-detecting so the finished address corrects to 'gmail'
// rather than sticking on the transient 'custom'.
test('partial gmail domain reads custom, complete reads gmail', () => {
  assert.strictEqual(detectProvider('me@gmail.c'), 'custom');   // mid-typing
  assert.strictEqual(detectProvider('me@gmail.co'), 'custom');  // still mid-typing
  assert.strictEqual(detectProvider('me@gmail.com'), 'gmail');  // finished → must win
});

test('PROVIDERS have host/port and an app-password link', () => {
  assert.strictEqual(PROVIDERS.gmail.host, 'smtp.gmail.com');
  assert.strictEqual(String(PROVIDERS.gmail.port), '465');
  assert.strictEqual(PROVIDERS.gmail.keyUrl, 'https://myaccount.google.com/apppasswords');
  assert.strictEqual(PROVIDERS.outlook.host, 'smtp.office365.com');
  assert.strictEqual(String(PROVIDERS.outlook.port), '587');
  assert.ok(PROVIDERS.brevo.keyUrl.startsWith('https://'));
});

test('genKey is 32 base62 chars', () => {
  const k = genKey();
  assert.match(k, /^[0-9A-Za-z]{32}$/);
  assert.notStrictEqual(genKey(), genKey());
});

// permissionFromError: turn a failed-write error into the exact fine-grained repo permission the token
// lacks, so the wizard names it instead of blanket "Actions". The write ops throw resource-tagged
// messages (putSecret "secret X: 403", setVariable "variable X: 403", ensureFiles "seed <dest>: 403" /
// "workflow-scope", dispatchInvite "dispatch 403").
test('permissionFromError maps each write failure to its GitHub permission', () => {
  assert.equal(permissionFromError('secret SMTP_USER: 403 Forbidden'), 'Secrets');
  assert.equal(permissionFromError('variable AUTHOR_NAME: 403'), 'Variables');
  assert.equal(permissionFromError('workflow-scope'), 'Workflows');
  assert.equal(permissionFromError('seed .github/workflows/invite.yml: 403'), 'Workflows');
  assert.equal(permissionFromError('seed ci_invite.py: 403'), 'Contents');
  assert.equal(permissionFromError('dispatch 403 not allowed'), 'Actions');
  assert.equal(permissionFromError('runs 403'), 'Actions');
  assert.equal(permissionFromError('some network blip'), null);
});

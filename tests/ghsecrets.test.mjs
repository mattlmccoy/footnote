import { test } from 'node:test';
import assert from 'node:assert';
import { PROVIDERS, detectProvider, genKey, isScopeError, aiSecretsPlan, claudeConnectionStatus, reviewerKeySecretName } from '../js/ghsecrets.js';

// Per-reviewer least-privilege tokens: the owner seals each reviewer's key as its OWN Actions secret
// ADVISOR_KEY_<UPPER_SLUG(id)>, and ci_invite.py reads that exact name. The name derivation must match
// on both sides — this is the pure client mirror of ci_invite.secret_name_for.
test('reviewerKeySecretName derives ADVISOR_KEY_<UPPER_SLUG(id)> matching the CI reader', () => {
  assert.equal(reviewerKeySecretName('chris-s-4f2a'), 'ADVISOR_KEY_CHRIS_S_4F2A');
  assert.equal(reviewerKeySecretName('CJS'), 'ADVISOR_KEY_CJS');
  // non [A-Z0-9_] chars collapse to _ (GitHub secret names allow only [A-Z0-9_], must not start with a digit)
  assert.equal(reviewerKeySecretName('a.b-c d'), 'ADVISOR_KEY_A_B_C_D');
  assert.equal(reviewerKeySecretName(''), 'ADVISOR_KEY');   // no id → the shared/legacy name
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

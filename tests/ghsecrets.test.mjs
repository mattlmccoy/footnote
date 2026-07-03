import { test } from 'node:test';
import assert from 'node:assert';
import { PROVIDERS, detectProvider, genKey, isScopeError } from '../js/ghsecrets.js';

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

// tests/tokenscopes.test.mjs
// Single source of truth for the GitHub token scopes Footnote needs, using the standardized credential
// vocabulary (Owner key / Reviewer key / Source key / Claude token).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIC_OWNER_SCOPES, classicTokenUrl, fineGrainedUrl,
  OWNER_KEY_PERMISSIONS, REVIEWER_KEY_PERMISSIONS, SOURCE_KEY_PERMISSIONS,
  permissionNames, tokenKind, reviewerKeyWarning, CREDENTIALS, credentialStatus,
} from '../js/tokenscopes.js';

test('classic owner scopes are repo + workflow (fully URL-prefillable, sufficient)', () => {
  assert.deepEqual(CLASSIC_OWNER_SCOPES, ['repo', 'workflow']);
});

test('classicTokenUrl prefills scopes + description', () => {
  const u = classicTokenUrl();
  assert.match(u, /^https:\/\/github\.com\/settings\/tokens\/new\?/);
  const q = new URL(u).searchParams;
  assert.equal(q.get('scopes'), 'repo,workflow');
  assert.equal(q.get('description'), 'Footnote');
});

test('classicTokenUrl accepts a custom description', () => {
  const q = new URL(classicTokenUrl(['repo', 'workflow'], 'Footnote email setup')).searchParams;
  assert.equal(q.get('description'), 'Footnote email setup');
});

test('fineGrainedUrl points at the FG page; GitHub cannot preselect repo/permissions', () => {
  assert.equal(fineGrainedUrl(), 'https://github.com/settings/personal-access-tokens/new');
  // a name hint is the only thing the FG page honors from the URL
  assert.match(fineGrainedUrl('Footnote'), /personal-access-tokens\/new\?name=Footnote$/);
});

test('P0: the Owner key permission list COVERS Secrets, Actions, and Variables (was the under-scope bug)', () => {
  const names = permissionNames(OWNER_KEY_PERMISSIONS);
  // the three that were missing and caused 403s on AI/email/apply/model-budget
  for (const need of ['Secrets', 'Actions', 'Variables']) assert.ok(names.includes(need), `missing ${need}`);
  // plus the ones that were already there
  for (const need of ['Contents', 'Administration', 'Workflows']) assert.ok(names.includes(need), `missing ${need}`);
  // every write-scoped permission is Read and write (Metadata is the only read-only)
  for (const p of OWNER_KEY_PERMISSIONS) {
    if (p.name === 'Metadata') assert.equal(p.level, 'Read-only');
    else assert.equal(p.level, 'Read and write', `${p.name} should be R/W`);
  }
});

test('Reviewer key stays least-privilege: Contents only (never Secrets/Actions/Admin)', () => {
  const names = permissionNames(REVIEWER_KEY_PERMISSIONS);
  assert.ok(names.includes('Contents'));
  for (const forbidden of ['Secrets', 'Actions', 'Administration', 'Variables', 'Workflows']) {
    assert.ok(!names.includes(forbidden), `reviewer key must NOT include ${forbidden}`);
  }
});

test('Source key is Contents-only (read + push review-edits branches)', () => {
  const names = permissionNames(SOURCE_KEY_PERMISSIONS);
  assert.deepEqual(names.filter(n => n !== 'Metadata'), ['Contents']);
});

test('tokenKind classifies by prefix', () => {
  assert.equal(tokenKind('ghp_abc123'), 'classic');
  assert.equal(tokenKind('github_pat_abc'), 'fine-grained');
  assert.equal(tokenKind('gho_abc'), 'oauth');
  assert.equal(tokenKind('   github_pat_x  '), 'fine-grained');   // trims
  assert.equal(tokenKind('random'), 'unknown');
  assert.equal(tokenKind(''), 'unknown');
});

test('reviewerKeyWarning flags a broad classic token pasted as the Reviewer key', () => {
  // a classic ghp_ token is inherently broad → wrong for the reviewer key (should be FG Contents-only)
  assert.match(reviewerKeyWarning('ghp_broad'), /classic|broad|fine-grained/i);
  // a fine-grained token is the right shape → no warning
  assert.equal(reviewerKeyWarning('github_pat_ok'), '');
  assert.equal(reviewerKeyWarning(''), '');
});

test('credentialStatus(owner): unset / under-scoped / ok', () => {
  assert.equal(credentialStatus('owner', { hasOwnerKey: false }).glyph, 'warn');
  const under = credentialStatus('owner', { hasOwnerKey: true, ownerScopeOk: false });
  assert.equal(under.glyph, 'warn');
  assert.match(under.text, /Secrets|Actions|scope/i);
  assert.equal(credentialStatus('owner', { hasOwnerKey: true, ownerScopeOk: true }).glyph, 'ok');
  // scope unknown (couldn't probe) but connected → still ok/neutral, not a false alarm
  assert.notEqual(credentialStatus('owner', { hasOwnerKey: true, ownerScopeOk: null }).glyph, 'warn');
});

test('credentialStatus(reviewer): reflects whether ADVISOR_KEY is set', () => {
  assert.equal(credentialStatus('reviewer', { reviewerSet: true }).glyph, 'ok');
  const off = credentialStatus('reviewer', { reviewerSet: false });
  assert.equal(off.glyph, 'warn');
  assert.match(off.text, /set it below|sign reviewers in/i);   // managed inline in Settings now
});

test('credentialStatus(source): reflects external / owned / set', () => {
  assert.equal(credentialStatus('source', { sourceExternal: false }).glyph, null);   // in the Review repo → not needed
  assert.equal(credentialStatus('source', { sourceExternal: true, sourceSet: true }).glyph, 'ok');
  // external + you OWN it (rfam: phd-dissertation) → Owner key covers it, NOT a warning
  const owned = credentialStatus('source', { sourceExternal: true, sourceSet: false, sourceOwned: true });
  assert.equal(owned.glyph, null);
  assert.match(owned.text, /Owner key|own/i);
  // external + third-party source you DON'T own → a Source key is genuinely needed
  assert.equal(credentialStatus('source', { sourceExternal: true, sourceSet: false, sourceOwned: false }).glyph, 'warn');
});

test('credentialStatus(claude): muted when off, ok when connected', () => {
  assert.equal(credentialStatus('claude', { claudeConnected: true }).glyph, 'ok');
  assert.equal(credentialStatus('claude', { claudeConnected: false }).glyph, null);
});

test('CREDENTIALS uses the standardized vocabulary and maps to stable internal names', () => {
  const byId = Object.fromEntries(CREDENTIALS.map(c => [c.id, c]));
  assert.equal(byId.owner.label, 'Owner key');
  assert.equal(byId.reviewer.label, 'Reviewer key');
  assert.equal(byId.source.label, 'Source key');
  assert.equal(byId.claude.label, 'Claude token');
  // internal names unchanged
  assert.equal(byId.source.secret, 'SOURCE_TOKEN');
  assert.equal(byId.claude.secret, 'CLAUDE_CODE_OAUTH_TOKEN');
});

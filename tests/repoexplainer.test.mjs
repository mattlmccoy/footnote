// tests/repoexplainer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROLES, repoExplainerHtml } from '../js/repoexplainer.js';

test('the three repo roles use the standardized vocabulary', () => {
  assert.deepEqual(REPO_ROLES.map(r => r.label), ['Source repo', 'Review repo', 'Workspace repo']);
});

test('each role has a non-empty plain-language description', () => {
  for (const r of REPO_ROLES) {
    assert.ok(r.key && r.label && r.desc, `role ${r.label} incomplete`);
    assert.ok(r.desc.length > 20);
  }
});

test('Source-repo description states main is never touched (only review-edits branches)', () => {
  const src = REPO_ROLES.find(r => r.key === 'source');
  assert.match(src.desc, /review-edits/);
  assert.match(src.desc, /never|only/i);
});

test('repoExplainerHtml renders all three roles and the one-physical-repo note', () => {
  const html = repoExplainerHtml();
  for (const r of REPO_ROLES) assert.ok(html.includes(r.label), `missing ${r.label}`);
  assert.match(html, /one (physical )?repo/i);   // "in the simple case they can be one physical repo"
});

test('repoExplainerHtml escapes nothing dynamic (static copy) and is a single element string', () => {
  const html = repoExplainerHtml();
  assert.ok(html.trim().startsWith('<'));
});

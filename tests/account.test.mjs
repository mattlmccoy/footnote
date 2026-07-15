// tests/account.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccount, overleafSealTargets, overleafExpiryDue, addWorkspace, removeWorkspace, overleafSaveTargets, needsOverleafSeal, withSealedRepo } from '../js/account.js';

test('normalizeAccount fills defaults', () => {
  assert.deepEqual(normalizeAccount(null), { workspaces: [], defaultWorkspace: 'My documents', overleaf: { sealedRepos: [], setAt: '' } });
  const a = normalizeAccount({ workspaces: ['A'], overleaf: { sealedRepos: ['me/r'], setAt: '2026-01-01' } });
  assert.deepEqual(a.workspaces, ['A']);
  assert.deepEqual(a.overleaf.sealedRepos, ['me/r']);
});

test('overleafSealTargets: repos that hold an Overleaf-linked doc (shared repo OR the doc own repo)', () => {
  const projects = [
    { id: 'a', workspace: 'W', dataRepo: 'me/hub', sourceRepo: '', overleaf: { bridgeRepo: 'me/a-ol' } },  // shared -> seal hub
    { id: 'b', dataRepo: 'me/b-data', sourceRepo: 'me/b-src' },                                              // not overleaf-linked
    { id: 'c', dataRepo: 'me/c-data', overleaf: { projectId: 'x' } },                                        // individual -> seal its data repo
  ];
  const cfg = { owner: 'me', hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
  assert.deepEqual(overleafSealTargets(projects, cfg).sort(), ['me/c-data', 'me/hub']);
});

test('overleafSealTargets: an edit-sheet/B2-linked doc (overleaf.projectId only, no bridgeRepo) is a seal target', () => {
  const projects = [{ id: 'd', dataRepo: 'me/hub', workspaceLabel: 'W', overleaf: { projectId: 'abc' } }];
  const cfg = { owner: 'me', hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
  assert.ok(overleafSealTargets(projects, cfg).includes('me/hub'));
});

test('overleafExpiryDue: ~1 year', () => {
  assert.equal(overleafExpiryDue('2025-07-01', new Date('2026-07-14')), true);   // >1yr
  assert.equal(overleafExpiryDue('2026-06-01', new Date('2026-07-14')), false);
  assert.equal(overleafExpiryDue('', new Date('2026-07-14')), false);            // never set -> not "due"
});

test('addWorkspace / removeWorkspace', () => {
  assert.deepEqual(addWorkspace({ workspaces: ['A'] }, 'B').workspaces, ['A', 'B']);
  assert.deepEqual(addWorkspace({ workspaces: ['A'] }, 'A').workspaces, ['A']);   // dedupe
  assert.deepEqual(removeWorkspace({ workspaces: ['A', 'B'] }, 'A').workspaces, ['B']);
});

test('overleafSaveTargets: always includes the workspace repo, even with zero Overleaf docs', () => {
  const cfg = { owner: 'me', hubRepo: 'me/hub', workspaceRepo: 'me/hub' };
  assert.deepEqual(overleafSaveTargets([], cfg), ['me/hub']);                       // zero docs -> just the workspace repo
  const projects = [
    { id: 'a', dataRepo: 'me/hub', overleaf: { bridgeRepo: 'me/a-ol' } },           // shared -> hub (already the ws repo)
    { id: 'c', dataRepo: 'me/c-data', overleaf: { projectId: 'x' } },               // individual -> its own data repo
  ];
  assert.deepEqual(overleafSaveTargets(projects, cfg).sort(), ['me/c-data', 'me/hub']);   // union, deduped
  assert.ok(overleafSaveTargets(projects, cfg).includes('me/hub'));
});

test('overleafSaveTargets: falls back to hubRepo when workspaceRepo is absent', () => {
  assert.deepEqual(overleafSaveTargets([], { hubRepo: 'me/hub' }), ['me/hub']);
});

test('needsOverleafSeal: true only for a truthy repo not already sealed', () => {
  const acct = { overleaf: { sealedRepos: ['me/hub'] } };
  assert.equal(needsOverleafSeal('me/hub', acct), false);     // already sealed
  assert.equal(needsOverleafSeal('me/new', acct), true);      // not sealed yet
  assert.equal(needsOverleafSeal('', acct), false);           // no repo
  assert.equal(needsOverleafSeal(null, acct), false);         // no repo
  assert.equal(needsOverleafSeal('me/x', null), true);        // null account -> nothing sealed yet
});

test('withSealedRepo: adds a repo to sealedRepos (deduped, normalized)', () => {
  const a = withSealedRepo({ overleaf: { sealedRepos: ['me/hub'] } }, 'me/new');
  assert.deepEqual(a.overleaf.sealedRepos, ['me/hub', 'me/new']);
  const b = withSealedRepo(a, 'me/new');                       // idempotent
  assert.deepEqual(b.overleaf.sealedRepos, ['me/hub', 'me/new']);
  const c = withSealedRepo(null, 'me/first');                  // null account
  assert.deepEqual(c.overleaf.sealedRepos, ['me/first']);
  assert.deepEqual(withSealedRepo({}, '').overleaf.sealedRepos, []);   // no repo -> unchanged
});

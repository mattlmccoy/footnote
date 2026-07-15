// tests/account.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccount, overleafSealTargets, overleafExpiryDue, addWorkspace, removeWorkspace } from '../js/account.js';

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

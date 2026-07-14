import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStorage, sourceLabel, resolveProject } from '../js/config.js';

const APP = { owner: 'me', dataRepo: 'me/footnote-projects', hubRepo: 'me/footnote-projects', workspaceRepo: 'me/footnote-projects' };

test('consolidated upload: source uploaded in workspace, data workspace', () => {
  const s = projectStorage(APP, { id: 'metro', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: '' });
  assert.equal(s.source.mode, 'uploaded');
  assert.equal(s.source.inWorkspace, true);
  assert.equal(s.source.repo, 'me/footnote-projects');
  assert.equal(s.source.prefix, 'metro/source/');
  assert.equal(s.data.dedicated, false);
  assert.equal(s.data.prefix, 'metro/');
  assert.equal(s.independent, false);
});

test('consolidated external: external source, workspace data', () => {
  const s = projectStorage(APP, { id: 'x', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: 'me/paper-src' });
  assert.equal(s.source.mode, 'external');
  assert.equal(s.source.inWorkspace, false);
  assert.equal(s.source.repo, 'me/paper-src');
  assert.equal(s.source.prefix, '');
  assert.equal(s.data.dedicated, false);
  assert.equal(s.independent, false);
});

test('fully independent: external source, dedicated data', () => {
  const s = projectStorage(APP, { id: 'diss', workspace: false, dataRepo: 'me/diss-data', sourceRepo: 'me/phd-dissertation' });
  assert.equal(s.source.mode, 'external');
  assert.equal(s.source.repo, 'me/phd-dissertation');
  assert.equal(s.data.dedicated, true);
  assert.equal(s.data.repo, 'me/diss-data');
  assert.equal(s.data.prefix, '');
  assert.equal(s.independent, true);
});

test('independent upload: uploaded to own source repo root, dedicated data', () => {
  const s = projectStorage(APP, { id: 'thesis', workspace: false, dataRepo: 'me/thesis-footnote-data', sourceRepo: 'me/thesis-source', uploaded: true });
  assert.equal(s.source.mode, 'uploaded');
  assert.equal(s.source.inWorkspace, false);
  assert.equal(s.source.repo, 'me/thesis-source');
  assert.equal(s.source.prefix, '');
  assert.equal(s.data.dedicated, true);
  assert.equal(s.independent, true);
});

test('no workspace repo configured: workspace flag degrades to legacy', () => {
  const s = projectStorage({ owner: 'me', dataRepo: 'me/d' }, { id: 'x', workspace: true, dataRepo: 'me/d', sourceRepo: 'me/src' });
  assert.equal(s.data.dedicated, true);   // no ws repo → treated as its own data repo
  assert.equal(s.source.prefix, '');
});

// --- sourceLabel contract (regression lock before refactor) ---
test('sourceLabel: external resolved cfg → {repo}', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: 'me/src', srcPrefix: '' }, true), { repo: 'me/src' });
});
test('sourceLabel: uploaded (srcPrefix set) → {text: uploaded}', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: 'me/ws', srcPrefix: 'x/source/' }, true), { text: 'uploaded' });
});
test('sourceLabel: nothing connected, parsed → empty text', () => {
  assert.deepEqual(sourceLabel({ sourceRepo: '', srcPrefix: '' }, true), { text: '' });
});

// --- parity: external source resolves identically for workspace vs dedicated data ---
test('parity: external source resolves identically for workspace vs dedicated data', () => {
  const ws = resolveProject(APP, [{ id: 'a', workspace: true, dataRepo: 'me/footnote-projects', sourceRepo: 'me/ext-src' }], 'a');
  const ded = resolveProject(APP, [{ id: 'b', workspace: false, dataRepo: 'me/b-data', sourceRepo: 'me/ext-src' }], 'b');
  assert.equal(ws.sourceRepo, 'me/ext-src');
  assert.equal(ded.sourceRepo, 'me/ext-src');
  assert.equal(ws.srcPrefix, '');
  assert.equal(ded.srcPrefix, '');
});

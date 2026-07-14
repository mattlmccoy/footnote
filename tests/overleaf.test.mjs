import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overleafMarker, secretName, bridgeUrlHint, syncStatusLabel, conflictSummary } from '../js/overleaf.js';

test('overleafMarker builds the committed marker', () => {
  assert.deepEqual(overleafMarker('  proj-1 ', ''), { projectId: 'proj-1', branch: 'master' });
  assert.deepEqual(overleafMarker('p', 'main'), { projectId: 'p', branch: 'main' });
});

test('secretName mirrors the Python derivation', () => {
  assert.equal(secretName('metrology-paper'), 'OVERLEAF_TOKEN_METROLOGY_PAPER');
  assert.equal(secretName('proj.1'), 'OVERLEAF_TOKEN_PROJ_1');
  assert.equal(secretName('a--b'), 'OVERLEAF_TOKEN_A_B');
  assert.equal(secretName('-x-'), 'OVERLEAF_TOKEN_X');
  assert.equal(secretName(''), 'OVERLEAF_TOKEN');
});

test('bridgeUrlHint shows the git-bridge URL without the token', () => {
  assert.equal(bridgeUrlHint('abc123'), 'https://git.overleaf.com/abc123');
});

test('syncStatusLabel + conflictSummary render human states', () => {
  assert.equal(syncStatusLabel('merged'), 'Synced with Overleaf');
  assert.equal(syncStatusLabel('conflict'), 'Needs resolution');
  assert.equal(conflictSummary({ files: ['a.tex', 'b.tex'] }), '2 files need resolution: a.tex, b.tex');
  assert.equal(conflictSummary({ files: ['only.tex'] }), '1 file needs resolution: only.tex');
  assert.equal(conflictSummary(null), '');
});

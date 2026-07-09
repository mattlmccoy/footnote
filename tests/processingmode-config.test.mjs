import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProject } from '../js/config.js';

// resolveProject must surface processingMode into the effective config so the owner UI (the
// Local/Cloud toggle + Send-to-Claude pill) can read _CFG.processingMode. Default local; cloud explicit.

const APP = { owner: 'me', dataRepo: 'me/d', hubRepo: 'me/d' };

test('default local when unset', () => {
  assert.equal(resolveProject(APP, [{ id: 'a', dataRepo: 'me/d' }], 'a').processingMode, 'local');
});

test('cloud when explicitly set (case-insensitive)', () => {
  assert.equal(resolveProject(APP, [{ id: 'b', dataRepo: 'me/d', processingMode: 'cloud' }], 'b').processingMode, 'cloud');
  assert.equal(resolveProject(APP, [{ id: 'c', dataRepo: 'me/d', processingMode: 'CLOUD' }], 'c').processingMode, 'cloud');
});

test('malformed defaults local', () => {
  assert.equal(resolveProject(APP, [{ id: 'd', dataRepo: 'me/d', processingMode: 'banana' }], 'd').processingMode, 'local');
});

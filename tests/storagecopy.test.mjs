// tests/storagecopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageLabel, storageInfo, storageBadge } from '../js/storagecopy.js';

test('labels + info are the approved wording', () => {
  assert.equal(storageLabel('shared'), 'Shared repo');
  assert.equal(storageLabel('individual'), 'Individual repo');
  assert.match(storageInfo('shared'), /folder inside one repo/i);
  assert.match(storageInfo('individual'), /dedicated GitHub repos/i);
  assert.deepEqual(storageBadge('shared'), { glyph: '◧', label: 'shared repo', kind: 'shared' });
  assert.deepEqual(storageBadge('individual'), { glyph: '◇', label: 'individual repo', kind: 'individual' });
});

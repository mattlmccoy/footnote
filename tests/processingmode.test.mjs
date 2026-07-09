import test from 'node:test';
import assert from 'node:assert/strict';
import { processingMode, processingModePatch, modeMarker, modePill } from '../js/processingmode.js';

// Must mirror the engine's ci_review_common.resolve_processing_mode: 'cloud' only when explicit;
// missing/malformed/local -> 'local'. Front-end and CI agree on the rule.

test('default (no field) is local', () => {
  assert.equal(processingMode(undefined), 'local');
  assert.equal(processingMode({}), 'local');
  assert.equal(processingMode({ processingMode: '' }), 'local');
});

test('explicit cloud', () => {
  assert.equal(processingMode({ processingMode: 'cloud' }), 'cloud');
  assert.equal(processingMode({ processingMode: 'Cloud' }), 'cloud');
});

test('malformed defaults local', () => {
  assert.equal(processingMode({ processingMode: 'banana' }), 'local');
  assert.equal(processingMode({ processingMode: 'local' }), 'local');
});

test('processingModePatch normalizes', () => {
  assert.deepEqual(processingModePatch('cloud'), { processingMode: 'cloud' });
  assert.deepEqual(processingModePatch('local'), { processingMode: 'local' });
  assert.deepEqual(processingModePatch('banana'), { processingMode: 'local' });
});

test('modeMarker is the mode.json the engine reads', () => {
  assert.deepEqual(modeMarker('cloud'), { processingMode: 'cloud' });
  assert.deepEqual(modeMarker('local'), { processingMode: 'local' });
});

test('modePill gives label + class', () => {
  assert.deepEqual(modePill('cloud'), { label: 'Cloud', cls: 'pm-cloud' });
  assert.deepEqual(modePill('local'), { label: 'Local', cls: 'pm-local' });
  assert.deepEqual(modePill(undefined), { label: 'Local', cls: 'pm-local' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleUnitIds } from '../js/releasegate.js';

const units = [
  { id: 'ch_a' },
  { id: 'ch_b' },
  { id: 'app_x', kind: 'appendix', home: 'ch_a' },
  { id: 'app_y', kind: 'appendix', home: 'ch_b' },
  { id: 'app_u', kind: 'appendix', home: null },   // uncited
];

test('chapters: visible iff in released', () => {
  assert.deepEqual(visibleUnitIds(units, ['ch_a']).sort(), ['app_x', 'ch_a']);
});

test('appendix follows its home chapter by default', () => {
  // ch_a released → app_x (home ch_a) visible; app_y (home ch_b) not
  const v = visibleUnitIds(units, ['ch_a']);
  assert.ok(v.includes('app_x'));
  assert.ok(!v.includes('app_y'));
});

test('override "show" forces an appendix visible even if home not released', () => {
  const v = visibleUnitIds(units, [], { app_y: 'show' });
  assert.ok(v.includes('app_y'));
});

test('override "hide" forces an appendix hidden even if home released', () => {
  const v = visibleUnitIds(units, ['ch_a'], { app_x: 'hide' });
  assert.ok(!v.includes('app_x'));
});

test('uncited appendix (no home) is hidden by default, shown only via override', () => {
  assert.ok(!visibleUnitIds(units, ['ch_a', 'ch_b']).includes('app_u'));
  assert.ok(visibleUnitIds(units, [], { app_u: 'show' }).includes('app_u'));
});

test('empty / missing args do not throw', () => {
  assert.deepEqual(visibleUnitIds(units), []);
  assert.deepEqual(visibleUnitIds(), []);
});

import { test } from 'node:test'; import assert from 'node:assert/strict';
import { themeIconName } from '../js/themeicon.js';

test('themeIconName shows a sun in dark mode (tap to go light) and a moon in light', () => {
  assert.equal(themeIconName(true), 'ti-sun');
  assert.equal(themeIconName(false), 'ti-moon');
});

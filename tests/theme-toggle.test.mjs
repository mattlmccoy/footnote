import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The owner theme toggle showed a moon in both themes because the icon was hardcoded and toggleTheme never
// updated it. Guard that the render uses themeIconName and the toggle re-syncs the icon.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('the theme button icon is derived from the current theme, not hardcoded', () => {
  // no #btn-theme rendered with a literal ti-moon (that was the stuck-moon bug)
  assert.ok(!/id="btn-theme"[^>]*>\s*<i class="ti ti-moon"/.test(app), 'theme button must not hardcode ti-moon');
  assert.match(app, /id="btn-theme"[^>]*>\s*<i class="ti \$\{themeIconName\(/, 'theme button icon must come from themeIconName');
});

test('toggleTheme re-syncs the icon after switching', () => {
  assert.match(app, /function toggleTheme\(\)\{[^}]*syncThemeIcon\(\)/, 'toggleTheme must call syncThemeIcon');
  assert.match(app, /function syncThemeIcon\(\)/, 'syncThemeIcon must exist');
});

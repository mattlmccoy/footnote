import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The reviewer shelf must let a reviewer remove a document (esp. a dead invite link) and use the app's
// theme colors so it matches the author home in light + dark. These guard the wiring.
const adv = readFileSync(new URL('../js/advisor.js', import.meta.url), 'utf8');

test('the shelf renders a per-book remove control wired to removeFromShelf', () => {
  assert.match(adv, /class="rvh-del"/, 'each book needs a remove button');
  assert.match(adv, /function removeFromShelf/, 'remove handler must exist');
  assert.match(adv, /removeFromShelf\(list\[/, 'the button must call removeFromShelf');
  assert.match(adv, /recentsRemove\(_rawRecents\(\)/, 'removal must persist to the recents store');
});

test('a dead invite link is detected and marked, not silently shown as healthy', () => {
  assert.match(adv, /r\.status === 401 \|\| r\.status === 403 \|\| r\.status === 404/, 'must detect auth/gone status');
  assert.match(adv, /function _markDead/, 'must have a dead-state marker');
});

test('the shelf palette uses theme tokens, not the old hardcoded cream/wood/green', () => {
  const style = adv.slice(adv.indexOf('rvh-style'), adv.indexOf('</style>`'));
  assert.match(style, /--ink:var\(--text\)/, 'ink should be the theme text color');
  assert.match(style, /--ln:var\(--border\)/, 'lines should be the theme border');
  assert.ok(!/#faf7ef|#e7e0d0|#4a7c59|#211f1a/.test(style), 'the old hardcoded warm palette must be gone');
});

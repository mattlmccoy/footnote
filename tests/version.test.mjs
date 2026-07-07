import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, latestFromHtml, isStale } from '../js/version.js';

test('parseVersion extracts the ?v= cachebust sha from a module URL', () => {
  assert.equal(parseVersion('./advisor.js?v=abc1234'), 'abc1234');
  assert.equal(parseVersion('https://footnotedocs.com/js/advisor.js?v=deadbee#frag'), 'deadbee');
  assert.equal(parseVersion('./advisor.js'), '');           // no version → empty
  assert.equal(parseVersion(''), '');
});

test('latestFromHtml finds the deployed <script src=...?v=sha> for a given bundle', () => {
  const html = `<!doctype html><script type="module" src="js/advisor.js?v=99ffee0"></script>`;
  assert.equal(latestFromHtml(html, 'advisor.js'), '99ffee0');
  // ignores other scripts, tolerates attribute order / query params
  const html2 = `<script src="js/app.js?v=aaa"></script><script defer src="./js/advisor.js?v=bbb&x=1"></script>`;
  assert.equal(latestFromHtml(html2, 'advisor.js'), 'bbb');
  assert.equal(latestFromHtml('<p>no scripts</p>', 'advisor.js'), '');
});

test('isStale only when both known and they differ', () => {
  assert.equal(isStale('abc', 'def'), true);
  assert.equal(isStale('abc', 'abc'), false);
  assert.equal(isStale('abc', ''), false);     // couldn't read latest → don't nag
  assert.equal(isStale('', 'def'), false);     // don't know our own → don't nag
});

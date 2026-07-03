import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellHtml, shellFilename, shellsForConfig } from '../scripts/gen-shells.mjs';
import { normalizeConfig } from '../js/config.js';

const CFG = normalizeConfig({
  owner: 'alice', dataRepo: 'alice/data',
  brand: { name: 'MyReview' },
  advisors: [{ id: 'CCS', name: 'Carolyn C. Seepersad' }],
  chapters: [{ id: 'ch1', n: 1, title: 'Intro' }],
});

test('shellHtml embeds a named advisor and loads advisor.js', () => {
  const html = shellHtml({ id: 'CCS', name: 'Carolyn C. Seepersad', shared: false }, CFG);
  const adv = JSON.parse(html.match(/window\.ADVISOR = (\{.*?\});/)[1]);
  assert.equal(adv.id, 'CCS');
  assert.equal(adv.name, 'Carolyn C. Seepersad');
  assert.equal('shared' in adv, false);          // named shells omit shared
  assert.match(html, /src="\.\/js\/advisor\.js/);
  assert.match(html, /id="topbar"/);
  assert.match(html, /id="read"/);
});

test('shellHtml embeds the shared lab flag', () => {
  const html = shellHtml({ id: 'general', name: 'Lab review', shared: true }, CFG);
  const adv = JSON.parse(html.match(/window\.ADVISOR = (\{.*?\});/)[1]);
  assert.equal(adv.shared, true);
  assert.equal(adv.id, 'general');
});

test('shellHtml titles the page from the brand name', () => {
  const html = shellHtml({ id: 'CCS', name: 'Carolyn C. Seepersad', shared: false }, CFG);
  assert.match(html, /<title>MyReview<\/title>/);
});

test('shellHtml escapes a quote in the reviewer name safely', () => {
  const html = shellHtml({ id: 'X', name: 'A "B" C', shared: false }, CFG);
  const adv = JSON.parse(html.match(/window\.ADVISOR = (\{.*?\});/s)[1]);
  assert.equal(adv.name, 'A "B" C');            // survives round-trip → no broken markup
});

test('shellFilename maps named→<id>.html and shared→review-lab.html', () => {
  assert.equal(shellFilename({ id: 'CCS', shared: false }), 'CCS.html');
  assert.equal(shellFilename({ id: 'general', shared: true }), 'review-lab.html');
});

test('shellsForConfig produces one entry per advisor plus the shared lab shell', () => {
  const shells = shellsForConfig(CFG);
  const names = shells.map(s => s.filename).sort();
  assert.deepEqual(names, ['CCS.html', 'review-lab.html']);
  assert.ok(shells.every(s => typeof s.html === 'string' && s.html.includes('window.ADVISOR')));
});

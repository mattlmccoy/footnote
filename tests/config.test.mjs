import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, ConfigError, dataRepoParts, storageKey,
  chapterMeta, daysToDeadline, advisorShellConfig, loadConfig,
  getConfig, _resetConfigCache,
} from '../js/config.js';

const MIN = { owner: 'alice', dataRepo: 'alice/data', chapters: [{ id: 'ch1', n: 1, title: 'Intro' }] };

test('normalizeConfig applies defaults for optional keys', () => {
  const c = normalizeConfig(MIN);
  assert.equal(c.brand.name, 'Footnote');
  assert.equal(c.brand.accent, '#2c64c4');
  assert.equal(c.brand.logo, 'brand/footnote-mark.png');
  assert.equal(c.doc.noun, 'document');
  assert.equal(c.doc.unitNoun, 'chapter');
  assert.equal(c.storagePrefix, 'footnote');
  assert.equal(c.advisorPortalFile, 'advisor.html');
  assert.equal(c.inviteWorkflow, 'invite.yml');
  assert.equal(c.ownerAuthorTag, 'owner');
  assert.deepEqual(c.reviewAgents, []);
  assert.deepEqual(c.advisors, []);
  assert.equal(c.deadline, null);
});

test('normalizeConfig preserves explicit values over defaults', () => {
  const c = normalizeConfig({ ...MIN, storagePrefix: 'thesis', brand: { name: 'MyReview', accent: '#ff0000' },
    doc: { noun: 'paper', unitNoun: 'section', title: 'T' }, advisors: [{ id: 'AB', name: 'Ada B' }] });
  assert.equal(c.storagePrefix, 'thesis');
  assert.equal(c.brand.name, 'MyReview');
  assert.equal(c.brand.accent, '#ff0000');
  assert.equal(c.brand.logo, 'brand/footnote-mark.png'); // still defaulted
  assert.equal(c.doc.noun, 'paper');
  assert.equal(c.advisors[0].id, 'AB');
});

test('normalizeConfig throws ConfigError listing every missing required key', () => {
  assert.throws(
    () => normalizeConfig({ owner: 'a' }),
    (e) => e instanceof ConfigError && /dataRepo/.test(e.message) && /chapters/.test(e.message),
  );
});

test('normalizeConfig rejects empty chapters array', () => {
  assert.throws(() => normalizeConfig({ ...MIN, chapters: [] }), ConfigError);
});

test('dataRepoParts splits owner/repo', () => {
  assert.deepEqual(dataRepoParts(normalizeConfig(MIN)), { owner: 'alice', repo: 'data' });
});

test('storageKey namespaces by storagePrefix', () => {
  const c = normalizeConfig({ ...MIN, storagePrefix: 'thesis' });
  assert.equal(storageKey(c, 'ghpat'), 'thesis:ghpat');
  assert.equal(storageKey(c, 'review:ch1'), 'thesis:review:ch1');
});

test('chapterMeta resolves a known chapter and falls back for unknown', () => {
  const c = normalizeConfig({ ...MIN, chapters: [{ id: 'ch1', n: 1, title: 'Intro', sourceFile: 'chapters/intro.tex' }] });
  assert.deepEqual(chapterMeta(c, 'ch1'), { n: 1, title: 'Intro', sourceFile: 'chapters/intro.tex' });
  assert.deepEqual(chapterMeta(c, 'missing'), { n: '?', title: 'missing', sourceFile: null });
});

test('daysToDeadline clamps at zero and returns null without a deadline', () => {
  const withDl = normalizeConfig({ ...MIN, deadline: { date: '2026-10-15', label: 'defense' } });
  const now = new Date('2026-10-05T00:00:00Z');
  assert.equal(daysToDeadline(withDl, now), 10);
  const past = new Date('2026-10-20T00:00:00Z');
  assert.equal(daysToDeadline(withDl, past), 0); // clamp ≥0
  assert.equal(daysToDeadline(normalizeConfig(MIN), now), null); // no deadline
});

test('advisorShellConfig returns id/name/shared per advisor plus a shared lab shell', () => {
  const c = normalizeConfig({ ...MIN, advisors: [{ id: 'AB', name: 'Ada B' }, { id: 'CD', name: 'Carl D' }] });
  const shells = advisorShellConfig(c);
  const ab = shells.find(s => s.id === 'AB');
  assert.equal(ab.name, 'Ada B');
  assert.equal(ab.shared, false);
  const lab = shells.find(s => s.shared === true);
  assert.equal(lab.id, 'general'); // the shared lab shell
});

test('loadConfig fetches, normalizes, and caches footnote.config.json', async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    assert.match(url, /footnote\.config\.json/);
    return { ok: true, json: async () => MIN };
  };
  const c1 = await loadConfig(fakeFetch);
  assert.equal(c1.owner, 'alice');
  assert.equal(c1.brand.name, 'Footnote'); // normalized
  const c2 = await loadConfig(fakeFetch);
  assert.equal(calls, 1); // cached — not re-fetched
  assert.equal(c1, c2);
});

test('loadConfig throws a clear error when the config is missing', async () => {
  const missing = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => loadConfig(missing, { force: true }), /footnote\.config\.json/);
});

test('getConfig throws before load and returns the cached config after', async () => {
  _resetConfigCache();
  assert.throws(() => getConfig(), ConfigError);
  await loadConfig(async () => ({ ok: true, json: async () => MIN }), { force: true });
  assert.equal(getConfig().owner, 'alice');
});

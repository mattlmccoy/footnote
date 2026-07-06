import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, ConfigError, dataRepoParts, storageKey,
  chapterMeta, daysToDeadline, advisorShellConfig, loadConfig,
  getConfig, _resetConfigCache, loadChapters,
  normalizeProject, resolveProject, loadProjects, dataRepoFromParams,
  writeProjectPatch, assistantEnabled, dataPath, advisorInviteUrl,
  sendMenuActions,
} from '../js/config.js';

const MIN = { owner: 'alice', dataRepo: 'alice/data' };   // chapters are NOT required — they come from parsing the user's document

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

test('normalizeConfig requires owner + dataRepo only (chapters are optional)', () => {
  assert.throws(
    () => normalizeConfig({ owner: 'a' }),
    (e) => e instanceof ConfigError && /dataRepo/.test(e.message) && !/chapters/.test(e.message),
  );
});

test('normalizeConfig defaults chapters to [] when absent (parsed from the document, not shipped)', () => {
  const c = normalizeConfig(MIN);
  assert.deepEqual(c.chapters, []);
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

async function withConfig() { await loadConfig(async () => ({ ok: true, json: async () => MIN }), { force: true }); }

// ---- multi-project (hub repo + projects.json) ----
const APP = normalizeConfig({ owner: 'alice', dataRepo: 'alice/data', hubRepo: 'alice/footnote-projects', brand: { name: 'MyReview' } });

test('normalizeProject requires id/name/dataRepo and defaults its doc/advisors', () => {
  const p = normalizeProject({ id: 'thesis', name: 'My Thesis', dataRepo: 'alice/thesis-data' });
  assert.equal(p.id, 'thesis');
  assert.equal(p.name, 'My Thesis');
  assert.equal(p.dataRepo, 'alice/thesis-data');
  assert.equal(p.doc.noun, 'document');       // default
  assert.deepEqual(p.advisors, []);
  assert.equal(p.deadline, null);
  assert.throws(() => normalizeProject({ id: 'x', name: 'y' }), ConfigError);  // no dataRepo
});

test('resolveProject merges the app config with the selected project (project wins on overlap)', () => {
  const projects = [
    normalizeProject({ id: 'a', name: 'A', dataRepo: 'alice/a-data', doc: { noun: 'thesis', unitNoun: 'chapter' }, deadline: { date: '2027-01-01', label: 'defense' } }),
    normalizeProject({ id: 'b', name: 'B', dataRepo: 'alice/b-data' }),
  ];
  const eff = resolveProject(APP, projects, 'a');
  assert.equal(eff.dataRepo, 'alice/a-data');   // project's data repo
  assert.equal(eff.doc.noun, 'thesis');         // project doc noun
  assert.equal(eff.brand.name, 'MyReview');     // inherited app brand
  assert.equal(eff.deadline.label, 'defense');
  assert.equal(eff.projectId, 'a');
});

test('resolveProject throws for an unknown project id', () => {
  assert.throws(() => resolveProject(APP, [], 'missing'), ConfigError);
});

test('loadProjects fetches + decodes projects.json from the hub repo', async () => {
  const arr = [{ id: 'a', name: 'A', dataRepo: 'alice/a-data' }];
  const b64 = Buffer.from(JSON.stringify(arr)).toString('base64');
  const got = await loadProjects(APP, 'tok', async (url) => {
    assert.match(url, /alice\/footnote-projects\/contents\/projects\.json/);
    return { ok: true, status: 200, json: async () => ({ content: b64 }) };
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'a');
  assert.equal(got[0].doc.noun, 'document');   // normalized
});

test('dataRepoFromParams reads a valid ?data= override, else falls back', () => {
  assert.equal(dataRepoFromParams('?a=CJS&n=X&data=alice/thesis-data', 'app/default'), 'alice/thesis-data');
  assert.equal(dataRepoFromParams('?a=CJS', 'app/default'), 'app/default');           // no data param
  assert.equal(dataRepoFromParams('?data=not-a-repo', 'app/default'), 'app/default'); // invalid → fallback
  assert.equal(dataRepoFromParams('', ''), '');
});

test('loadProjects returns [] without a token or when absent (404)', async () => {
  assert.deepEqual(await loadProjects(APP, null, async () => { throw new Error('no'); }), []);
  assert.deepEqual(await loadProjects(APP, 'tok', async () => ({ ok: false, status: 404 })), []);
});

test('loadChapters returns [] without a token (private data repo unreadable)', async () => {
  await withConfig();
  const chs = await loadChapters(null, async () => { throw new Error('must not fetch'); });
  assert.deepEqual(chs, []);
});

test('loadChapters fetches + decodes chapters.json from the data repo', async () => {
  await withConfig();
  const arr = [{ id: 'ch1', n: 1, title: 'Intro' }, { id: 'ch2', n: 2, title: 'Methods' }];
  const b64 = Buffer.from(JSON.stringify(arr)).toString('base64');
  const chs = await loadChapters('tok', async (url) => {
    assert.match(url, /alice\/data\/contents\/chapters\.json/);
    return { ok: true, status: 200, json: async () => ({ content: b64 }) };
  });
  assert.deepEqual(chs, arr);
});

test('loadChapters accepts a {chapters:[...]} wrapper too', async () => {
  await withConfig();
  const b64 = Buffer.from(JSON.stringify({ chapters: [{ id: 'a', n: 1, title: 'A' }] })).toString('base64');
  const chs = await loadChapters('tok', async () => ({ ok: true, status: 200, json: async () => ({ content: b64 }) }));
  assert.deepEqual(chs, [{ id: 'a', n: 1, title: 'A' }]);
});

test('loadChapters returns [] on 404 (no document imported yet)', async () => {
  await withConfig();
  const chs = await loadChapters('tok', async () => ({ ok: false, status: 404 }));
  assert.deepEqual(chs, []);
});

test('getConfig throws before load and returns the cached config after', async () => {
  _resetConfigCache();
  assert.throws(() => getConfig(), ConfigError);
  await loadConfig(async () => ({ ok: true, json: async () => MIN }), { force: true });
  assert.equal(getConfig().owner, 'alice');
});

test('writeProjectPatch GETs projects.json, patches the matching entry, and PUTs it back', async () => {
  const arr = [{ id: 'a', name: 'A', dataRepo: 'alice/a-data', sourceRepo: '' }, { id: 'b', name: 'B', dataRepo: 'alice/b-data' }];
  const b64 = Buffer.from(JSON.stringify(arr)).toString('base64');
  let putBody = null;
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ content: { sha: 'z' } }) }; }
    return { ok: true, status: 200, json: async () => ({ content: b64, sha: 'sha1' }) };
  };
  const out = await writeProjectPatch(APP, 'a', { sourceRepo: 'alice/a-source' }, 'tok', fake);
  // PUT carried the fetched sha (in-place update, no clobber)
  assert.equal(putBody.sha, 'sha1');
  const written = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
  assert.equal(written.find(p => p.id === 'a').sourceRepo, 'alice/a-source');
  assert.equal(written.find(p => p.id === 'b').dataRepo, 'alice/b-data');   // sibling untouched
  assert.equal(out.find(p => p.id === 'a').sourceRepo, 'alice/a-source');   // returns updated list
});

test('writeProjectPatch throws for an unknown project id', async () => {
  const b64 = Buffer.from(JSON.stringify([{ id: 'a', name: 'A', dataRepo: 'alice/a-data' }])).toString('base64');
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ content: b64, sha: 's' }) });
  await assert.rejects(() => writeProjectPatch(APP, 'nope', { sourceRepo: 'x' }, 'tok', fake), ConfigError);
});

test('assistantEnabled is off by default, on via the local flag or a configured reviewAgents list', () => {
  assert.equal(assistantEnabled({ reviewAgents: [] }, null), false);      // default: off
  assert.equal(assistantEnabled({ reviewAgents: [] }, '0'), false);
  assert.equal(assistantEnabled({ reviewAgents: [] }, '1'), true);        // user enabled it in Settings
  assert.equal(assistantEnabled({ reviewAgents: ['adversary'] }, null), true);  // instance ships agents
  assert.equal(assistantEnabled({}, null), false);                        // no reviewAgents key
});

test('sendMenuActions gates the Claude surface behind the master switch', () => {
  // AI OFF: only the deterministic Export action — no Claude-dependent rows at all.
  assert.deepEqual(sendMenuActions(false, ['adversary']), ['export']);
  assert.deepEqual(sendMenuActions(false, []), ['export']);
  // AI ON, no agents configured: apply-edits (Claude) + export, but NO run-agents row.
  assert.deepEqual(sendMenuActions(true, []), ['apply-edits', 'export']);
  // AI ON, agents configured: apply-edits + run-agents + export, in that order.
  assert.deepEqual(sendMenuActions(true, ['adversary', 'critic']), ['apply-edits', 'run-agents', 'export']);
  // Defensive: missing reviewAgents behaves like empty.
  assert.deepEqual(sendMenuActions(true, null), ['apply-edits', 'export']);
  assert.deepEqual(sendMenuActions(true, undefined), ['apply-edits', 'export']);
});

// ---- workspace consolidation: one repo, projects as subfolders via a dataPrefix ----
test('dataPath prepends the dataPrefix (empty = legacy passthrough)', () => {
  assert.equal(dataPath({ dataPrefix: '' }, 'reviews/ch1.json'), 'reviews/ch1.json');
  assert.equal(dataPath({}, 'chapters.json'), 'chapters.json');
  assert.equal(dataPath({ dataPrefix: 'metrology/' }, 'reviews/ch1.json'), 'metrology/reviews/ch1.json');
});

test('resolveProject uses the workspace repo + id prefixes when project.workspace is set', () => {
  const app = normalizeConfig({ owner: 'alice', dataRepo: 'alice/data', hubRepo: 'alice/footnote-workspace', workspaceRepo: 'alice/footnote-workspace' });
  const projects = [normalizeProject({ id: 'metro', name: 'Metrology', dataRepo: 'alice/footnote-workspace', workspace: true, sourceRepo: 'alice/footnote-workspace' })];
  const eff = resolveProject(app, projects, 'metro');
  assert.equal(eff.dataRepo, 'alice/footnote-workspace');
  assert.equal(eff.dataPrefix, 'metro/');
  assert.equal(eff.sourceRepo, 'alice/footnote-workspace');
  assert.equal(eff.srcPrefix, 'metro/source/');
});

test('resolveProject leaves prefixes empty for legacy per-project repos', () => {
  const app = normalizeConfig({ owner: 'alice', dataRepo: 'alice/data', hubRepo: 'alice/footnote-projects' });
  const projects = [normalizeProject({ id: 'a', name: 'A', dataRepo: 'alice/a-data', sourceRepo: 'alice/a-source' })];
  const eff = resolveProject(app, projects, 'a');
  assert.equal(eff.dataRepo, 'alice/a-data');
  assert.equal(eff.dataPrefix, '');
  assert.equal(eff.srcPrefix, '');
});

// ---- advisor invite links carry the workspace project prefix (&p=<id>) ----
test('advisorInviteUrl builds a portal link; adds &p only for workspace projects', () => {
  assert.equal(advisorInviteUrl('https://x/', { id: 'CJS', name: 'Chris S', dataRepo: 'alice/data' }),
    'https://x/advisor.html?a=CJS&n=Chris%20S&data=alice%2Fdata');
  assert.equal(advisorInviteUrl('https://x/', { id: 'CJS', name: 'Chris S', dataRepo: 'alice/ws', projectId: 'metro' }),
    'https://x/advisor.html?a=CJS&n=Chris%20S&data=alice%2Fws&p=metro');
  assert.equal(advisorInviteUrl('https://x/', { id: 'CJS', dataRepo: 'alice/data' }),
    'https://x/advisor.html?a=CJS&n=&data=alice%2Fdata');   // no name
});

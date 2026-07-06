import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCatalogView, agentCatalogHtml, loadAgentCatalog,
  partitionCatalog, buildAuthorJob, approveAuthored, deleteAuthored, editAuthored,
  writeAgentsJson } from '../js/agentcatalog.js';
import { normalizeConfig } from '../js/config.js';

const CAT = [
  { id: 'rigor', displayName: 'Rigor Critic', description: 'Red-teams claims.', category: 'critic', defaultOn: true, builtin: true },
  { id: 'writer', displayName: 'Writer', description: 'Drafts prose.', category: 'doer', defaultOn: false, builtin: false, execution: 'local' },
];

test('agentCatalogView marks the selected agents on and preserves metadata', () => {
  const rows = agentCatalogView(CAT, ['rigor']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'rigor');
  assert.equal(rows[0].on, true);
  assert.equal(rows[0].defaultOn, true);
  assert.equal(rows[1].id, 'writer');
  assert.equal(rows[1].on, false);
  assert.equal(rows[1].category, 'doer');
  assert.equal(rows[1].local, true);          // execution:"local" flagged for the badge
});

test('agentCatalogView tolerates empty / garbage catalogs', () => {
  assert.deepEqual(agentCatalogView([], []), []);
  assert.deepEqual(agentCatalogView(null, null), []);
  assert.equal(agentCatalogView([{}, { id: 'x' }], []).length, 1);   // entries with no id dropped
});

test('agentCatalogHtml renders a card per agent with name, description, category, and checked state', () => {
  const html = agentCatalogHtml(agentCatalogView(CAT, ['rigor']), { editable: true });
  assert.match(html, /Rigor Critic/);
  assert.match(html, /Red-teams claims/);
  assert.match(html, /data-agent="rigor"[^>]*checked/);          // selected → checked
  assert.ok(!/data-agent="writer"[^>]*checked/.test(html));       // unselected → not checked
  assert.match(html, /local/i);                                   // the local doer gets a Local badge (CSS uppercases)
});

test('agentCatalogHtml escapes untrusted text and disables inputs when not editable', () => {
  const rows = [{ id: 'x', displayName: '<b>x</b>', description: 'a & b', category: 'critic', on: false }];
  const html = agentCatalogHtml(rows, { editable: false });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /disabled/);
});

test('agentCatalogHtml shows an empty-state when the catalog is empty', () => {
  assert.match(agentCatalogHtml([], { editable: true }), /no agents/i);
});

const CFG = normalizeConfig({ owner: 'alice', dataRepo: 'alice/data' });

test('loadAgentCatalog reads the data-repo agents.json first (includes user overlay agents)', async () => {
  const arr = [{ id: 'rigor', displayName: 'Rigor' }, { id: 'heatr', builtin: false }];
  const b64 = Buffer.from(JSON.stringify(arr)).toString('base64');
  const got = await loadAgentCatalog('tok', CFG, async (url) => {
    if (url.includes('/contents/agents.json')) return { ok: true, json: async () => ({ content: b64 }) };
    throw new Error('must not hit the fallback when the repo has agents.json');
  });
  assert.deepEqual(got.map(a => a.id), ['rigor', 'heatr']);
});

test('loadAgentCatalog falls back to the shipped mirror without a token or on 404', async () => {
  const builtins = [{ id: 'clarity' }];
  const got = await loadAgentCatalog('', CFG, async (url) => {
    if (url.includes('data-template/agents.json')) return { ok: true, json: async () => builtins };
    return { ok: false, status: 404 };
  }, 'http://x/');
  assert.deepEqual(got.map(a => a.id), ['clarity']);
});

// --------------------------------------------------------------- B4: user-authored agents
test('partitionCatalog splits drafts from active (missing status = active)', () => {
  const cat = [
    { id: 'rigor', builtin: true },
    { id: 'mine', builtin: false, status: 'active' },
    { id: 'draft1', builtin: false, status: 'draft' },
  ];
  const { active, drafts } = partitionCatalog(cat);
  assert.deepEqual(active.map(a => a.id), ['rigor', 'mine']);
  assert.deepEqual(drafts.map(a => a.id), ['draft1']);
});

test('buildAuthorJob makes an author-agent payload, trimmed, with optional hints', () => {
  assert.deepEqual(buildAuthorJob('  Jargon Buster ', '  flag jargon  '),
    { type: 'author-agent', name: 'Jargon Buster', brief: 'flag jargon' });
  const withHints = buildAuthorJob('Sim', 'run it', { cwd: '/work', wantsTools: true });
  assert.equal(withHints.cwd, '/work');
  assert.equal(withHints.wantsTools, true);
});

test('approveAuthored flips a draft to active, leaves others untouched', () => {
  const list = [{ id: 'rigor', builtin: true }, { id: 'd', builtin: false, status: 'draft' }];
  const out = approveAuthored(list, 'd');
  assert.equal(out.find(a => a.id === 'd').status, 'active');
  assert.equal(out.find(a => a.id === 'rigor').builtin, true);
  assert.notEqual(out, list);                                   // new array (pure)
});

test('deleteAuthored removes an authored entry but never a builtin', () => {
  const list = [{ id: 'rigor', builtin: true }, { id: 'd', builtin: false, status: 'draft' }];
  assert.deepEqual(deleteAuthored(list, 'd').map(a => a.id), ['rigor']);
  assert.deepEqual(deleteAuthored(list, 'rigor').map(a => a.id), ['rigor', 'd']); // builtin protected
});

test('editAuthored merges a patch into an authored entry, preserving id + builtin:false', () => {
  const list = [{ id: 'd', builtin: false, status: 'draft', systemPrompt: 'old', source: 'authored' }];
  const out = editAuthored(list, 'd', { systemPrompt: 'new', id: 'hack', builtin: true });
  const e = out.find(a => a.id === 'd');
  assert.equal(e.systemPrompt, 'new');
  assert.equal(e.id, 'd');            // id can't be changed via edit
  assert.equal(e.builtin, false);     // can't be promoted to builtin
});

test('writeAgentsJson reads, transforms, and PUTs agents.json back with its sha', async () => {
  const CFGW = normalizeConfig({ owner: 'alice', dataRepo: 'alice/data' });
  const current = [{ id: 'rigor', builtin: true }];
  const b64 = Buffer.from(JSON.stringify(current)).toString('base64');
  let putBody = null;
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, status: 200 }; }
    return { ok: true, status: 200, json: async () => ({ content: b64, sha: 'sha1' }) };
  };
  const out = await writeAgentsJson(CFGW, 'tok', (list) => [...list, { id: 'new', builtin: false }], fake);
  assert.deepEqual(out.map(a => a.id), ['rigor', 'new']);
  assert.equal(putBody.sha, 'sha1');
  const written = JSON.parse(Buffer.from(putBody.content, 'base64').toString());
  assert.deepEqual(written.map(a => a.id), ['rigor', 'new']);
});

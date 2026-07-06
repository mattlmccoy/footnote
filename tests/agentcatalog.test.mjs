import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCatalogView, agentCatalogHtml, loadAgentCatalog } from '../js/agentcatalog.js';
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

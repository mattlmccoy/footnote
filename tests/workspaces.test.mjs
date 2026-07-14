// tests/workspaces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByWorkspace, workspaceNames, moveDocPatch, defaultWorkspaceName } from '../js/workspaces.js';

// The grouping label lives in `workspaceLabel` (a STRING), distinct from `workspace` (the storage boolean).
const P = (id, workspaceLabel) => ({ id, name: id, workspaceLabel, doc: { noun: 'paper' } });

test('groupByWorkspace: one implicit group when no labels (flat, backward-compat)', () => {
  const groups = groupByWorkspace([P('a'), P('b')], { defaultWorkspace: 'My documents' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'My documents');
  assert.deepEqual(groups[0].docs.map(d => d.id), ['a', 'b']);
  assert.equal(groups[0].isOnlyGroup, true);   // caller renders flat (no header) when true
});

test('groupByWorkspace: multiple labels -> ordered groups; unlabeled -> default', () => {
  const projects = [P('a', 'PhD'), P('b', 'Consulting'), P('c')];
  const groups = groupByWorkspace(projects, { workspaces: ['PhD', 'Consulting'], defaultWorkspace: 'My documents' });
  assert.deepEqual(groups.map(g => g.name), ['PhD', 'Consulting', 'My documents']);   // config order, default last
  assert.deepEqual(groups.map(g => g.docs.map(d => d.id)), [['a'], ['b'], ['c']]);
  assert.equal(groups[0].isOnlyGroup, false);
});

test('workspaceNames: config order unioned with any labels present, default excluded', () => {
  const names = workspaceNames([P('a', 'PhD'), P('b', 'Extra')], { workspaces: ['PhD', 'Consulting'] });
  assert.deepEqual(names, ['PhD', 'Consulting', 'Extra']);
});

test('a doc labeled with the literal default name folds into the default group (no dup)', () => {
  const g = groupByWorkspace([{ id: 'a', workspaceLabel: 'My documents' }, { id: 'b' }], { workspaces: [], defaultWorkspace: 'My documents' });
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].docs.map(d => d.id), ['a', 'b']);
  assert.deepEqual(workspaceNames([{ id: 'a', workspaceLabel: 'My documents' }, { id: 'c', workspaceLabel: 'PhD' }], { workspaces: [], defaultWorkspace: 'My documents' }), ['PhD']);
});

test('legacy storage boolean (workspace:true, no workspaceLabel) never throws; lands in default group', () => {
  const g = groupByWorkspace([{ id: 'x', workspace: true }], null);   // consolidated-repo doc, no grouping label
  assert.equal(g.length, 1);
  assert.equal(g[0].isOnlyGroup, true);
  assert.deepEqual(g[0].docs.map(d => d.id), ['x']);
});

test('moveDocPatch + defaultWorkspaceName', () => {
  assert.deepEqual(moveDocPatch('Consulting'), { workspaceLabel: 'Consulting' });
  assert.deepEqual(moveDocPatch(''), { workspaceLabel: '' });                 // back to default
  assert.equal(defaultWorkspaceName({ defaultWorkspace: 'X' }, 'me/hub'), 'X');
  assert.equal(defaultWorkspaceName({}, 'me/footnote-projects'), 'My documents');
});

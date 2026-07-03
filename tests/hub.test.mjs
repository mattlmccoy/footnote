import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProject, projectHref, defaultHubRepo, projectIdFromName } from '../js/hub.js';
import { normalizeConfig } from '../js/config.js';

const CFG = normalizeConfig({ owner: 'alice', dataRepo: 'alice/x', ownerPortalFile: 'owner.html' });

test('addProject appends a normalized project', () => {
  const out = addProject([], { id: 'thesis', name: 'My Thesis', dataRepo: 'alice/thesis-data' });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'thesis');
  assert.equal(out[0].doc.noun, 'document');   // normalized default
});

test('addProject rejects a duplicate id', () => {
  const base = addProject([], { id: 'a', name: 'A', dataRepo: 'alice/a' });
  assert.throws(() => addProject(base, { id: 'a', name: 'A2', dataRepo: 'alice/a2' }), /already exists|duplicate/i);
});

test('addProject rejects an invalid project (no dataRepo)', () => {
  assert.throws(() => addProject([], { id: 'a', name: 'A' }));
});

test('projectHref points the launcher at the reviewer for a project', () => {
  assert.equal(projectHref(CFG, 'thesis'), 'owner.html?project=thesis');
  assert.equal(projectHref(CFG, 'a b'), 'owner.html?project=a%20b');
});

test('defaultHubRepo suggests <owner>/footnote-projects', () => {
  assert.equal(defaultHubRepo(CFG), 'alice/footnote-projects');
  assert.equal(defaultHubRepo(normalizeConfig({ owner: 'bob', dataRepo: 'bob/x' })), 'bob/footnote-projects');
});

test('projectIdFromName slugs a project name to a stable id', () => {
  assert.equal(projectIdFromName('My Thesis'), 'my-thesis');
  assert.equal(projectIdFromName('  Paper #2!  '), 'paper-2');
  assert.equal(projectIdFromName(''), 'project');
});

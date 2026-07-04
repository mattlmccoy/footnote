import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProject, removeProject, updateProject, projectHref, defaultHubRepo, projectIdFromName, spineColor, SPINES, greetName, onboardingStep, ONBOARD_STEPS } from '../js/hub.js';
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

test('spineColor cycles through the SPINES palette by index', () => {
  assert.ok(Array.isArray(SPINES) && SPINES.length >= 4, 'SPINES is a non-trivial palette');
  assert.ok(SPINES.every(c => /^#[0-9a-fA-F]{6}$/.test(c)), 'every spine is a hex color');
  assert.equal(spineColor(0), SPINES[0]);
  assert.equal(spineColor(1), SPINES[1]);
  assert.equal(spineColor(SPINES.length), SPINES[0]);       // wraps
  assert.equal(spineColor(SPINES.length + 2), SPINES[2]);   // wraps + offset
});

test('spineColor is deterministic and stable per index', () => {
  assert.equal(spineColor(3), spineColor(3));
});

const twoProjects = () => addProject(
  addProject([], { id: 'a', name: 'A', dataRepo: 'alice/a-data', doc: { noun: 'thesis', unitNoun: 'section' } }),
  { id: 'b', name: 'B', dataRepo: 'alice/b-data' });

test('removeProject unregisters the matching id and leaves the rest', () => {
  const out = removeProject(twoProjects(), 'a');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'b');
});

test('removeProject is a no-op for an unknown id', () => {
  const base = twoProjects();
  assert.deepEqual(removeProject(base, 'nope'), base);
  assert.equal(removeProject([], 'x').length, 0);
});

test('updateProject patches fields but keeps the id stable', () => {
  const out = updateProject(twoProjects(), 'a', { name: 'A renamed', sourceRepo: 'alice/src' });
  const a = out.find(p => p.id === 'a');
  assert.equal(a.id, 'a');                 // id never changes on edit
  assert.equal(a.name, 'A renamed');
  assert.equal(a.sourceRepo, 'alice/src');
  assert.equal(a.dataRepo, 'alice/a-data'); // untouched
  assert.equal(out.find(p => p.id === 'b').name, 'B');   // other project untouched
});

test('updateProject deep-merges doc so unitNoun survives a noun edit', () => {
  const out = updateProject(twoProjects(), 'a', { doc: { noun: 'paper' } });
  const a = out.find(p => p.id === 'a');
  assert.equal(a.doc.noun, 'paper');
  assert.equal(a.doc.unitNoun, 'section');   // NOT reset to the default
});

test('onboardingStep walks Connect → Workspace → First project, then completes', () => {
  assert.ok(Array.isArray(ONBOARD_STEPS) && ONBOARD_STEPS.length === 3);
  // no token → step 0 (Connect)
  assert.equal(onboardingStep({ hasToken: false, hasHub: false, hasProjects: false }).index, 0);
  // token, no hub → step 1 (Workspace)
  assert.equal(onboardingStep({ hasToken: true, hasHub: false, hasProjects: false }).index, 1);
  // token + hub, no projects → step 2 (First project)
  assert.equal(onboardingStep({ hasToken: true, hasHub: true, hasProjects: false }).index, 2);
  // has projects → onboarding done (null)
  assert.equal(onboardingStep({ hasToken: true, hasHub: true, hasProjects: true }), null);
});

test('onboardingStep reports total + a label for the current step', () => {
  const s = onboardingStep({ hasToken: true, hasHub: false, hasProjects: false });
  assert.equal(s.total, 3);
  assert.equal(s.label, ONBOARD_STEPS[1]);
});

test('greetName uses the first name, falling back to login then a generic', () => {
  assert.equal(greetName({ name: 'Matt McCoy', login: 'mattlmccoy' }), 'Matt');
  assert.equal(greetName({ name: '  Jane   Doe ', login: 'jd' }), 'Jane');
  assert.equal(greetName({ name: '', login: 'octocat' }), 'octocat');
  assert.equal(greetName({ name: null, login: 'octocat' }), 'octocat');
  assert.equal(greetName({}), 'there');
  assert.equal(greetName(null), 'there');
});

test('updateProject ignores an attempt to change the id via patch', () => {
  const out = updateProject(twoProjects(), 'a', { id: 'hacked', name: 'A2' });
  assert.ok(out.find(p => p.id === 'a'));
  assert.ok(!out.find(p => p.id === 'hacked'));
});

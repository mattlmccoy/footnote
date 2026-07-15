import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProject, removeProject, updateProject, projectHref, defaultHubRepo, projectIdFromName, spineColor, SPINES, greetName, onboardingStep, ONBOARD_STEPS, texFileName, githubAccessStatus, overleafSettingsView, sealOverleafIntoRepos, settingsInnerHtml, storageControlHtml, workspacePickerHtml, wireStorageInfo } from '../js/hub.js';
import { normalizeConfig } from '../js/config.js';
import { moveDocPatch } from '../js/workspaces.js';
import { storageInfo } from '../js/storagecopy.js';

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

test('texFileName renders a doc noun as a LaTeX source filename', () => {
  assert.equal(texFileName('thesis'), 'thesis.tex');
  assert.equal(texFileName('Grant Proposal'), 'grant-proposal.tex');   // slug, lowercased
  assert.equal(texFileName('  Paper #2  '), 'paper-2.tex');
  assert.equal(texFileName(''), 'document.tex');                        // fallback
  assert.equal(texFileName(null), 'document.tex');
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

// ---- M3: account Settings page (pure builders + seal orchestration) ----

test('githubAccessStatus reflects token presence and never embeds the token value', () => {
  const c = githubAccessStatus('ghp_secretvalue');
  assert.equal(c.connected, true);
  assert.ok(!JSON.stringify(c).includes('ghp_secretvalue'));   // status carries a boolean, not the token
  assert.equal(githubAccessStatus('').connected, false);
  assert.equal(githubAccessStatus(null).connected, false);
});

test('overleafSettingsView: absent account = not sealed, not due (existing-user default)', () => {
  const v = overleafSettingsView(null, new Date('2026-07-14'));
  assert.equal(v.sealed, false);
  assert.equal(v.expiryDue, false);
  assert.deepStrictEqual(v.sealedRepos, []);
});

test('overleafSettingsView: >1yr setAt flags expiry due; fresh does not', () => {
  const due = overleafSettingsView({ overleaf: { sealedRepos: ['me/r'], setAt: '2025-07-01' } }, new Date('2026-07-14'));
  assert.equal(due.sealed, true);
  assert.equal(due.expiryDue, true);
  const fresh = overleafSettingsView({ overleaf: { sealedRepos: ['me/r'], setAt: '2026-06-01' } }, new Date('2026-07-14'));
  assert.equal(fresh.expiryDue, false);
});

test('sealOverleafIntoRepos seals OVERLEAF_TOKEN into each target repo and returns only repo names', async () => {
  const gp = [], ps = [];
  const deps = {
    getPublicKey: async (tok, repo) => { gp.push({ tok, repo }); return { key: 'pk-' + repo, key_id: 'kid' }; },
    putSecret: async (tok, pk, sealFn, name, value, repo) => { ps.push({ tok, name, value, repo, sealed: sealFn(pk.key, value) }); },
    sealFn: (key, value) => 'SEALED',
  };
  const out = await sealOverleafIntoRepos('T', ['me/hub', 'me/c-data'], 'super-secret', deps);
  assert.deepStrictEqual(out, ['me/hub', 'me/c-data']);              // returns the sealed repos, not the token
  assert.deepStrictEqual(gp.map(x => x.repo), ['me/hub', 'me/c-data']);
  assert.deepStrictEqual(ps.map(x => x.name), ['OVERLEAF_TOKEN', 'OVERLEAF_TOKEN']);
  assert.deepStrictEqual(ps.map(x => x.repo), ['me/hub', 'me/c-data']);
  assert.ok(out.every(r => !r.includes('super-secret')));           // no token leakage in the result
});

test('settingsInnerHtml renders three sections + empty states, never echoing a token value', () => {
  const html = settingsInnerHtml({
    github: githubAccessStatus('ghp_secretvalue'),
    overleaf: overleafSettingsView(null, new Date('2026-07-14')),
    names: [], sealTargets: ['me/hub'], workspaceRepo: 'me/hub',
  });
  assert.match(html, /GitHub access/i);
  assert.match(html, /Overleaf/i);
  assert.match(html, /Workspaces/i);
  assert.match(html, /Connected/i);
  assert.ok(!html.includes('ghp_secretvalue'));   // the token is never rendered into the page
});

test('settingsInnerHtml shows the 1-year renewal reminder only when the seal is due', () => {
  const due = settingsInnerHtml({
    github: githubAccessStatus('ghp_x'),
    overleaf: overleafSettingsView({ overleaf: { sealedRepos: ['me/r'], setAt: '2025-01-01' } }, new Date('2026-07-14')),
    names: ['PhD'], sealTargets: ['me/hub'], workspaceRepo: 'me/hub',
  });
  assert.match(due, /expire|renew|a year|12 months/i);
  const fresh = settingsInnerHtml({
    github: githubAccessStatus('ghp_x'),
    overleaf: overleafSettingsView({ overleaf: { sealedRepos: ['me/r'], setAt: '2026-06-01' } }, new Date('2026-07-14')),
    names: [], sealTargets: ['me/hub'], workspaceRepo: 'me/hub',
  });
  assert.ok(!/expire soon|please renew|renew your Overleaf/i.test(fresh));
});

// ---- M4.1: New Project storage relabel (Shared repo / Individual repo) + ⓘ copy ----

test('storageControlHtml reads "Shared repo" / "Individual repo" from storagecopy (single source of truth)', () => {
  const html = storageControlHtml();
  assert.match(html, />\s*Shared repo/);
  assert.match(html, />\s*Individual repo/);
  // The internal storage-style selection is UNCHANGED (shared→workspace, individual→independent).
  assert.match(html, /data-style="workspace"/);
  assert.match(html, /data-style="independent"/);
});

test('storageControlHtml shows the default (shared) description + per-option ⓘ preview markers', () => {
  const html = storageControlHtml();
  // One always-visible panel, initialized to the default-selected (shared) copy — no click needed to see it.
  assert.match(html, /id="np-store-info"/);
  assert.ok(html.includes(storageInfo('shared')), 'default (shared) copy shown in the panel');
  // Each option keeps an ⓘ that previews its copy.
  assert.match(html, /data-info="shared"/);
  assert.match(html, /data-info="individual"/);
});

// ---- M4.2: New Project workspace picker ----

test('workspacePickerHtml lists the default + workspaceNames + "New workspace…"', () => {
  const html = workspacePickerHtml({ names: ['PhD', 'Consulting'], def: 'My documents', preWs: '' });
  assert.match(html, /<select id="np-ws"/);
  assert.match(html, /value=""[^>]*>My documents/);        // the default group (empty label)
  assert.match(html, /value="PhD"/);
  assert.match(html, /value="Consulting"/);
  assert.match(html, /value="__new__"[^>]*>[^<]*New workspace/);
  // Default picked ⇒ the default option is the selected one.
  assert.match(html, /value=""[^>]*selected/);
});

test('workspacePickerHtml preselects the group whose ＋ tile was clicked (data-ws)', () => {
  const html = workspacePickerHtml({ names: ['PhD', 'Consulting'], def: 'My documents', preWs: 'Consulting' });
  assert.match(html, /value="Consulting"[^>]*selected/);
  assert.ok(!/value=""[^>]*selected/.test(html), 'default is NOT selected when a group is preselected');
});

test('New Project entry carries the grouping label in workspaceLabel, NEVER in the storage boolean', () => {
  // On create the sheet spreads moveDocPatch(picked) into the addProject fields. moveDocPatch returns
  // { workspaceLabel } — the grouping STRING — so the storage boolean `workspace` is never overwritten.
  const entry = { id: 'p', name: 'P', dataRepo: 'me/hub', workspace: true, ...moveDocPatch('PhD') };
  const p = addProject([], entry)[0];
  assert.equal(p.workspaceLabel, 'PhD');           // grouping label is the string
  assert.equal(p.workspace, true);                 // storage boolean untouched…
  assert.equal(typeof p.workspace, 'boolean');     // …and STILL a boolean (not a string)
});

test('New Project with the default workspace writes workspaceLabel:"" and leaves the storage boolean', () => {
  const entry = { id: 'p', name: 'P', dataRepo: 'me/b-data', workspace: false, ...moveDocPatch('') };
  const p = addProject([], entry)[0];
  assert.equal(p.workspaceLabel, '');
  assert.equal(p.workspace, false);
  assert.equal(typeof p.workspace, 'boolean');
});

test('wireStorageInfo: the description follows the SELECTED option (updates on select); ⓘ previews the other', () => {
  // Minimal DOM shim over exactly the surface wireStorageInfo touches (addEventListener + textContent).
  const mk = (attrs = {}) => {
    const el = { dataset: attrs.dataset || {}, textContent: '', _l: {}, _on: !!attrs.on,
      classList: { contains: c => c === 'on' && el._on },
      addEventListener(ev, fn) { el._l[ev] = fn; },
      click() { el._l.click && el._l.click({ stopPropagation() {} }); } };
    return el;
  };
  const segShared = mk({ dataset: { style: 'workspace' }, on: true });
  const segIndiv = mk({ dataset: { style: 'independent' } });
  const iShared = mk({ dataset: { info: 'shared' } });
  const iIndiv = mk({ dataset: { info: 'individual' } });
  const panel = mk();
  const scope = {
    querySelector(sel) { return sel === '#np-store-info' ? panel : (sel === '#np-style .fn-seg-b.on' ? segShared : null); },
    querySelectorAll(sel) { return sel === '#np-style .fn-seg-b' ? [segShared, segIndiv] : (sel === '.fn-i' ? [iShared, iIndiv] : []); },
  };
  wireStorageInfo(scope);
  assert.equal(panel.textContent, storageInfo('shared'));       // initialized to the selected (shared)
  segIndiv.click();                                             // SELECT Individual
  assert.equal(panel.textContent, storageInfo('individual'));   // description updates on selection (the bug fix)
  iShared.click();                                             // ⓘ previews shared without selecting
  assert.equal(panel.textContent, storageInfo('shared'));
});

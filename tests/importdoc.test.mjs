import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFormat, stagingPath, sourceRepoSuggestion, ensureRepo, repoFileSha, commitSourceFile, dataRepoSuggestion, planNewProjectRepos, newProjectPlan, pickEntryTex, stripTopFolder, isTextPath, commitSourceBinary, planMigration, listRepoTree, getRepoBlob, migrateProjectToWorkspace, folderTexIndex, outlineFromFiles, mergeOutlinePrev } from '../js/importdoc.js';

// ---- importFormat: dispatch an uploaded filename to a supported converter (or null) ----
test('importFormat detects .tex and .docx case-insensitively', () => {
  assert.equal(importFormat('main.tex'), 'tex');
  assert.equal(importFormat('Thesis.TEX'), 'tex');
  assert.equal(importFormat('My Thesis.docx'), 'docx');
  assert.equal(importFormat('paper.DOCX'), 'docx');
});

test('importFormat returns null for unsupported or missing formats', () => {
  assert.equal(importFormat('notes.md'), null);
  assert.equal(importFormat('scan.pdf'), null);
  assert.equal(importFormat('README'), null);
  assert.equal(importFormat(''), null);
  assert.equal(importFormat(undefined), null);
});

// ---- stagingPath: where an uploaded file of a given format is committed in the SOURCE repo ----
test('stagingPath commits .tex as the canonical entry main.tex at the repo root', () => {
  assert.equal(stagingPath('tex'), 'main.tex');
});

test('stagingPath stages a .docx under _import for the convert Action to consume', () => {
  assert.equal(stagingPath('docx'), '_import/upload.docx');
});

test('stagingPath returns null for an unknown format', () => {
  assert.equal(stagingPath('pdf'), null);
  assert.equal(stagingPath(null), null);
});

// ---- sourceRepoSuggestion: owner/<slug>-source from the project name ----
test('sourceRepoSuggestion slugifies the project name and appends -source', () => {
  assert.equal(sourceRepoSuggestion('My Thesis', 'alice'), 'alice/my-thesis-source');
  assert.equal(sourceRepoSuggestion('  Dissertation 2026 ', 'bob'), 'bob/dissertation-2026-source');
});

test('sourceRepoSuggestion falls back to a generic slug when the name is empty', () => {
  assert.equal(sourceRepoSuggestion('', 'alice'), 'alice/project-source');
  assert.equal(sourceRepoSuggestion('!!!', 'alice'), 'alice/project-source');
});

test('sourceRepoSuggestion omits the owner prefix when no owner is given', () => {
  assert.equal(sourceRepoSuggestion('My Thesis', ''), 'my-thesis-source');
  assert.equal(sourceRepoSuggestion('My Thesis'), 'my-thesis-source');
});

// ---- ensureRepo: create the source repo if missing (idempotent) ----
test('ensureRepo POSTs /user/repos with the repo name and auto_init', async () => {
  let body = null;
  const fake = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 201 }; };
  await ensureRepo('tok', 'alice/my-thesis-source', fake);
  assert.equal(body.name, 'my-thesis-source');
  assert.equal(body.auto_init, true);
});

test('ensureRepo tolerates an already-existing repo (422) without throwing', async () => {
  const fake = async () => ({ ok: false, status: 422 });
  await assert.doesNotReject(() => ensureRepo('tok', 'alice/existing', fake));
});

test('ensureRepo throws on a real failure (e.g. 403 missing scope)', async () => {
  const fake = async () => ({ ok: false, status: 403 });
  await assert.rejects(() => ensureRepo('tok', 'alice/x', fake), /403/);
});

// ---- repoFileSha: overwrite-guard primitive — does path already exist in the source repo? ----
test('repoFileSha returns the sha when the file exists', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ sha: 'abc123' }) });
  assert.equal(await repoFileSha('alice/src', 'main.tex', 'tok', fake), 'abc123');
});

test('repoFileSha returns null when the file is absent (404)', async () => {
  const fake = async () => ({ ok: false, status: 404 });
  assert.equal(await repoFileSha('alice/src', 'main.tex', 'tok', fake), null);
});

// ---- commitSourceFile: write text to the source repo (create or update) ----
test('commitSourceFile PUTs base64 content to the source repo and returns the new sha', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, method: opts && opts.method });
    if (opts && opts.method === 'PUT') {
      const b = JSON.parse(opts.body);
      assert.equal(Buffer.from(b.content, 'base64').toString('utf8'), '\\chapter{One}');
      return { ok: true, status: 201, json: async () => ({ content: { sha: 'new1' } }) };
    }
    return { ok: false, status: 404 };   // no existing file
  };
  const sha = await commitSourceFile('alice/src', 'main.tex', '\\chapter{One}', 'tok', 'import', fake);
  assert.equal(sha, 'new1');
  assert.ok(calls.some(c => c.method === 'PUT' && c.url.includes('/repos/alice/src/contents/main.tex')));
});

test('commitSourceFile passes the existing sha so an update overwrites in place', async () => {
  let putBody = null;
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ content: { sha: 'v2' } }) }; }
    return { ok: true, status: 200, json: async () => ({ sha: 'old' }) };   // existing file
  };
  await commitSourceFile('alice/src', 'main.tex', 'x', 'tok', 'import', fake);
  assert.equal(putBody.sha, 'old');
});

// ---- dataRepoSuggestion: auto-name the private comments/data repo from the project name ----
test('dataRepoSuggestion slugifies the name and appends -footnote-data', () => {
  assert.equal(dataRepoSuggestion('My Thesis', 'alice'), 'alice/my-thesis-footnote-data');
  assert.equal(dataRepoSuggestion('', 'alice'), 'alice/project-footnote-data');
  assert.equal(dataRepoSuggestion('My Thesis'), 'my-thesis-footnote-data');
});

// ---- planNewProjectRepos: resolve source+data repo names for a new project given the entry mode ----
test('planNewProjectRepos auto-names both repos for the local-file path', () => {
  const r = planNewProjectRepos({ mode: 'local', name: 'My Thesis', owner: 'alice' });
  assert.deepEqual(r, { sourceRepo: 'alice/my-thesis-source', dataRepo: 'alice/my-thesis-footnote-data' });
});

test('planNewProjectRepos uses the picked repo in github mode and still auto-names the data repo', () => {
  const r = planNewProjectRepos({ mode: 'github', name: 'My Thesis', owner: 'alice', sourceOverride: 'alice/existing-latex' });
  assert.equal(r.sourceRepo, 'alice/existing-latex');
  assert.equal(r.dataRepo, 'alice/my-thesis-footnote-data');
});

test('planNewProjectRepos lets Advanced overrides win over the auto names', () => {
  const r = planNewProjectRepos({ mode: 'local', name: 'My Thesis', owner: 'alice', sourceOverride: 'alice/custom-src', dataOverride: 'alice/custom-data' });
  assert.deepEqual(r, { sourceRepo: 'alice/custom-src', dataRepo: 'alice/custom-data' });
});

test('planNewProjectRepos leaves sourceRepo empty in github mode when nothing is picked (caller validates)', () => {
  const r = planNewProjectRepos({ mode: 'github', name: 'My Thesis', owner: 'alice' });
  assert.equal(r.sourceRepo, '');
});

// ---- newProjectPlan: storage-style (workspace|independent) x source (local|github|overleaf) matrix ----
const NPCFG = { owner: 'me', hubRepo: 'me/footnote-projects', workspaceRepo: 'me/footnote-projects' };

test('newProjectPlan workspace+local: data=ws, empty source, uploaded, creates only ws', () => {
  const p = newProjectPlan('workspace', 'local', 'Metro Paper', NPCFG);
  assert.equal(p.workspace, true);
  assert.equal(p.dataRepo, 'me/footnote-projects');
  assert.equal(p.sourceRepo, '');
  assert.equal(p.uploaded, true);
  assert.deepEqual(p.creates, ['me/footnote-projects']);
});

test('newProjectPlan workspace+github: external source, data=ws, not uploaded', () => {
  const p = newProjectPlan('workspace', 'github', 'Metro', NPCFG, { sourceRepo: 'me/paper-src' });
  assert.equal(p.workspace, true);
  assert.equal(p.dataRepo, 'me/footnote-projects');
  assert.equal(p.sourceRepo, 'me/paper-src');
  assert.equal(p.uploaded, false);
  assert.deepEqual(p.creates, ['me/footnote-projects']);
});

test('newProjectPlan independent+local: dedicated source + data repos, both created', () => {
  const p = newProjectPlan('independent', 'local', 'My Thesis', NPCFG);
  assert.equal(p.workspace, false);
  assert.equal(p.dataRepo, 'me/my-thesis-footnote-data');
  assert.equal(p.sourceRepo, 'me/my-thesis-source');
  assert.equal(p.uploaded, true);
  assert.deepEqual(p.creates.slice().sort(), ['me/my-thesis-footnote-data', 'me/my-thesis-source']);
});

test('newProjectPlan independent+github: external source, dedicated data (external not created)', () => {
  const p = newProjectPlan('independent', 'github', 'Diss', NPCFG, { sourceRepo: 'me/phd-dissertation' });
  assert.equal(p.workspace, false);
  assert.equal(p.dataRepo, 'me/diss-footnote-data');
  assert.equal(p.sourceRepo, 'me/phd-dissertation');
  assert.equal(p.uploaded, false);
  assert.deepEqual(p.creates, ['me/diss-footnote-data']);
});

test('newProjectPlan Advanced overrides win', () => {
  const p = newProjectPlan('independent', 'local', 'Diss', NPCFG, { sourceOverride: 'me/custom-src', dataOverride: 'me/custom-data' });
  assert.equal(p.sourceRepo, 'me/custom-src');
  assert.equal(p.dataRepo, 'me/custom-data');
});

// ---- folder upload: pick the entry .tex, strip the chosen-folder prefix, classify text vs binary ----
test('pickEntryTex prefers a file named main.tex', () => {
  const files = [{ path: 'proj/intro.tex', text: '\\section{x}' }, { path: 'proj/main.tex', text: '\\documentclass{article}\\begin{document}\\end{document}' }];
  assert.equal(pickEntryTex(files), 'proj/main.tex');
});

test('pickEntryTex falls back to the file with \\documentclass + \\begin{document}', () => {
  const files = [{ path: 'a/chap1.tex', text: '\\chapter{One}' }, { path: 'a/root.tex', text: '\\documentclass{book}\n\\begin{document}\n\\include{chap1}\n\\end{document}' }];
  assert.equal(pickEntryTex(files), 'a/root.tex');
});

test('pickEntryTex returns null when there is no .tex', () => {
  assert.equal(pickEntryTex([{ path: 'a/refs.bib', text: '@article{x}' }]), null);
  assert.equal(pickEntryTex([]), null);
});

test('stripTopFolder removes the selected-folder prefix so files land at the repo root', () => {
  assert.equal(stripTopFolder('mydraft/main.tex'), 'main.tex');
  assert.equal(stripTopFolder('mydraft/figures/fig1.pdf'), 'figures/fig1.pdf');
  assert.equal(stripTopFolder('main.tex'), 'main.tex');
});

// ---- folderTexIndex: from a read folder, find the entry .tex + build the \include resolver map ----
test('folderTexIndex finds the entry and maps includes for the resolver', () => {
  const files = [
    { path: 'main.tex', isText: true, text: '\\documentclass{report}\\include{chapters/intro}' },
    { path: 'chapters/intro.tex', isText: true, text: '\\chapter{Intro}' },
    { path: 'figures/fig1.pdf', isText: false, base64: 'AAAA' },
  ];
  const { entry, entryText, map } = folderTexIndex(files);
  assert.equal(entry, 'main.tex');
  assert.match(entryText, /\\include\{chapters\/intro\}/);
  // include paths are keyed WITHOUT the .tex extension, matching parseLatexChapters' resolver contract
  assert.equal(map['chapters/intro'], '\\chapter{Intro}');
  assert.equal('main' in map, true);
});

test('folderTexIndex returns a null entry when the folder has no .tex', () => {
  const { entry, entryText, map } = folderTexIndex([{ path: 'refs.bib', isText: true, text: '@a{x}' }]);
  assert.equal(entry, null);
  assert.equal(entryText, '');
  assert.deepEqual(Object.keys(map), []);
});

test('isTextPath treats source files as text and figures as binary', () => {
  assert.equal(isTextPath('main.tex'), true);
  assert.equal(isTextPath('references.bib'), true);
  assert.equal(isTextPath('elsarticle.cls'), true);
  assert.equal(isTextPath('figures/plot.pdf'), false);
  assert.equal(isTextPath('figures/scan.PNG'), false);
  assert.equal(isTextPath('logo.jpg'), false);
});

test('commitSourceBinary PUTs already-base64 content unchanged', async () => {
  let body = null;
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { body = JSON.parse(opts.body); return { ok: true, status: 201, json: async () => ({ content: { sha: 'b1' } }) }; }
    return { ok: false, status: 404 };
  };
  const sha = await commitSourceBinary('a/src', 'figures/x.png', 'QUJD', 'tok', 'add fig', fake);
  assert.equal(sha, 'b1');
  assert.equal(body.content, 'QUJD');
});

// ---- migrator: fold a legacy per-project repo into the workspace under <id>/ ----
test('planMigration maps paths under <id>/ (or <id>/source/) and skips .git/.github', () => {
  assert.deepEqual(planMigration(['reviews/a.json', 'chapters.json', '.github/workflows/x.yml'], 'metro'),
    [{ from: 'reviews/a.json', to: 'metro/reviews/a.json' }, { from: 'chapters.json', to: 'metro/chapters.json' }]);
  assert.deepEqual(planMigration(['main.tex', 'figures/a.pdf', '.git/config'], 'metro', 'source/'),
    [{ from: 'main.tex', to: 'metro/source/main.tex' }, { from: 'figures/a.pdf', to: 'metro/source/figures/a.pdf' }]);
});

test('listRepoTree returns only blob paths', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ tree: [
    { type: 'blob', path: 'a.json' }, { type: 'tree', path: 'd' }, { type: 'blob', path: 'd/b.json' }] }) });
  assert.deepEqual(await listRepoTree('alice/data', 'tok', fake), ['a.json', 'd/b.json']);
});

test('getRepoBlob returns whitespace-stripped base64 content', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ content: 'QUJD\nREVG\n' }) });
  assert.equal(await getRepoBlob('alice/data', 'x.png', 'tok', fake), 'QUJDREVG');
});

test('migrateProjectToWorkspace copies data + source blobs under <id>/ (and <id>/source/)', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (url.includes('/git/trees/')) {
      const repo = url.split('/repos/')[1].split('/git/')[0];
      const tree = repo.endsWith('-data') ? [{ type: 'blob', path: 'reviews/a.json' }] : [{ type: 'blob', path: 'main.tex' }];
      return { ok: true, status: 200, json: async () => ({ tree }) };
    }
    if (m === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201, json: async () => ({ content: { sha: 'x' } }) }; }
    return { ok: true, status: 200, json: async () => ({ content: 'QUJD', sha: null }) };   // GET contents
  };
  const proj = { id: 'metro', dataRepo: 'alice/metro-data', sourceRepo: 'alice/metro-source' };
  const res = await migrateProjectToWorkspace(proj, 'alice/ws', 'tok', null, fake);
  assert.deepEqual(res, { data: 1, src: 1 });
  assert.ok(puts.includes('metro/reviews/a.json'));
  assert.ok(puts.includes('metro/source/main.tex'));
});

test('migrateProjectToWorkspace skips source copy when it equals the data repo (in-workspace already)', async () => {
  const fake = async (url, opts) => {
    if (url.includes('/git/trees/')) return { ok: true, status: 200, json: async () => ({ tree: [{ type: 'blob', path: 'chapters.json' }] }) };
    if (opts && opts.method === 'PUT') return { ok: true, status: 201, json: async () => ({ content: { sha: 'x' } }) };
    return { ok: true, status: 200, json: async () => ({ content: 'QUJD', sha: null }) };
  };
  const res = await migrateProjectToWorkspace({ id: 'm', dataRepo: 'a/d', sourceRepo: 'a/d' }, 'a/ws', 'tok', null, fake);
  assert.equal(res.src, 0);
});


// ---- outlineFromFiles: nested outline from a folder's .tex files (entry + \input resolver) ----
test('outlineFromFiles builds the nested outline from a folder, resolving \\input chapters', () => {
  const files = [
    { path:'main.tex', isText:true, text:'\\title{D}\n\\chapter{Intro}\nIntro text here.\n\\input{chapters/methods}' },
    { path:'chapters/methods.tex', isText:true, text:'\\chapter{Methods}\nWe did things carefully.' },
  ];
  const o = outlineFromFiles(files);
  assert.equal(o.chapters.length, 2);
  assert.equal(o.chapters[0].title, 'Intro');
  assert.equal(o.chapters[1].title, 'Methods');
});
test('outlineFromFiles returns null when there is no .tex entry', () => {
  assert.equal(outlineFromFiles([{ path:'notes.md', isText:true, text:'hi' }]), null);
});

// ---- mergeOutlinePrev: preserve curated synopses/intro/title from a prior outline.json ----
test('mergeOutlinePrev preserves synopses/intro/title by normalized heading text', () => {
  const generated = {
    title: 'Source Title',
    intro: '',
    chapters: [
      { n:1, title:'Introduction', synopsis:'auto first sentence.', sections:[
        { title:'Motivation', synopsis:'auto motivation.', subsections:[
          { title:'Background', synopsis:'auto bg.' } ] } ] },
    ],
  };
  const prev = {
    title: 'Curated Outline Title',
    intro: 'A hand-written intro.',
    chapters: [
      { n:1, title:'Introduction', sections:[
        { title:'Motivation', synopsis:'why it matters, curated.', subsections:[
          { title:'Background', synopsis:'curated background.' } ] } ] },
    ],
  };
  const m = mergeOutlinePrev(generated, prev);
  assert.equal(m.title, 'Curated Outline Title');          // prev title wins
  assert.equal(m.intro, 'A hand-written intro.');          // prev intro wins
  assert.equal(m.chapters[0].sections[0].synopsis, 'why it matters, curated.');
  assert.equal(m.chapters[0].sections[0].subsections[0].synopsis, 'curated background.');
});
test('mergeOutlinePrev DROPS a generated synopsis when prev has no match (never invents); falls back to source title', () => {
  const generated = { title:'Src', intro:'gen intro', chapters:[
    { n:1, title:'New Chapter', synopsis:'generated syn.', sections:[] } ] };
  const prev = { title:'', chapters:[ { n:1, title:'Old Chapter', synopsis:'stale.' } ] };
  const m = mergeOutlinePrev(generated, prev);
  assert.equal(m.title, 'Src');                            // empty prev title → source title
  assert.equal(m.intro, 'gen intro');                      // prev has no intro key → keep generated
  assert.equal('synopsis' in m.chapters[0], false);        // no heading match → synopsis dropped, not invented
});
test('mergeOutlinePrev re-attaches an empty prev synopsis (keeps a section keyless like outline_gen.py)', () => {
  const generated = { title:'x', intro:'', chapters:[
    { n:1, title:'C', synopsis:'auto ch.', sections:[
      { title:'S', synopsis:'auto sec.', subsections:[] } ] } ] };
  // prev: chapter carries a synopsis key (''), section carries NO synopsis key at all.
  const prev = { title:'x', chapters:[ { n:1, title:'C', synopsis:'', sections:[ { title:'S', subsections:[] } ] } ] };
  const m = mergeOutlinePrev(generated, prev);
  assert.equal(m.chapters[0].synopsis, '');                // chapter key present in prev → set to ''
  assert.equal('synopsis' in m.chapters[0].sections[0], false);  // section keyless in prev → dropped
});
test('mergeOutlinePrev matches headings case/space/dash-insensitively', () => {
  const generated = { title:'x', intro:'', chapters:[
    { n:1, title:'Electrode–Part  Load', synopsis:'gen.', sections:[] } ] };
  const prev = { title:'x', chapters:[ { n:1, title:'electrode–part load', synopsis:'kept.' } ] };
  assert.equal(mergeOutlinePrev(generated, prev).chapters[0].synopsis, 'kept.');
});
test('mergeOutlinePrev tolerates a null/empty prev (no-op)', () => {
  const generated = { title:'T', intro:'i', chapters:[ { n:1, title:'C', synopsis:'s', sections:[] } ] };
  assert.deepEqual(mergeOutlinePrev(generated, null), generated);
});

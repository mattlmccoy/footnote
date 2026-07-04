import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFormat, stagingPath, sourceRepoSuggestion, ensureRepo, repoFileSha, commitSourceFile, dataRepoSuggestion, planNewProjectRepos } from '../js/importdoc.js';

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

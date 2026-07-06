import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_FILES, seedJsonFiles, seedDataRepo, RENDER_FILES, ensureRenderPipeline, APPLY_FILES, ensureApplyEngine, INVITE_FILES, ensureInvitePipeline } from '../js/seed.js';

test('SEED_FILES maps CI scripts to root and workflows into .github/workflows', () => {
  const byDest = Object.fromEntries(SEED_FILES.map(f => [f.dest, f.src]));
  assert.equal(byDest['ci_invite.py'], 'ci_invite.py');
  assert.equal(byDest['ci_notify_common.py'], 'ci_notify_common.py');
  assert.equal(byDest['.github/workflows/invite.yml'], 'workflows/invite.yml');
  assert.equal(byDest['.github/workflows/notify.yml'], 'workflows/notify.yml');
  assert.equal(byDest['.github/workflows/release-notify.yml'], 'workflows/release-notify.yml');
});

test('SEED_FILES includes the Phase 3 render pipeline (export scripts + driver + workflow)', () => {
  const byDest = Object.fromEntries(SEED_FILES.map(f => [f.dest, f.src]));
  // the export toolchain lands at export/ in the data repo, mirroring data-template/export/
  assert.equal(byDest['export/preprocess.py'], 'export/preprocess.py');
  assert.equal(byDest['export/srcmap.py'], 'export/srcmap.py');
  assert.equal(byDest['export/chapter-html.sh'], 'export/chapter-html.sh');
  assert.equal(byDest['export/shim.tex'], 'export/shim.tex');
  assert.equal(byDest['export/ieee.csl'], 'export/ieee.csl');
  // the driver at the repo root + the render workflow under .github/workflows/
  assert.equal(byDest['ci_render.py'], 'ci_render.py');
  assert.equal(byDest['.github/workflows/render.yml'], 'workflows/render.yml');
});

test('SEED_FILES includes the Claude round-trip apply engine (shared core + driver + workflow)', () => {
  const byDest = Object.fromEntries(SEED_FILES.map(f => [f.dest, f.src]));
  assert.equal(byDest['ci_review_common.py'], 'ci_review_common.py');
  assert.equal(byDest['ci_apply.py'], 'ci_apply.py');
  assert.equal(byDest['.github/workflows/apply.yml'], 'workflows/apply.yml');
});

test('SEED_FILES includes the agent catalog (engine module + JSON mirror for the client)', () => {
  const byDest = Object.fromEntries(SEED_FILES.map(f => [f.dest, f.src]));
  assert.equal(byDest['ci_agents.py'], 'ci_agents.py');   // the engine catalog + resolver
  assert.equal(byDest['agents.json'], 'agents.json');     // the seeded mirror (client display + B4 user agents)
  assert.equal(byDest['ci_local.py'], 'ci_local.py');     // the B5 local runner (execution:"local" agents)
  assert.equal(byDest['ci_authoring.py'], 'ci_authoring.py'); // the B4 authoring engine (describe → draft)
});

test('seedJsonFiles returns the initial config files (empty/honest)', () => {
  const byPath = Object.fromEntries(seedJsonFiles().map(f => [f.path, f.json]));
  assert.deepEqual(byPath['advisors.json'], { advisors: [], email_configured: false });
  assert.deepEqual(byPath['notify_config.json'], { author_email: '' });
  assert.deepEqual(byPath['notify_state.json'], {});
  assert.ok('release.json' in byPath);
});

test('seedDataRepo fetches each template and PUTs every file into the data repo', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    return { ok: true, status: 200, text: async () => `# content of ${url}` };   // GET template file
  };
  await seedDataRepo('alice/data', 'tok', fake, 'http://x/');
  // every template file + every seed JSON was PUT to alice/data
  assert.ok(puts.includes('ci_invite.py'));
  assert.ok(puts.includes('.github/workflows/invite.yml'));
  assert.ok(puts.includes('advisors.json'));
  assert.ok(puts.includes('notify_config.json'));
  assert.equal(puts.length, SEED_FILES.length + seedJsonFiles().length);
});

test('seedDataRepo tolerates an already-existing file (422) without throwing', async () => {
  const fake = async (url, opts) => opts && opts.method === 'PUT'
    ? { ok: false, status: 422 }
    : { ok: true, status: 200, text: async () => 'x' };
  await assert.doesNotReject(() => seedDataRepo('alice/data', 'tok', fake, 'http://x/'));
});

// ---- ensureRenderPipeline: idempotent self-heal so a project can build its reading view even if the
//      first seed failed (missing workflow scope, transient error) — the reliability fix. ----
test('RENDER_FILES is the render subset (export/*, ci_render.py, render.yml)', () => {
  const dests = RENDER_FILES.map(f => f.dest);
  assert.ok(dests.includes('export/preprocess.py'));
  assert.ok(dests.includes('ci_render.py'));
  assert.ok(dests.includes('.github/workflows/render.yml'));
  // it must NOT include the invite/notify CI (those are seeded separately)
  assert.ok(!dests.includes('.github/workflows/invite.yml'));
});

test('ensureRenderPipeline PUTs every missing render file and reports them', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    if (url.includes('/contents/')) return { ok: false, status: 404 };   // GET: file absent
    return { ok: true, status: 200, text: async () => `template ${url}` };  // GET template
  };
  const res = await ensureRenderPipeline('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, RENDER_FILES.length);
  assert.equal(res.already.length, 0);
  assert.ok(puts.includes('.github/workflows/render.yml'));
  assert.ok(puts.includes('ci_render.py'));
});

test('ensureRenderPipeline skips files that already exist (idempotent)', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: true, status: 200, json: async () => ({ content: Buffer.from('x').toString('base64'), sha: 's' }) };  // GET: exists, content matches template
    return { ok: true, status: 200, text: async () => 'x' };
  };
  const res = await ensureRenderPipeline('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, 0);
  assert.equal(res.already.length, RENDER_FILES.length);
  assert.equal(puts.length, 0);
});

test('ensureRenderPipeline REFRESHES a file whose content differs from the template (self-heal stale CI)', async () => {
  const bb = s => Buffer.from(s, 'utf8').toString('base64');
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { const body = JSON.parse(opts.body); puts.push({ dest: url.split('/contents/')[1], sha: body.sha }); return { ok: true, status: 200 }; }
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: true, status: 200, json: async () => ({ content: bb('STALE OLD SEEDED CONTENT'), sha: 'oldsha' }) };  // present but stale
    return { ok: true, status: 200, text: async () => 'FRESH TEMPLATE' };   // template differs from what's deployed
  };
  const res = await ensureRenderPipeline('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, RENDER_FILES.length);   // every stale file refreshed
  assert.equal(res.already.length, 0);
  assert.ok(puts.length === RENDER_FILES.length && puts.every(p => p.sha === 'oldsha'));   // updated in place with the existing sha
});

test('ensureRenderPipeline throws a clear workflow-scope error when GitHub blocks the workflow write (403)', async () => {
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') {
      return url.includes('.github/workflows/') ? { ok: false, status: 403 } : { ok: true, status: 201 };
    }
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: false, status: 404 };  // all absent
    return { ok: true, status: 200, text: async () => 'x' };
  };
  await assert.rejects(() => ensureRenderPipeline('alice/ws', 'tok', fake, 'http://x/'), /workflow-scope/);
});

// ---- ensureApplyEngine: idempotent self-heal for the Claude round-trip engine, so an EXISTING data
//      repo (created before the engine, or where the first seed failed) gets it once, repo-level. ----
test('APPLY_FILES is the apply-engine subset (ci_review_common, ci_apply, apply.yml)', () => {
  const dests = APPLY_FILES.map(f => f.dest);
  assert.ok(dests.includes('ci_review_common.py'));
  assert.ok(dests.includes('ci_apply.py'));
  assert.ok(dests.includes('ci_agents.py'));            // resolver must exist for run-agents to carry real prompts
  assert.ok(dests.includes('agents.json'));             // the catalog the engine reads for user agents
  assert.ok(dests.includes('ci_local.py'));             // the local runner for execution:"local" agents
  assert.ok(dests.includes('ci_authoring.py'));         // the authoring engine (user-described agents)
  assert.ok(dests.includes('.github/workflows/apply.yml'));
  // repo-level engine only — NOT the render or invite/notify CI
  assert.ok(!dests.includes('.github/workflows/render.yml'));
  assert.ok(!dests.includes('.github/workflows/invite.yml'));
});

test('ensureApplyEngine PUTs every missing apply file and reports them', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    if (url.includes('/contents/')) return { ok: false, status: 404 };   // GET: file absent
    return { ok: true, status: 200, text: async () => `template ${url}` };
  };
  const res = await ensureApplyEngine('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, APPLY_FILES.length);
  assert.equal(res.already.length, 0);
  assert.ok(puts.includes('.github/workflows/apply.yml'));
  assert.ok(puts.includes('ci_apply.py'));
});

test('ensureApplyEngine skips files that already exist (idempotent — safe to call every open)', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url); return { ok: true, status: 201 }; }
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: true, status: 200, json: async () => ({ content: Buffer.from('x').toString('base64'), sha: 's' }) };  // exists, content matches template
    return { ok: true, status: 200, text: async () => 'x' };
  };
  const res = await ensureApplyEngine('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, 0);
  assert.equal(res.already.length, APPLY_FILES.length);
  assert.equal(puts.length, 0);
});

test('ensureApplyEngine surfaces the workflow-scope error (403 on the workflow write)', async () => {
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') return url.includes('.github/workflows/') ? { ok: false, status: 403 } : { ok: true, status: 201 };
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: false, status: 404 };
    return { ok: true, status: 200, text: async () => 'x' };
  };
  await assert.rejects(() => ensureApplyEngine('alice/ws', 'tok', fake, 'http://x/'), /workflow-scope/);
});

test('seedDataRepo with a project prefix puts config JSON under <id>/ but CI code at the repo root', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    return { ok: true, status: 200, text: async () => 'x' };   // GET template
  };
  await seedDataRepo('alice/ws', 'tok', fake, 'http://x/', 'metro/');
  assert.ok(puts.includes('.github/workflows/invite.yml'));   // workflows stay repo-level (root/.github)
  assert.ok(puts.includes('ci_invite.py'));                   // CI scripts stay at the repo root
  assert.ok(puts.includes('metro/advisors.json'));            // per-project config under <id>/
  assert.ok(!puts.includes('advisors.json'));                 // NOT at the root (would be a phantom project)
});

// ---- ensureInvitePipeline: idempotent self-heal for the email/invite pipeline. A workspace data repo
//      seeded for render-only (render.yml present, invite.yml absent) made the email wizard 404 on the
//      invite workflow and misreport it as "token missing Secrets/Actions". This seeds it once. ----
test('INVITE_FILES is the invite/notify subset (ci_invite, ci_notify_*, invite/notify/release-notify yml)', () => {
  const dests = INVITE_FILES.map(f => f.dest);
  assert.ok(dests.includes('ci_invite.py'));
  assert.ok(dests.includes('ci_notify_common.py'));
  assert.ok(dests.includes('ci_notify_author.py'));
  assert.ok(dests.includes('ci_notify_advisors.py'));
  assert.ok(dests.includes('.github/workflows/invite.yml'));
  assert.ok(dests.includes('.github/workflows/notify.yml'));
  assert.ok(dests.includes('.github/workflows/release-notify.yml'));
  // email pipeline only — NOT render or apply
  assert.ok(!dests.includes('.github/workflows/render.yml'));
  assert.ok(!dests.includes('.github/workflows/apply.yml'));
  assert.ok(!dests.includes('ci_render.py'));
});

test('ensureInvitePipeline PUTs every missing invite file and reports them', async () => {
  const puts = [];
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') { puts.push(url.split('/contents/')[1]); return { ok: true, status: 201 }; }
    if (url.includes('/contents/')) return { ok: false, status: 404 };   // GET: file absent
    return { ok: true, status: 200, text: async () => `template ${url}` };
  };
  const res = await ensureInvitePipeline('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, INVITE_FILES.length);
  assert.equal(res.already.length, 0);
  assert.ok(puts.includes('.github/workflows/invite.yml'));
  assert.ok(puts.includes('ci_invite.py'));
});

test('ensureInvitePipeline skips files that already exist (idempotent)', async () => {
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') return { ok: true, status: 201 };
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: true, status: 200, json: async () => ({ content: Buffer.from('x').toString('base64'), sha: 's' }) };  // exists, content matches template
    return { ok: true, status: 200, text: async () => 'x' };
  };
  const res = await ensureInvitePipeline('alice/ws', 'tok', fake, 'http://x/');
  assert.equal(res.seeded.length, 0);
  assert.equal(res.already.length, INVITE_FILES.length);
});

test('ensureInvitePipeline throws workflow-scope when GitHub blocks the workflow write (403)', async () => {
  const fake = async (url, opts) => {
    if (opts && opts.method === 'PUT') {
      return url.includes('.github/workflows/') ? { ok: false, status: 403 } : { ok: true, status: 201 };
    }
    if (url.includes('api.github.com') && url.includes('/contents/')) return { ok: false, status: 404 };  // all absent
    return { ok: true, status: 200, text: async () => 'x' };
  };
  await assert.rejects(() => ensureInvitePipeline('alice/ws', 'tok', fake, 'http://x/'), /workflow-scope/);
});

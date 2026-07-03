import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_FILES, seedJsonFiles, seedDataRepo } from '../js/seed.js';

test('SEED_FILES maps CI scripts to root and workflows into .github/workflows', () => {
  const byDest = Object.fromEntries(SEED_FILES.map(f => [f.dest, f.src]));
  assert.equal(byDest['ci_invite.py'], 'ci_invite.py');
  assert.equal(byDest['ci_notify_common.py'], 'ci_notify_common.py');
  assert.equal(byDest['.github/workflows/invite.yml'], 'workflows/invite.yml');
  assert.equal(byDest['.github/workflows/notify.yml'], 'workflows/notify.yml');
  assert.equal(byDest['.github/workflows/release-notify.yml'], 'workflows/release-notify.yml');
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

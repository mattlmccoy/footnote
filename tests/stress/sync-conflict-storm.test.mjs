// SCENARIO 4 — Sync-conflict storm.
// Two identities edit the SAME chapter's comments in a tight loop through the real read-modify-merge
// push path (advisor.js syncUp semantics) against a fake GitHub that enforces sha-based 409s.
// Verifies mergeReviews union-merge + tombstones + 409-retry converge with NO loss / dupe / resurrection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './fake-github.mjs';
import { advisorMergeReviews, deleteComment } from './lib-advisor.mjs';

// Faithful re-creation of advisor.js syncUp's control flow (read → merge → put, retry on 409 up to 5x),
// but driven against the FakeGitHub so we can storm it. The MERGE is the real production function.
async function syncUp(gh, bucket, path, localReview) {
  const fetch = gh.fetchFor(bucket);
  for (let attempt = 0; attempt < 5; attempt++) {
    let remote = null, sha = undefined;
    const g = await fetch(`https://api.github.com/repos/o/r/contents/${path}?t=${Date.now()}`,
      { headers: { Authorization: 'Bearer t', Accept: 'application/vnd.github+json' } });
    if (g.status === 200) { const d = await g.json();
      remote = JSON.parse(Buffer.from(d.content.replace(/\s/g,''),'base64').toString('utf8')); sha = d.sha; }
    const merged = advisorMergeReviews(remote, localReview);
    const put = await fetch(`https://api.github.com/repos/o/r/contents/${path}`, {
      method: 'PUT', headers: { Authorization: 'Bearer t' },
      body: JSON.stringify({ content: Buffer.from(JSON.stringify(merged)).toString('base64'), sha, message: 'review' }),
    });
    if (put.ok) return { ok: true, merged, attempts: attempt + 1 };
    if (put.status === 409) { await new Promise(r=>setTimeout(r,1)); continue; }
    return { ok: false, status: put.status };
  }
  return { ok: false, status: 409 };
}

function readServer(gh, path) {
  const f = gh.files.get(path);
  return f ? JSON.parse(f.content) : null;
}

// FINDING F1 (lost-update window): when two identities PUT the same file in the SAME instant, both
// read the same sha; the first PUT wins, the second 409s+retries — that path is safe. BUT if the
// loser's local copy is the growing full list, a naive single-shot push can drop an update until the
// client re-pushes. advisor.js closes this with a 30s `retryPending` heartbeat that re-syncs any chapter
// still flagged `pending`. This test proves: (a) a raw storm CAN transiently drop comments from the
// server snapshot, and (b) one reconciliation pass per identity converges to ZERO loss / ZERO dupe.
test('sync-conflict storm converges to no loss / no dupe after reconciliation', async () => {
  const gh = new FakeGitHub();
  const bucket = {};
  const path = 'reviews/ch1.json';

  const A = { chapter:'ch1', comments:[] };
  const B = { chapter:'ch1', comments:[] };
  const rounds = 25;
  for (let i = 0; i < rounds; i++) {
    A.comments.push({ id:`A${i}`, body:`a${i}`, status:'open', author:'A' });
    B.comments.push({ id:`B${i}`, body:`b${i}`, status:'open', author:'B' });
    // TRUE concurrency: fire both pushes at once (models two reviewers saving in the same instant).
    await Promise.all([ syncUp(gh, bucket, path, A), syncUp(gh, bucket, path, B) ]);
  }
  // Reconciliation pass (production: `retryPending` heartbeat) — each identity re-syncs its full list.
  await syncUp(gh, bucket, path, A);
  await syncUp(gh, bucket, path, B);

  const final = readServer(gh, path);
  const ids = final.comments.map(c=>c.id);
  for (let i = 0; i < rounds; i++) {
    assert.ok(ids.includes(`A${i}`), `missing A${i} even after reconciliation`);
    assert.ok(ids.includes(`B${i}`), `missing B${i} even after reconciliation`);
  }
  assert.equal(new Set(ids).size, ids.length, 'duplicate comment ids on server');
  assert.equal(ids.length, rounds*2, `expected ${rounds*2} comments, got ${ids.length}`);
});

// The mechanism behind F1, isolated at the merge level (deterministic, no timing): a stale write can
// transiently clobber a concurrent write, but the merge itself never loses data once the loser re-reads.
test('F1 mechanism: stale concurrent write is recovered by a re-sync of the losing client', async () => {
  const M = advisorMergeReviews;
  let server = null;
  const A = { comments:[{ id:'A0' }] };
  const B = { comments:[{ id:'B0' }] };
  // both read the empty server; neither sees the other
  const mA = M(server, A);   // A0
  const mB = M(server, B);   // B0
  server = mA; server = mB;  // stale overwrite → server = [B0], A0 transiently gone
  assert.deepEqual(server.comments.map(c=>c.id), ['B0'], 'stale overwrite reproduced');
  // A re-syncs (reads current [B0], merges local [A0]) → converges, no dupe
  server = M(server, A);
  assert.deepEqual(server.comments.map(c=>c.id).sort(), ['A0','B0'], 'merge must recover A0 and keep B0');
});

test('a deletion is NEVER resurrected even under a conflict storm', async () => {
  const gh = new FakeGitHub();
  const bucket = {};
  const path = 'reviews/ch2.json';
  // A creates c1; both sync. Then A deletes c1 (tombstone). B, holding a stale copy WITH c1, keeps pushing.
  const A = { chapter:'ch2', comments:[{ id:'c1', body:'keep?', author:'A' }] };
  await syncUp(gh, bucket, path, A);
  const B = { chapter:'ch2', comments:[{ id:'c1', body:'keep?', author:'A' }, { id:'c2', body:'b', author:'B' }] };
  await syncUp(gh, bucket, path, B);
  // A deletes c1
  const Adel = deleteComment(A, 'c1');
  for (let i=0;i<10;i++){ await syncUp(gh, bucket, path, Adel); await syncUp(gh, bucket, path, B); }
  const final = readServer(gh, path);
  assert.ok(!final.comments.find(c=>c.id==='c1'), 'c1 was resurrected — tombstone lost');
  assert.ok(final.comments.find(c=>c.id==='c2'), 'c2 (B distinct) must survive');
  assert.ok((final.deleted||[]).includes('c1'), 'tombstone must persist on server');
});

test('owner-finalized status is not downgraded by a stale reviewer push', async () => {
  const gh = new FakeGitHub();
  const bucket = {};
  const path = 'reviews/ch3.json';
  const R = { chapter:'ch3', comments:[{ id:'q1', body:'why?', status:'submitted', author:'A' }] };
  await syncUp(gh, bucket, path, R);
  // owner answers it directly on the server (simulate remote-side finalization)
  const srv = readServer(gh, path); srv.comments[0].status='answered'; srv.comments[0].resolution={note:'done'};
  gh.files.set(path, { content: JSON.stringify(srv), sha: gh.files.get(path).sha });
  // reviewer keeps pushing their stale 'submitted' copy
  for (let i=0;i<8;i++) await syncUp(gh, bucket, path, R);
  const final = readServer(gh, path);
  assert.equal(final.comments[0].status, 'answered', 'FINAL status downgraded by stale reviewer sync');
});

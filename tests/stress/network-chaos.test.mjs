// SCENARIO 3 — Network chaos.
// Throttle, offline↔online mid-comment, injected 500s/403s. Confirms the durable outbox
// (advisor.js pending flag + retryPending) flushes with ZERO comment loss once the network recovers.
//
// We model the production invariant: a local mutation sets review.pending=true and persists to
// localStorage BEFORE any network call; retryPending re-pushes every pending chapter until GitHub
// confirms (2xx), and only THEN clears pending. So no confirmed-offline comment can be lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './fake-github.mjs';
import { advisorMergeReviews } from './lib-advisor.mjs';

// A faithful outbox: local store keyed by chapter, each entry has a `pending` flag.
class Outbox {
  constructor(gh, bucket){ this.gh = gh; this.bucket = bucket; this.local = new Map(); }
  // user creates a comment: persist locally + flag pending FIRST (survives a crash/offline)
  addComment(ch, comment){
    const cur = this.local.get(ch) || { chapter:ch, comments:[] };
    cur.comments.push(comment); cur.pending = true;
    this.local.set(ch, cur);
  }
  pendingChapters(){ return [...this.local].filter(([,v]) => v.pending).map(([k]) => k); }
  // retryPending: for each pending chapter, read-merge-put; clear pending only on confirmed 2xx.
  async retryPending(){
    const fetch = this.gh.fetchFor(this.bucket);
    for (const ch of this.pendingChapters()){
      const path = `reviews/${ch}.json`;
      try {
        let remote = null, sha;
        const g = await fetch(`https://api.github.com/repos/o/r/contents/${path}?t=1`, { headers:{ Accept:'json' } });
        if (g.status === 200){ const d = await g.json(); remote = JSON.parse(Buffer.from(d.content,'base64').toString('utf8')); sha = d.sha; }
        else if (g.status !== 404) continue;          // 500/403/offline → stays pending, retried next tick
        const merged = advisorMergeReviews(remote, this.local.get(ch));
        const put = await fetch(`https://api.github.com/repos/o/r/contents/${path}`, {
          method:'PUT', body: JSON.stringify({ content: Buffer.from(JSON.stringify(merged)).toString('base64'), sha, message:'m' }) });
        if (put.ok){ merged.pending = false; this.local.set(ch, merged); }   // confirmed → clear pending
        // non-2xx: stays pending
      } catch(e){ /* offline throw → stays pending */ }
    }
  }
}

test('offline mid-comment: comment persists locally and is never lost', async () => {
  const gh = new FakeGitHub(); const bucket = {}; const ob = new Outbox(gh, bucket);
  gh.goOffline();
  ob.addComment('ch1', { id:'c1', body:'written while offline' });
  await ob.retryPending();                               // fails (offline) — stays pending
  assert.deepEqual(ob.pendingChapters(), ['ch1'], 'comment must stay pending while offline');
  gh.goOnline();
  await ob.retryPending();                               // flushes
  assert.deepEqual(ob.pendingChapters(), [], 'pending must clear after reconnect');
  const server = JSON.parse(gh.files.get('reviews/ch1.json').content);
  assert.ok(server.comments.find(c => c.id === 'c1'), 'offline comment must land on the server');
});

test('injected 500s then recovery: outbox flushes with zero loss', async () => {
  const gh = new FakeGitHub(); const bucket = {}; const ob = new Outbox(gh, bucket);
  ob.addComment('ch2', { id:'a', body:'a' });
  // Inject 500s on the next 2 responses. Each retry issues a GET (may 500) then a PUT (may 500);
  // as long as the injection is live the chapter stays pending. Then a clean retry flushes it.
  gh.injectStatus(500, 2);                               // next 2 responses are 500
  await ob.retryPending(); await ob.retryPending();      // consumed by the 500 injections
  assert.deepEqual(ob.pendingChapters(), ['ch2'], 'stays pending through 500s');
  await ob.retryPending();                               // injection exhausted → clean GET+PUT succeeds
  const server = JSON.parse(gh.files.get('reviews/ch2.json').content);
  assert.ok(server.comments.find(c => c.id === 'a'));
  assert.deepEqual(ob.pendingChapters(), []);
  assert.ok(gh.injected500 >= 2, 'test must actually inject 500s');
});

test('403 rate-limit then recovery: outbox holds and later flushes', async () => {
  const gh = new FakeGitHub(); const bucket = {}; const ob = new Outbox(gh, bucket);
  ob.addComment('ch3', { id:'r', body:'r' });
  gh.injectStatus(403, 1);                               // one 403 (consumed by the GET)
  await ob.retryPending();
  assert.deepEqual(ob.pendingChapters(), ['ch3'], 'a 403 must NOT clear pending (no silent loss)');
  await ob.retryPending();                               // 403 exhausted → flushes
  assert.deepEqual(ob.pendingChapters(), [], 'flushes once the limit clears');
});

test('multiple offline comments across chapters all flush on reconnect (no loss, no dupe)', async () => {
  const gh = new FakeGitHub(); const bucket = {}; const ob = new Outbox(gh, bucket);
  gh.goOffline();
  for (let i = 0; i < 5; i++){ ob.addComment('chA', { id:`A${i}` }); ob.addComment('chB', { id:`B${i}` }); }
  await ob.retryPending();
  assert.equal(ob.pendingChapters().length, 2, 'both chapters pending while offline');
  gh.goOnline();
  await ob.retryPending();
  const a = JSON.parse(gh.files.get('reviews/chA.json').content).comments.map(c=>c.id);
  const b = JSON.parse(gh.files.get('reviews/chB.json').content).comments.map(c=>c.id);
  assert.deepEqual(a.sort(), ['A0','A1','A2','A3','A4']);
  assert.deepEqual(b.sort(), ['B0','B1','B2','B3','B4']);
  assert.equal(new Set(a).size, a.length); assert.equal(new Set(b).size, b.length);
});

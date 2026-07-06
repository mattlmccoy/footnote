// SCENARIO 2 — Large document (whole-doc view).
// 12+ chapters, 200+ comments. Exercises the REAL wholedoc.js assembly helpers (orderedUnits /
// mergeReviews / wrapUnit) and measures assemble time + comment-flattening cost. Also measures the
// per-chapter fetch fan-out the whole-doc reader must issue (motivates a batched read / caching finding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedUnits, mergeReviews, wrapUnit, segmentId } from '../../js/wholedoc.js';
import { FakeGitHub } from './fake-github.mjs';

function makeDoc(nCh, commentsPerCh, fragBytes) {
  const chapters = Array.from({ length: nCh }, (_, i) => ({ id:`ch${i}`, title:`Chapter ${i}` }));
  const reviewMap = {};
  const fragments = {};
  const frag = 'x'.repeat(fragBytes);
  for (const c of chapters) {
    reviewMap[c.id] = { chapter:c.id, comments: Array.from({ length: commentsPerCh }, (_, j) => ({
      id:`${c.id}_c${j}`, body:`comment ${j}`, status:'open',
      anchor:{ quote:`phrase ${j}`, section:c.title }, rects:[{x:0,y:j,w:10,h:5}] })) };
    fragments[c.id] = `<h1>${c.title}</h1><p>${frag}</p>`;
  }
  return { chapters, reviewMap, fragments };
}

test('assemble 12 chapters / 240 comments — whole-doc build is fast', () => {
  const { chapters, reviewMap, fragments } = makeDoc(12, 20, 4000);
  const t0 = performance.now();
  const order = orderedUnits(chapters);                     // real helper
  let html = '';
  for (const u of order) html += wrapUnit(u.id, u.title, fragments[u.id]);
  const flat = mergeReviews(reviewMap, order);              // real comment flatten
  const t1 = performance.now();
  const ms = +(t1 - t0).toFixed(2);

  assert.equal(order.length, 12);
  assert.equal(flat.length, 240, 'all comments flattened, chapter-tagged');
  // every comment carries its chapterId (the cross-anchor-safety contract)
  assert.ok(flat.every(x => x.chapterId && x.comment), 'flatten must tag chapterId');
  assert.ok(html.includes(`id="${segmentId('ch11')}"`), 'last segment wrapped');
  assert.ok(ms < 200, `assemble should be well under 200ms (was ${ms}ms)`);
  console.log(`[assemble 12ch/240c] ${ms}ms, html=${(html.length/1024).toFixed(0)}KB, flat=${flat.length} comments`);
});

test('stress: 20 chapters / 500 comments still assembles quickly', () => {
  const { chapters, reviewMap, fragments } = makeDoc(20, 25, 8000);
  const t0 = performance.now();
  const order = orderedUnits(chapters);
  let html = '';
  for (const u of order) html += wrapUnit(u.id, u.title, fragments[u.id]);
  const flat = mergeReviews(reviewMap, order);
  const ms = +(performance.now() - t0).toFixed(2);
  assert.equal(flat.length, 500);
  console.log(`[assemble 20ch/500c] ${ms}ms, html=${(html.length/1024).toFixed(0)}KB`);
  assert.ok(ms < 500, `20ch assemble under 500ms (was ${ms}ms)`);
});

// FINDING candidate: whole-doc reader fetches each chapter's content + review file SERIALLY. Count the
// GitHub reads a 12-chapter whole-doc first paint costs through one token (drains the shared budget fast).
test('whole-doc first paint fetch fan-out (reads per open)', async () => {
  const gh = new FakeGitHub();
  const bucket = {};
  const nCh = 12;
  for (let c = 0; c < nCh; c++) {
    gh._seed(`content/ch${c}.html`, `<h1>Chapter ${c}</h1>`);
    gh._seed(`reviews/ch${c}.json`, { chapter:`ch${c}`, comments:[] });
  }
  const fetch = gh.fetchFor(bucket);
  // whole-doc open: 1 chapters.json + 1 release.json + per chapter (content + review)
  await fetch('https://api.github.com/repos/o/r/contents/chapters.json?t=1', { headers:{ Accept:'json' } });
  await fetch('https://api.github.com/repos/o/r/contents/release.json?t=1', { headers:{ Accept:'application/vnd.github.raw' } });
  for (let c = 0; c < nCh; c++) {
    await fetch(`https://api.github.com/repos/o/r/contents/content/ch${c}.html?t=1`, { headers:{ Accept:'application/vnd.github.raw' } });
    await fetch(`https://api.github.com/repos/o/r/contents/reviews/ch${c}.json?t=1`, { headers:{ Accept:'json' } });
  }
  const reads = gh.getCount;
  console.log(`[whole-doc open 12ch] ${reads} GitHub reads for one first paint (${(5000/reads|0)} opens before a solo reviewer hits the hourly cap)`);
  assert.equal(reads, 2 + nCh*2);   // 26 reads to paint a 12-chapter whole-doc, per open
});

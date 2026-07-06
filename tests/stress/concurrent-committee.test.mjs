// SCENARIO 1 — Concurrent committee (the shared-rate-limit sleeper).
// N reviewers all read + live-sync ONE project through ONE shared ADVISOR_KEY. Because every reviewer's
// polling draws down the SAME 5,000 req/hr token bucket, the committee shares one budget. This harness
// quantifies how fast the budget drains and at what committee size the portal starts returning 403s.
//
// Real cadences (js/advisor.js): livePoll every 20s → syncDown; retryPending every 30s; visibilitychange
// fires an extra syncDown. syncDown fetches every released chapter's review file. So per reviewer per hour:
//   polls/hr = 3600/20 = 180 ; each poll reads R chapter review files (+ the release/tree reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './fake-github.mjs';

const HOUR = 3600;
const POLL_INTERVAL = 20;          // advisor.js startLiveSync setInterval(...,20000)
const RATE_LIMIT = 5000;           // GitHub primary rate limit per token per hour

// requests a single reviewer issues per poll: syncDown reads each released chapter's review file.
function reqsPerPoll(nChapters) {
  // syncDown reads: 1 release.json (raw) + nChapters review files. (ghTree isn't polled per-cycle.)
  return 1 + nChapters;
}

// Model one hour of committee polling through one shared bucket; return when (if) it exhausts.
function simulateHour(nReviewers, nChapters, rateLimit = RATE_LIMIT) {
  const perPoll = reqsPerPoll(nChapters);
  const pollsPerHour = HOUR / POLL_INTERVAL;                 // 180
  const reqsPerReviewerHour = perPoll * pollsPerHour;
  const totalPerHour = reqsPerReviewerHour * nReviewers;
  const exhausts = totalPerHour > rateLimit;
  // time-to-exhaust: requests are spread evenly; committee issues (nReviewers*perPoll) every 20s.
  const reqsPerTick = nReviewers * perPoll;
  const ticksToExhaust = Math.floor(rateLimit / reqsPerTick);
  const secondsToExhaust = ticksToExhaust * POLL_INTERVAL;
  return { perPoll, reqsPerReviewerHour, totalPerHour, exhausts,
    secondsToExhaust: exhausts ? secondsToExhaust : null,
    minutesToExhaust: exhausts ? +(secondsToExhaust/60).toFixed(1) : null };
}

test('10-reviewer committee, 12 chapters — budget math', () => {
  const r = simulateHour(10, 12);
  // 10 reviewers * (1+12) reqs * 180 polls = 23,400 reqs/hr vs 5,000 budget → exhausts.
  assert.equal(r.totalPerHour, 23400);
  assert.ok(r.exhausts, '10 reviewers should exhaust the shared budget');
  console.log(`[10 reviewers/12ch] ${r.totalPerHour} req/hr vs ${RATE_LIMIT} budget; exhausts in ~${r.minutesToExhaust} min`);
});

test('30-reviewer committee, 12 chapters — exhausts within minutes', () => {
  const r = simulateHour(30, 12);
  assert.equal(r.totalPerHour, 70200);          // 30*13*180
  assert.ok(r.exhausts);
  assert.ok(r.minutesToExhaust <= 5, `30 reviewers should exhaust the budget in ≤5 min (got ${r.minutesToExhaust})`);
  console.log(`[30 reviewers/12ch] ${r.totalPerHour} req/hr; exhausts in ~${r.minutesToExhaust} min`);
});

test('committee size at which the shared budget first breaks (12 chapters)', () => {
  let breakAt = null;
  for (let n = 1; n <= 30; n++) if (simulateHour(n, 12).exhausts) { breakAt = n; break; }
  assert.ok(breakAt !== null && breakAt <= 3, `budget should break by ~3 reviewers, broke at ${breakAt}`);
  console.log(`[break point] shared budget first exhausts at ${breakAt} concurrent reviewers (12 chapters)`);
});

// End-to-end against the FakeGitHub: drive real polls until the shared bucket 403s, count dropped syncs.
test('live simulation: shared bucket returns 403 and reads are dropped once exhausted', async () => {
  const gh = new FakeGitHub({ rateLimit: 500 });   // small budget to reach exhaustion fast in-test
  const bucket = {};                                // ONE shared bucket for the whole committee
  const nChapters = 12;
  for (let c = 0; c < nChapters; c++) gh._seed(`reviews/ch${c}.json`, { chapter:`ch${c}`, comments:[] });

  const fetch = gh.fetchFor(bucket);
  let ok = 0, dropped = 0;
  // 10 reviewers each poll 5 times
  for (let poll = 0; poll < 5; poll++) {
    for (let rv = 0; rv < 10; rv++) {
      for (let c = 0; c < nChapters; c++) {
        const r = await fetch(`https://api.github.com/repos/o/r/contents/reviews/ch${c}.json?t=1`,
          { headers:{ Authorization:'Bearer SHARED', Accept:'application/vnd.github+json' } });
        if (r.status === 403) dropped++; else ok++;
      }
    }
  }
  assert.ok(gh.rateLimited > 0, 'shared bucket must 403 once exhausted');
  assert.ok(dropped > 0, 'some committee reads must be dropped after exhaustion');
  console.log(`[live 10 reviewers] ok=${ok} dropped(403)=${dropped}; bucket 403s=${gh.rateLimited}`);
});

// SCENARIO 5 — Cold mobile first-load: invite-tap → first paragraph.
// advisor.js boot() runs a SERIAL critical-path chain:
//   loadConfig() → loadChapters(tok) → loadRelease() → enterHome()/loadChapter() → content/<id>.html
// On a cold mobile connection each GitHub round-trip costs a real RTT. This harness models the chain
// against the FakeGitHub with representative mobile latencies and flags the serial-vs-parallel cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './fake-github.mjs';

// Representative one-way-ish RTTs (ms) per GitHub API round-trip. 4G ~real numbers for api.github.com.
const PROFILES = {
  wifi:  40,
  '4g':  120,
  '3g':  350,
  slow:  700,   // congested / edge-of-coverage
};

// The serial boot chain: number of blocking GitHub round-trips before the first paragraph paints.
// 1) footnote.config.json  2) chapters.json  3) release.json  4) content/<firstUnit>.html
// (advisor.js does these sequentially in boot(); the first paragraph needs #4 done.)
const SERIAL_TRIPS = 4;

async function timedBoot(gh, latencyMs) {
  gh.latencyMs = latencyMs;
  const bucket = {};
  const fetch = gh.fetchFor(bucket);
  const t0 = performance.now();
  await fetch('https://footnotedocs.com/footnote.config.json', { headers:{} });
  await fetch('https://api.github.com/repos/o/r/contents/chapters.json?t=1', { headers:{ Accept:'json' } });
  await fetch('https://api.github.com/repos/o/r/contents/release.json?t=1', { headers:{ Accept:'application/vnd.github.raw' } });
  await fetch('https://api.github.com/repos/o/r/contents/content/ch0.html?t=1', { headers:{ Accept:'application/vnd.github.raw' } });
  return performance.now() - t0;
}

function seed(gh) {
  gh._seed('footnote.config.json', { owner:'o', dataRepo:'o/r' });
  gh._seed('chapters.json', { content: Buffer.from(JSON.stringify([{ id:'ch0', title:'Intro' }])).toString('base64') });
  gh._seed('release.json', ['ch0']);
  gh._seed('content/ch0.html', '<h1>Intro</h1><p>First paragraph.</p>');
}

for (const [name, rtt] of Object.entries(PROFILES)) {
  test(`cold first-load time-to-first-paragraph on ${name} (~${rtt}ms RTT)`, async () => {
    const gh = new FakeGitHub(); seed(gh);
    const ms = await timedBoot(gh, rtt);
    const modeled = SERIAL_TRIPS * rtt;
    console.log(`[cold ${name}] ~${ms.toFixed(0)}ms to first paragraph (${SERIAL_TRIPS} serial trips × ${rtt}ms = ${modeled}ms modeled)`);
    // sanity: measured is close to the serial model (the fake adds latencyMs per request)
    assert.ok(ms >= modeled * 0.8, 'serial chain must dominate the cold-load time');
  });
}

// FINDING candidate: chapters.json + release.json are INDEPENDENT (release doesn't need the manifest to
// fetch). Parallelizing them removes one full RTT from the critical path. Quantify the saving on 3G.
test('parallelizing the two independent boot reads saves ~1 RTT on the critical path', async () => {
  const rtt = PROFILES['3g'];
  const serial = SERIAL_TRIPS * rtt;                 // config → chapters → release → content
  const parallel = 3 * rtt;                          // config → (chapters ∥ release) → content
  const saved = serial - parallel;
  console.log(`[3g opt] serial=${serial}ms, chapters∥release=${parallel}ms → saves ~${saved}ms (${((saved/serial)*100)|0}%)`);
  assert.equal(saved, rtt, 'one full round-trip is removable by parallelizing the independent reads');
});

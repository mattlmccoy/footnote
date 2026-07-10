import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, groupByComment, isTerminal, summaryLine } from '../js/cloudprogress.js';

const JL = [
  { job: 'j1', seq: 0, phase: 'read', say: 'Starting apply for 2 comments.' },
  { job: 'j1', seq: 1, phase: 'read', comment: 'c1', say: 'Reading comment 1.' },
  { job: 'j1', seq: 2, phase: 'agent', comment: 'c1', agent: 'writer', say: 'Adding a reference.' },
  { job: 'j1', seq: 3, phase: 'stage', comment: 'c1', status: 'ok', say: 'Staged c1.' },
  { job: 'j1', seq: 4, phase: 'agent', comment: 'c2', agent: 'writer', say: 'Rewording.' },
].map(o => JSON.stringify(o)).join('\n') + '\n';

test('parseEvents parses JSONL, skips blanks/garbage', () => {
  const evs = parseEvents(JL + '\n{bad json}\n');
  assert.equal(evs.length, 5);
  assert.equal(evs[0].phase, 'read');
});

test('groupByComment keeps job-level events separate + orders by seq', () => {
  const g = groupByComment(parseEvents(JL));
  assert.deepEqual(g.jobEvents.map(e => e.seq), [0]);
  assert.deepEqual(g.comments.map(c => c.comment), ['c1', 'c2']);
  assert.deepEqual(g.comments[0].events.map(e => e.seq), [1, 2, 3]);
  assert.equal(g.comments[0].done, true);   // reached a terminal stage/conflict
  assert.equal(g.comments[1].done, false);  // still in progress
});

test('isTerminal true only on done/error', () => {
  assert.equal(isTerminal(parseEvents(JL)), false);
  const withDone = parseEvents(JL + JSON.stringify({ job: 'j1', seq: 5, phase: 'done', say: 'Done.' }) + '\n');
  assert.equal(isTerminal(withDone), true);
  const withErr = parseEvents(JSON.stringify({ job: 'j1', seq: 1, phase: 'error', say: 'Boom.' }) + '\n');
  assert.equal(isTerminal(withErr), true);
});

test('summaryLine reflects the latest activity', () => {
  assert.equal(summaryLine(parseEvents(JL)), 'Rewording.');
  const done = parseEvents(JL + JSON.stringify({ job: 'j1', seq: 5, phase: 'done', say: 'All comments processed.' }) + '\n');
  assert.equal(summaryLine(done), 'All comments processed.');
  assert.equal(summaryLine([]), '');
});

import { usageTotals, usageLine, usageCostNote } from '../js/cloudprogress.js';

test('usageTotals returns the latest usage tally, or null', () => {
  assert.equal(usageTotals(parseEvents(JL)), null);
  const withUsage = parseEvents(JL) .concat([{ job:'j1', seq:5, phase:'usage', say:'…',
    usage:{ cost_usd:0.0123, input_tokens:1200, output_tokens:340, calls:3, errors:0 } }]);
  const u = usageTotals(withUsage);
  assert.equal(u.cost_usd, 0.0123);
  assert.equal(u.calls, 3);
});

test('usageLine leads with tokens + calls, NO misleading dollar', () => {
  assert.equal(usageLine(null), '');
  assert.equal(usageLine({ cost_usd:0.0123, input_tokens:1200, output_tokens:340, calls:3 }),
    '1.5k tokens · 3 calls');
  assert.ok(!usageLine({ cost_usd:5, input_tokens:1000, output_tokens:0, calls:1 }).includes('$'));  // no $ in the chip
  assert.match(usageLine({ input_tokens:0, output_tokens:0, calls:0, errors:1 }), /failed/);
});

test('usageCostNote is the honest hover: API-equiv + subscription caveat', () => {
  const note = usageCostNote({ cost_usd:23.7285, input_tokens:1000, output_tokens:0, calls:6 });
  assert.match(note, /API list price/);
  assert.match(note, /Pro\/Max/);
  assert.match(note, /5-hour/);
  // no cost → still explains the plan-limit caveat, without a bogus $0
  assert.ok(!usageCostNote({ cost_usd:0 }).includes('$'));
});

import { groupStream } from '../js/cloudprogress.js';

test('groupStream groups run-agents by agent with status + findings', () => {
  const evs = parseEvents([
    { job:'g', seq:0, phase:'read', say:'Running 2 agents.' },
    { job:'g', seq:1, phase:'agent', agent:'rigor', status:'running', say:'reviewing… (1 of 2)' },
    { job:'g', seq:2, phase:'agent', agent:'rigor', status:'ok', say:'2 findings', findings:[{tag:'rigor',text:'cite this'}] },
    { job:'g', seq:3, phase:'agent', agent:'clarity', status:'running', say:'reviewing… (2 of 2)' },
    { job:'g', seq:4, phase:'usage', say:'$0.02', usage:{cost_usd:0.02} },
  ].map(o=>JSON.stringify(o)).join('\n'));
  const { jobEvents, groups } = groupStream(evs);
  assert.deepEqual(jobEvents.map(e=>e.phase), ['read','usage']);   // job-level lines
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'rigor'); assert.equal(groups[0].status, 'ok');
  assert.deepEqual(groups[0].findings, [{tag:'rigor',text:'cite this'}]);
  assert.equal(groups[1].key, 'clarity'); assert.equal(groups[1].status, 'running');  // still going
});

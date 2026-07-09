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

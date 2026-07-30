import { test } from 'node:test'; import assert from 'node:assert/strict';
import { resilientRenderDispatch } from '../js/renderdispatch.js';

// Regression: rebuilding a project whose deployed render.yml predates the workflow_dispatch trigger 422s
// ("Workflow does not have 'workflow_dispatch' trigger") because ensureRenderPipeline just refreshed the
// workflow and GitHub has not registered the new trigger yet. The dispatch must wait for a freshly seeded
// render.yml and retry the transient failure, exactly as cloudBuildReadingView already does.

const RENDER = '.github/workflows/render.yml';
function harness({ ensureResult, dispatchOutcomes }){
  const calls = { ensure: 0, dispatch: 0, sleeps: [], lastPid: undefined };
  let di = 0;
  return {
    calls,
    ensure: async () => { calls.ensure++; return ensureResult; },
    dispatch: async (pid) => { calls.dispatch++; calls.lastPid = pid; const o = dispatchOutcomes[di++]; if (o instanceof Error) throw o; },
    sleep: async (ms) => { calls.sleeps.push(ms); },
  };
}

test('waits for GitHub to register a freshly (re)seeded render.yml before dispatching', async () => {
  const h = harness({ ensureResult: { seeded: [RENDER], already: [] }, dispatchOutcomes: [undefined] });
  await resilientRenderDispatch({ dataRepo: 'me/d', projectId: 'p1', ensure: h.ensure, dispatch: h.dispatch, sleep: h.sleep, waitMs: 4000 });
  assert.equal(h.calls.dispatch, 1);
  assert.equal(h.calls.lastPid, 'p1');
  assert.deepEqual(h.calls.sleeps, [4000]);   // waited once, before dispatching
});

test('no wait when render.yml was already current (no trigger just added)', async () => {
  const h = harness({ ensureResult: { seeded: [], already: [RENDER] }, dispatchOutcomes: [undefined] });
  await resilientRenderDispatch({ dataRepo: 'me/d', projectId: '', ensure: h.ensure, dispatch: h.dispatch, sleep: h.sleep, waitMs: 4000 });
  assert.deepEqual(h.calls.sleeps, []);
  assert.equal(h.calls.dispatch, 1);
});

test('retries the transient 422 while the trigger registers, then succeeds', async () => {
  const err = new Error("render dispatch 422 Workflow does not have 'workflow_dispatch' trigger");
  const h = harness({ ensureResult: { seeded: [], already: [RENDER] }, dispatchOutcomes: [err, err, undefined] });
  await resilientRenderDispatch({ dataRepo: 'me/d', projectId: 'p1', ensure: h.ensure, dispatch: h.dispatch, sleep: h.sleep, retries: 3, retryMs: 3000 });
  assert.equal(h.calls.dispatch, 3);
  assert.deepEqual(h.calls.sleeps, [3000, 3000]);   // slept between attempts, not after the success
});

test('rethrows after exhausting retries so the owner still sees the failure', async () => {
  const err = new Error('render dispatch 422 ...');
  const h = harness({ ensureResult: { seeded: [], already: [RENDER] }, dispatchOutcomes: [err, err, err] });
  await assert.rejects(
    () => resilientRenderDispatch({ dataRepo: 'me/d', projectId: 'p1', ensure: h.ensure, dispatch: h.dispatch, sleep: h.sleep, retries: 3, retryMs: 3000 }),
    /422/);
  assert.equal(h.calls.dispatch, 3);
});

test('a workflow-scope failure from ensure propagates (never silently dispatches)', async () => {
  const h = harness({ ensureResult: { seeded: [], already: [] }, dispatchOutcomes: [undefined] });
  h.ensure = async () => { throw new Error('workflow-scope'); };
  await assert.rejects(
    () => resilientRenderDispatch({ dataRepo: 'me/d', projectId: 'p1', ensure: h.ensure, dispatch: h.dispatch, sleep: h.sleep }),
    /workflow-scope/);
  assert.equal(h.calls.dispatch, 0);
});

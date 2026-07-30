// renderdispatch.js: resilient render-workflow dispatch. Ensures the render pipeline exists, then
// dispatches render.yml, tolerating the window in which GitHub has not yet registered a freshly
// (re)seeded workflow's workflow_dispatch trigger (a bare dispatch then 422s with "Workflow does not
// have 'workflow_dispatch' trigger"). All side effects are injected, so the wait/retry policy is
// unit-tested; app.js passes the real ensureRenderPipeline / dispatchRender / setTimeout.
const RENDER_YML = '.github/workflows/render.yml';

export async function resilientRenderDispatch({ dataRepo, projectId, ensure, dispatch, sleep,
  waitMs = 4000, retries = 3, retryMs = 3000 } = {}) {
  const res = await ensure(dataRepo);   // a workflow-scope failure propagates: never dispatch silently
  // A just-written workflow_dispatch trigger is not immediately dispatchable, so wait once for GitHub to
  // register it when this call actually (re)wrote render.yml.
  if (res && Array.isArray(res.seeded) && res.seeded.includes(RENDER_YML)) await sleep(waitMs);
  for (let attempt = 0; attempt < retries; attempt++) {
    try { await dispatch(projectId); return; }
    catch (err) { if (attempt === retries - 1) throw err; await sleep(retryMs); }
  }
}

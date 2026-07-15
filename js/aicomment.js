// js/aicomment.js — is a comment Claude/AI-authored? Pure predicate shared by the owner portal so the
// reviewer-vs-Claude action split is single-sourced. AI review-agent findings are routed by the engine
// (ci_apply/ci_local) into the synthetic "AI Review Agents" reviewer's advisor file, so a comment is
// AI-authored exactly when its advisor id is AI_REVIEWER_ID. Must equal the engine's AI_REVIEWER_ID.
export const AI_REVIEWER_ID = 'ai-review-agents';

export function isAiComment(c) {
  return !!c && c._advisor === AI_REVIEWER_ID;
}

// Build the apply-edits job that sends one advisor comment (a human reviewer comment, or an AI finding via
// "Act on it" / "Request further work") to Claude. A GUIDANCE NOTE ("Request further work") sets
// revision:true so the engine RE-RUNS the writer with the steer: without it, `needs_writer =
// job.revision or not staged_edit_spec(comment)` takes the reuse path once a staged edit already exists and
// the note is silently ignored (mirrors requestChanges, which also sets revision:true). Pure — the caller
// does the getJson/putJson. `note` blank/whitespace ⇒ a plain send (no revision).
export function buildAdvisorClaudeJob({ id, chapter, commentId, advisorId, cid, note, ts }) {
  const job = {
    id, type: 'apply-edits', chapter, comment_ids: [commentId],
    from_advisor: { id: advisorId, cid }, status: 'queued', requested_ts: ts,
  };
  const n = (note || '').trim();
  if (n) { job.revision = true; job.revise_note = n; }
  return job;
}

// Split an advisor-comment list into Claude findings (isAiComment) vs human reviewer comments.
// Pure — used by the owner portal so findings render inline while reviewers stay in the reviewers list.
export function partitionAdvisorComments(list) {
  const findings = [], reviewers = [];
  for (const c of (list || [])) (isAiComment(c) ? findings : reviewers).push(c);
  return { findings, reviewers };
}

// Per-comment display state for a finding card — never a chapter/shared flag (fixes findings all
// showing as "submitted"). Pure.
export function findingCardState(c) {
  const cl = (c && c.claude) || {};
  return {
    acted: !!(c && c.sent),
    staged: !!(c && c.staged_edit) || (c && c.status === 'staged'),
    conflict: !!cl.conflict || (c && c.status === 'conflict'),
    dismissed: !!(c && c.resolution && c.resolution.state === 'declined'),
    status: (c && c.status) || 'open',
  };
}

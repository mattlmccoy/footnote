// js/aicomment.js — is a comment Claude/AI-authored? Pure predicate shared by the owner portal so the
// reviewer-vs-Claude action split is single-sourced. AI review-agent findings are routed by the engine
// (ci_apply/ci_local) into the synthetic "AI Review Agents" reviewer's advisor file, so a comment is
// AI-authored exactly when its advisor id is AI_REVIEWER_ID. Must equal the engine's AI_REVIEWER_ID.
export const AI_REVIEWER_ID = 'ai-review-agents';

export function isAiComment(c) {
  return !!c && c._advisor === AI_REVIEWER_ID;
}

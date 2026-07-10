// js/repoexplainer.js — the "How Footnote uses your repos" explainer, shared by the owner Settings page
// (Access & tokens) and the setup guide. Pure: exports the three repo-role descriptors + an HTML builder.
// Standardized vocabulary; no DOM, no state. Unit-tested in tests/repoexplainer.test.mjs.

export const REPO_ROLES = [
  {
    key: 'source', label: 'Source repo',
    desc: 'Your source of truth — the real LaTeX (often Overleaf-linked). Footnote reads it, and only ever writes a review-edits/<unit> branch here when you approve an edit; your main branch is never touched by the tool.',
  },
  {
    key: 'review', label: 'Review repo',
    desc: 'The working copy Footnote drives: comments, staged edits, the rendered reading view, and the job queue. An effective mirror of the source that your reviewers read against. (Older docs called this the “data repo”.)',
  },
  {
    key: 'workspace', label: 'Workspace repo',
    desc: 'Optional — one private repo that houses several projects’ Review repos together. For a single paper, your Review repo is the workspace.',
  },
];

// Render the explainer as one self-contained element (static copy). `opts.compact` tightens spacing for
// the Settings card; default is the fuller layout used at the top of a page.
export function repoExplainerHtml(opts = {}) {
  const compact = !!opts.compact;
  const items = REPO_ROLES.map(r =>
    `<div style="margin:${compact ? '6px' : '9px'} 0"><b>${r.label}</b> — <span style="color:var(--text-3,#667)">${r.desc}</span></div>`
  ).join('');
  return `<div class="fn-repo-explainer" style="font-size:12.5px;line-height:1.55">
    <div style="margin-bottom:6px;color:var(--text-3,#667)">Footnote uses your GitHub repos in three roles. In the simple case — you upload a <code>.tex</code>, or keep one workspace — they can be <b>one physical repo</b>: the Review repo is also the workspace, and your source lives inside it.</div>
    ${items}
  </div>`;
}

let _seq = 0;
const nid = () => `c_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
export const newReview = (chapter, builtFrom) =>
  ({ chapter, built_from_commit: builtFrom, synctex_present:false, cursor:null, comments:[] });
export const addComment = (r, c) => ({ ...r, comments:[...r.comments, {
  id: nid(), page:c.page, kind:c.kind||'text',
  anchor:{ quote:c.anchor?.quote||'', synctex:c.anchor?.synctex||null, rects:c.anchor?.rects||[], section:c.anchor?.section||'', figure:c.anchor?.figure||null, confirmed:!!c.anchor?.confirmed },
  tag:c.tag||'other', body:c.body||'', status:c.status||'open',
  author:c.author||null,   // who left it: null/'matt' (owner) or an advisor id (e.g. 'CJS')
  edit:c.edit||null,   // verbatim suggestion: { op:'replace'|'insert'|'delete', find, replacement, position? }
  claude:{ branch:null, commit:null, response:null, resolved_line:null, ts:null },
  created_ts:new Date().toISOString() }] });
export const updateComment = (r, id, patch) =>
  ({ ...r, comments:r.comments.map(c => c.id===id ? { ...c, ...patch } : c) });
export const deleteComment = (r, id) =>
  ({ ...r, comments:r.comments.filter(c => c.id!==id), deleted:[...new Set([...(r.deleted||[]), id])] });
export const setCursor = (r, cursor) => ({ ...r, cursor });

// owner decision on a staged edit: 'approve' | 'reject' | 'revise' | null (clear)
export const setDecision = (r, id, decision, note) => ({ ...r, comments: r.comments.map(c => {
  if (c.id !== id) return c;
  const { decision: _d, decision_note: _n, decision_ts: _t, ...rest } = c;
  return decision ? { ...rest, decision, ...(note ? { decision_note: note } : {}), decision_ts: new Date().toISOString() } : rest;
}) });

// split STAGED comments by owner decision; report already-queued (status 'approved') separately
export const partitionByDecision = (comments) => {
  const list = comments || [];
  const staged = list.filter(c => c.status === 'staged');
  return {
    approved:  staged.filter(c => c.decision === 'approve').map(c => c.id),
    rejected:  staged.filter(c => c.decision === 'reject').map(c => c.id),
    revise:    staged.filter(c => c.decision === 'revise').map(c => ({ cid: c.id, note: c.decision_note || '' })),
    undecided: staged.filter(c => !c.decision).map(c => c.id),
    queued:    list.filter(c => c.status === 'approved').map(c => c.id),
  };
};

// promote staged comments by their decision: approve->'approved' (queued for merge, edit kept),
// reject->'declined' (edit dropped), revise->'queued' (edit dropped). Returns the new review + the
// list of comments to re-queue for a Claude redo. The decision flag is consumed (status is now truth).
export const queueApproved = (review) => {
  const revise = [];
  const comments = review.comments.map(c => {
    if (c.status !== 'staged' || !c.decision) return c;
    const { decision, decision_note, decision_ts, staged_edit, ...rest } = c;
    if (decision === 'approve') return { ...rest, staged_edit, status: 'approved' };
    if (decision === 'reject')  return { ...rest, status: 'declined' };
    revise.push({ cid: c.id, note: decision_note || '' });
    return { ...rest, status: 'queued' };
  });
  return { review: { ...review, comments }, revise };
};

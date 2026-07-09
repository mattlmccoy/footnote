// Live "watch it work" model for the cloud review job. Pure — the DOM panel polls
// <prefix>progress/<job>.jsonl and feeds the raw text through here to render a narrated, per-comment
// activity feed (not a debug log). Unit-tested in tests/cloudprogress.test.mjs.

const TERMINAL = new Set(['done', 'error']);
const STEP_DONE = new Set(['stage', 'conflict', 'merge', 'done', 'error']);

// Parse the JSONL progress file into an ordered event list, skipping blank/garbage lines (a partially
// written last line while the Action is mid-append must never break the view).
export function parseEvents(jsonlText) {
  const out = [];
  for (const line of String(jsonlText || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip incomplete/garbled line */ }
  }
  return out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

// Split events into job-level (no comment) + per-comment groups (each a little story). A comment is
// "done" once it hits a terminal step (stage/conflict/merge). Preserves first-seen comment order.
export function groupByComment(events) {
  const jobEvents = [];
  const byId = new Map();
  const order = [];
  for (const e of events || []) {
    if (!e.comment) { jobEvents.push(e); continue; }
    if (!byId.has(e.comment)) { byId.set(e.comment, []); order.push(e.comment); }
    byId.get(e.comment).push(e);
  }
  const comments = order.map(id => {
    const evs = byId.get(id);
    return { comment: id, events: evs, done: evs.some(e => STEP_DONE.has(e.phase)) };
  });
  return { jobEvents, comments };
}

// The job is finished (stop polling) once any terminal event appears.
export function isTerminal(events) {
  return (events || []).some(e => TERMINAL.has(e.phase));
}

// The running headline shown at the top of the live view — the most recent event's narration.
export function summaryLine(events) {
  if (!events || !events.length) return '';
  return events[events.length - 1].say || '';
}

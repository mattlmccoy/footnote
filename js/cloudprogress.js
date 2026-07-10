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

// The Claude spend tally for this run — the latest event carrying a `usage` object, or null. The engine
// emits it near the end (phase 'usage'); the header renders it so a reviewer isn't burning credits blind.
export function usageTotals(events) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    if (events[i] && events[i].usage) return events[i].usage;
  }
  return null;
}

// Compact header string for a usage tally ('' when none): "$0.0123 · 2.3k tokens · 3 calls".
export function usageLine(u) {
  if (!u) return '';
  const cost = Number(u.cost_usd || 0);
  const tok = Number(u.input_tokens || 0) + Number(u.output_tokens || 0);
  const tks = tok >= 1000 ? (tok / 1000).toFixed(1) + 'k' : String(tok);
  let s = `$${cost.toFixed(4)} · ${tks} tokens`;
  if (u.calls) s += ` · ${u.calls} call${u.calls === 1 ? '' : 's'}`;
  if (u.errors) s += ` · ${u.errors} failed`;
  return s;
}

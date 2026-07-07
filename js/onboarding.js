// onboarding.js — pure helpers for the reviewer's first five minutes (Lane A).
// No DOM, no network: header data, honest-state routing, paste-friendly key validation, and the
// first-run guide as data. The DOM wiring lives in advisor.js; this keeps the logic unit-testable.
// Assistant-free by construction — the reviewer bundle stays grep-clean.

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Whole days until the deadline, clamped ≥0 (mirrors config.daysToDeadline without importing it, so
// this module stays dependency-free and testable with an injected `now`).
function daysUntil(dateStr, now){
  const ms = new Date(dateStr) - now;
  return Math.max(0, Math.ceil(ms / 86400000));
}

// "What am I reviewing?" — the fields for the reviewer-home header. Falls back gracefully when the
// instance sets no title/author. `now` is injectable for deterministic deadline tests.
export function reviewingHeader(cfg, reviewerName, sharedCount, now = new Date()){
  const doc = (cfg && cfg.doc) || {};
  const noun = doc.noun || 'document';
  const title = (doc.title && doc.title.trim()) || `Untitled ${noun}`;
  const dl = cfg && cfg.deadline && cfg.deadline.date
    ? { label: cfg.deadline.label || 'deadline', days: daysUntil(cfg.deadline.date, now), date: cfg.deadline.date }
    : null;
  return {
    title,
    docNoun: noun,
    unitNoun: doc.unitNoun || 'chapter',
    author: (doc.authorName || '').trim(),
    reviewingAs: (reviewerName || '').trim(),
    sharedCount: sharedCount || 0,
    deadline: dl,
  };
}

// Which top-level state to render, in priority order. Every dead-end has its own honest screen:
//   revoked  → access removed by the author
//   expired  → a key is present but GitHub rejected it (401)
//   connect  → no key stored yet (magic-link normally skips this)
//   waiting  → key works but nothing has been released to this reviewer yet
//   ready    → chapters are released → show the home
export function releaseView({ revoked, keyBad, hasKey, releasedCount } = {}){
  if (revoked) return 'revoked';
  if (keyBad && hasKey) return 'expired';
  if (!hasKey) return 'connect';
  if (!releasedCount) return 'waiting';
  return 'ready';
}

// Paste-friendly access-key validation (replaces native prompt()). Trims, pulls the key out of a
// whole invite URL if the reviewer pasted that by mistake, and rejects empty/too-short values with a
// human message. A GitHub PAT is long; anything under ~8 chars is not a real key.
export function validateKey(raw){
  let v = (raw == null ? '' : String(raw)).trim();
  if (!v) return { ok: false, value: '', error: 'Paste the access key from your invitation email.' };
  // Reviewer pasted the whole link (…?…&k=<key>…) — extract just the key.
  const m = v.match(/[?&]k=([^&#\s]+)/);
  if (m) { try { v = decodeURIComponent(m[1]); } catch { v = m[1]; } }
  v = v.trim();
  if (v.length < 8) return { ok: false, value: '', error: "That doesn't look like a full access key — paste the whole thing." };
  return { ok: true, value: v, error: null };
}

// The one-time first-run guide (reused through the existing tour engine). Steps are selector-targeted
// in advisor.js; kept here as data so the copy is testable and the count is guaranteed.
export const FIRST_RUN_TOUR = [
  { step: 1, title: 'Pick a passage', body: 'Select any words in the reading view — a box pops up to attach your note or a suggested edit.' },
  { step: 2, title: 'Leave a comment or suggested edit', body: 'Type a note and tag it, or propose exact replacement wording the author can accept in one click.' },
  { step: 3, title: 'The author sees it instantly', body: 'Every comment is shared the moment you add it — no submit step. Their replies appear right here.' },
];

// Stable localStorage key for an in-progress comment draft, so a half-written comment survives an accidental
// refresh/navigate. Keyed by chapter + the anchored passage (quote+section, whitespace-normalized): the same
// passage yields the same key, so the draft comes back when the reviewer reopens the composer on it.
export function commentDraftKey(chapterId, anchor) {
  const q = ((anchor && anchor.quote) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const s = ((anchor && anchor.section) || '').trim();
  return `footnote:draft:${chapterId || '_'}:${s}::${q}`;
}

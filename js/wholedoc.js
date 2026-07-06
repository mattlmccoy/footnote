// wholedoc.js — PURE helpers for the whole-document ("read the whole paper") view.
// No DOM, no network. Everything DOM/IO-touching lives in app.js / advisor.js and calls these.
//
// Core correctness rule: every comment resolves INSIDE its own chapter's segment (#wd-<id>), so an
// identical phrase in two chapters can never cross-anchor. These helpers own the id math + routing;
// the reader wiring just applies them against the assembled #doc.

// The wrapper element id for a chapter's segment in the concatenated document.
export const segmentId = (chapterId) => `wd-${chapterId}`;
export const segmentSelector = (chapterId) => `#wd-${chapterId}`;

// Reverse of segmentId: 'wd-<id>' -> '<id>'. Anything that is not a segment id -> null. Robust to
// hyphens inside the chapter id (only the single leading 'wd-' is stripped).
export function stripSegmentId(id) {
  if (typeof id !== 'string' || !id.startsWith('wd-')) return null;
  return id.slice(3);
}

// The ordered unit list for assembly, in chapters.json order. `allow` (optional) restricts to a set of
// ids (reviewer: released ids) WITHOUT reordering — order always comes from CHAPTERS, not the allow-list.
export function orderedUnits(chapters, allow) {
  const list = Array.isArray(chapters) ? chapters : [];
  if (allow == null) return list.slice();
  const ok = new Set(allow);
  return list.filter((c) => ok.has(c.id));
}

// Flatten a { <id>: reviewObj } map into one chapter-tagged, doc-ordered list of
// { chapterId, comment }. Chapters follow `order` (from orderedUnits); comments keep each review's own
// array order. Missing/empty reviews contribute nothing. Never merges comments into a single blob.
export function mergeReviews(reviewMap, order) {
  const out = [];
  for (const unit of order || []) {
    const rev = reviewMap && reviewMap[unit.id];
    for (const comment of (rev && rev.comments) || []) out.push({ chapterId: unit.id, comment });
  }
  return out;
}

// The review object to mutate when a NEW comment is created on `chapterId` in the whole-doc view. Returns
// the existing per-chapter review (identity — so save()/syncUp() persist to reviews/<id>.json), creating a
// fresh empty shell in the map if that chapter has no review yet. Writes stay fanned out per chapter.
export function routeWrite(reviewMap, chapterId, makeReview = defaultReview) {
  if (!reviewMap[chapterId]) reviewMap[chapterId] = makeReview(chapterId);
  return reviewMap[chapterId];
}
const defaultReview = (chapter) => ({ chapter, built_from_commit: '', comments: [] });

// Minimal HTML escaping for the head label (the fragment is trusted rendered HTML and passes through).
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// The chapter-scoped section wrapper for one unit in the concatenated document. Keeps the existing #doc
// CSS + post-render pipeline (KaTeX/figures/citations/cross-refs) working per segment.
export function wrapUnit(chapterId, headLabel, fragment) {
  return `<section class="wd-chapter" id="${segmentId(chapterId)}">` +
    `<h1 class="wd-head">${esc(headLabel)}</h1>${fragment || ''}</section>`;
}

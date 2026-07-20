// Shared read-progress derivation for author and reviewer chapter cards (parity, one source of
// truth). A review object carries { read: {sectionId: true}, secCount: number }. AI-term-free so
// advisor.js can import it and stay grep-clean.

export function readProgress(review) {
  const doneN = review && review.read ? Object.keys(review.read).length : 0;
  const secN = (review && review.secCount) || 0;
  const frac = secN ? doneN / secN : 0;
  const done = secN > 0 && doneN >= secN;
  return { doneN, secN, frac, done };
}

// What counts as "finishing" a chapter, for the completion celebration. Two independent milestones:
// the reader has checked off every section, and every comment has reached a terminal state. Pure —
// `isResolved` is injected so each portal can pass its own terminal-state rule. Term-neutral so
// advisor.js can import it and stay grep-clean.
export function chapterMilestones(review, isResolved) {
  const comments = (review && review.comments) || [];
  return {
    readDone: readProgress(review).done,
    // a chapter with no comments never counts: nothing was actually worked through
    commentsDone: comments.length > 0 && comments.every(c => isResolved(c)),
  };
}

// Which milestones just flipped false → true. Comparing against a snapshot means a celebration fires
// once, at the moment of completion, and never when merely opening an already-finished chapter.
export function newMilestones(prev, next) {
  const p = prev || {}, n = next || {};
  return {
    read: !!n.readDone && !p.readDone,
    comments: !!n.commentsDone && !p.commentsDone,
  };
}

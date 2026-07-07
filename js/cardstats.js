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

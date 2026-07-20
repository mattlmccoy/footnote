// Layout of the floating corner tools. The word-count pill is anchored bottom-right; the help button sits
// to its LEFT, so both stay reachable and the corner reads as one row of tools. Pure so the arithmetic is
// testable — the pill's width changes with its label ("2,244 words" vs "12,480 words"), so the help
// button's offset has to be recomputed rather than hard-coded.
export const FAB_EDGE = 22;      // matches #wc-fab's right offset
export const FAB_GAP = 10;

export function helpFabRight(pillWidth, { edge = FAB_EDGE, gap = FAB_GAP } = {}) {
  const w = Number(pillWidth);
  if (!Number.isFinite(w) || w <= 0) return edge;    // no pill (or a bad measurement): sit at the edge
  return edge + w + gap;
}

// Apply the offset to a help button, given the pill element (or null when there isn't one).
export function positionFab(helpEl, pillEl) {
  if (!helpEl) return;
  helpEl.style.right = helpFabRight(pillEl ? pillEl.offsetWidth : 0) + 'px';
}

// The pill is created and destroyed by view swaps, so anything that positions the help button from the
// pill's render alone goes stale the moment you leave a chapter — the button keeps the offset that cleared
// a pill which no longer exists. Watch the DOM instead of trusting call sites to remember. Coalesced to one
// measurement per frame so a busy render can't thrash layout.
export function watchFabLayout(root, reposition) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  // Coalesced with a timer, deliberately NOT requestAnimationFrame: rAF is throttled in a background tab,
  // so a view swap that happened while the tab was hidden would leave the button at the old offset until
  // something else nudged it. Reading offsetWidth doesn't need frame alignment anyway.
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; reposition(); }, 0);
  });
  mo.observe(root, { childList: true });
  return () => mo.disconnect();
}

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

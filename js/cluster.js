// Cluster reviewer comments that fall on the same passage, so the author sees "N reviewers on this
// passage" instead of unrelated cards. Owner-side (only the author sees multiple reviewers' comments).
// Pure — the reading view supplies the merged comment list and renders the returned groups.
//
// v1 overlap signal: same section + the anchored quotes overlap by containment/equality (normalized for
// whitespace/case). This catches the common case (two reviewers highlighting the same or a nested span).
// Partial edge-overlaps (sharing only a middle run) need character offsets and are out of scope for v1.

function norm(q) { return String(q || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function overlaps(a, b) {
  const sa = (a.anchor && a.anchor.section) || '';
  const sb = (b.anchor && b.anchor.section) || '';
  if (sa !== sb) return false;
  const qa = norm(a.anchor && a.anchor.quote);
  const qb = norm(b.anchor && b.anchor.quote);
  if (!qa || !qb) return false;
  if (qa === qb) return true;
  // Containment at WORD boundaries (space-padded), so a short quote isn't matched mid-word
  // (e.g. "x" must not "overlap" "text"). Real anchors are phrases; this nests them correctly.
  const pa = ` ${qa} `, pb = ` ${qb} `;
  return pa.includes(pb) || pb.includes(pa);
}

// Group overlapping comments (transitively), preserving input order. Returns an array of groups
// (each a non-empty array of comments); non-overlapping comments are singleton groups.
export function clusterComments(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const groupOf = new Array(list.length).fill(-1);
  const groups = [];
  for (let i = 0; i < list.length; i++) {
    if (groupOf[i] !== -1) continue;
    const g = [list[i]];
    groupOf[i] = groups.length;
    // transitive closure: pull in anything overlapping any member already in g
    for (let scan = 0; scan < g.length; scan++) {
      for (let j = i + 1; j < list.length; j++) {
        if (groupOf[j] === -1 && overlaps(g[scan], list[j])) { groupOf[j] = groups.length; g.push(list[j]); }
      }
    }
    groups.push(g);
  }
  return groups;
}

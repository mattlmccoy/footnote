// Which unit ids a reviewer may see, given the owner's release choices. One rule for both portals.
// Chapters: visible iff explicitly released. Appendices: follow their HOME chapter's release by default,
// unless a per-appendix override pins them ('show' = always visible, 'hide' = always hidden). Kept free of
// any reviewer-tool vocabulary so the reviewer portal (advisor.js) can import it safely.
//
//   units:            the chapters.json manifest [{id, kind?, home?}, …]
//   released:         array of chapter ids the owner released to this reviewer
//   appendixOverride: { [appendixId]: 'show' | 'hide' }  (absent id = follow home chapter)
export function visibleUnitIds(units = [], released = [], appendixOverride = {}) {
  const rel = new Set(released || []);
  const ov = appendixOverride || {};
  const out = [];
  for (const u of units || []) {
    if (!u || !u.id) continue;
    if (u.kind === 'appendix') {
      const pin = ov[u.id];
      // visible when pinned 'show', or (not pinned 'hide' and) either explicitly released (legacy /
      // force-release) or its home chapter is released.
      const visible = pin === 'show' || (pin !== 'hide' && (rel.has(u.id) || (!!u.home && rel.has(u.home))));
      if (visible) out.push(u.id);
    } else if (rel.has(u.id)) {
      out.push(u.id);
    }
  }
  return out;
}

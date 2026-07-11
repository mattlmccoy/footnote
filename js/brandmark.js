// The Footnote brand mark (margin-note glyph) as an inline SVG, tinted with the adopter's accent.
// Single source of truth shared by the author launcher (hub.js) and the reviewer portal (advisor.js),
// so both render the real logo, not an ad-hoc letter. Asset mirror: brand/footnote-mark.svg.
// AI-term-free (advisor.js imports it and must stay grep-clean).
export function brandMark(accent) {
  return `<svg class="fn-mark" viewBox="0 0 52 52" aria-hidden="true"><rect x="3" y="3" width="46" height="46" rx="13" fill="${accent}"/><line x1="19" y1="13" x2="19" y2="39" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="39" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="39" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.7" fill="#fff"/></svg>`;
}

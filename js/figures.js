// js/figures.js — Figure Review, Slice 1: the pure, cross-chapter figure INDEX (docs/figure-review.md).
//
// Owner-only feature substrate; import ONLY into app.js, never advisor.js, so the reviewer fork stays
// AI-free (see js/agentcatalog.js:1-4). DOM-free by design so it runs under `node --test`: the browser
// side hands us chapter HTML fragment strings (the same content/<id>.html the reader fetches).
//
// The number/label regexes below MIRROR the live reader — figTableMaps (js/app.js:811) and figureLabel
// (js/app.js:860) — so a figure comment authored from the gallery anchors IDENTICALLY to one authored by
// clicking the figure in the reader (paint parity via markFigure, js/app.js:2008).
//
// Constraint honored (data-contract): figures carry NO stable machine id; the number lives only as caption
// text ("Figure 3.1. ") and anchor.figure is the last 40 chars of the img src. We key on the parsed caption
// NUMBER and keep the img-src tail for back-compat with the existing painter.

import { isActiveComment } from './model.js?v=fig1';

const FIG_NUM_RE   = /^\s*Figure\s+(\d+(?:\.\d+)*)\./;              // figTableMaps: trailing period REQUIRED
const FIG_LABEL_RE = /^(Figure|Fig\.?|Table)\s*[\d.]+/i;           // figureLabel: leading label token
const REF_RE       = /\bFigure\s+(\d+(?:\.\d+)*)/g;                // an in-prose reference "Figure 3.1" (no period needed)

// HTML comments are not content — strip them before parsing so a comment that happens to contain
// figure/heading-like markup (provenance notes, pandoc's own comments) never leaks into the index.
const _stripComments = (s) => String(s == null ? '' : s).replace(/<!--[\s\S]*?-->/g, '');
const _decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const _stripTags = (s) => _decode(String(s == null ? '' : s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

// Pull the dotted figure number from a numbered caption; null if the caption isn't a numbered figure.
export function figNumFromCaption(caption) {
  const m = (caption == null ? '' : String(caption)).match(FIG_NUM_RE);
  return m ? m[1] : null;
}

// The leading label token exactly as the live figureLabel extracts it (may include a trailing dot).
export function figLabelFromCaption(caption) {
  const m = (caption == null ? '' : String(caption)).match(FIG_LABEL_RE);
  return m ? m[0] : '';
}

// Raw <figure> blocks in a fragment → { caption, imgSrc }. Order preserved; blocks without a figcaption
// still return (caption ''). Not a full HTML parser — pandoc figure output is regular; nested subfigures
// use the FIRST figcaption (a known limitation, mirroring figTableMaps' :scope > figcaption intent).
export function extractFigures(fragmentHtml) {
  if (!fragmentHtml || typeof fragmentHtml !== 'string') return [];
  const out = [];
  for (const block of _stripComments(fragmentHtml).matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const inner = block[1] || '';
    const cap = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const img = inner.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/i);
    out.push({ caption: _stripTags(cap ? cap[1] : ''), imgSrc: img ? img[1] : '' });
  }
  return out;
}

// Per-chapter figure rows for the gallery. Only NUMBERED figures are indexable (an unnumbered/decorative
// figure has no stable key). imgSrcTail is the anchor.figure back-compat key (last 40 of the src).
export function parseFiguresFromFragment(html, chapterId) {
  return extractFigures(html).map((f) => {
    const fignum = figNumFromCaption(f.caption);
    if (!fignum) return null;
    return {
      chapterId, fignum, caption: f.caption, imgSrc: f.imgSrc,
      imgSrcTail: (f.imgSrc || '').slice(-40), label: figLabelFromCaption(f.caption),
    };
  }).filter(Boolean);
}

// "Where is Figure N referenced" — maps each figure number to the section headings whose PROSE cites it.
// The defining <figure> blocks are removed first so a caption never counts as a reference to itself.
export function figureRefsInFragment(html) {
  const refs = {};
  if (!html || typeof html !== 'string') return refs;
  const noFigs = _stripComments(html).replace(/<figure\b[\s\S]*?<\/figure>/gi, '');
  const heads = [...noFigs.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  for (let i = 0; i < heads.length; i++) {
    const heading = _stripTags(heads[i][2]);
    if (!heading) continue;
    const from = heads[i].index + heads[i][0].length;
    const to = i + 1 < heads.length ? heads[i + 1].index : noFigs.length;
    const prose = _stripTags(noFigs.slice(from, to));
    for (const m of prose.matchAll(REF_RE)) {
      const num = m[1];
      (refs[num] || (refs[num] = [])).includes(heading) || refs[num].push(heading);
    }
  }
  return refs;
}

// Cross-chapter grouping in reading order. Every unit yields a group (empty figures[] when it has none or
// its fragment is missing) so the gallery can show every chapter.
export function groupFiguresByChapter(orderedUnits, fragmentsById) {
  const frags = fragmentsById || {};
  return (orderedUnits || []).map((chapter) => ({
    chapter, figures: parseFiguresFromFragment(frags[chapter.id] || '', chapter.id),
  }));
}

// Build the comment anchor for a gallery-authored figure comment. MUST match wireFigures (js/app.js:875)
// so paint/worklist treat it identically to a reader-authored figure comment. `fignum` is additive.
export function figureAnchor(fig, section) {
  const label = figLabelFromCaption(fig && fig.caption);
  const qt = (fig && fig.caption ? String(fig.caption) : '').slice(0, 150);
  const quote = label ? `${label}${qt ? ': ' + qt : ''}` : (qt || 'Figure');
  return {
    quote, kind: 'figure', figure: (fig && fig.imgSrcTail) || null,
    fignum: (fig && fig.fignum) || null, section: section || '', confirmed: true, rects: [],
  };
}

// Attach an ACTIVE figure-comment count to each figure (badge source). A comment matches a figure by its
// parsed number (anchor.fignum) or the img-src tail (anchor.figure). Only kind:'figure', still-active
// comments count. Pure — returns a new array.
export function attachCommentCounts(figures, comments) {
  const list = comments || [];
  return (figures || []).map((fig) => ({
    ...fig,
    activeComments: list.filter((c) =>
      c && c.kind === 'figure' && isActiveComment(c) &&
      ((c.anchor && c.anchor.fignum && c.anchor.fignum === fig.fignum) ||
       (c.anchor && c.anchor.figure && c.anchor.figure === fig.imgSrcTail))
    ).length,
  }));
}

// Turn normalized drawn rects (0..1 of the figure box) into a short text the comment body can carry to
// Claude — since the round-trip is text-only (no pixels), this is HOW the drawn region reaches the writer.
// Uses the first region's center to name a 3×3 grid zone plus its extent. '' when there is no region.
export function describeRegion(rects) {
  if (!rects || !rects.length) return '';
  const r = rects[0];
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const col = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'center' : 'right';
  const row = cy < 1 / 3 ? 'upper' : cy < 2 / 3 ? 'middle' : 'lower';
  const pct = (v) => Math.round(v * 100);
  return `${row} ${col} region (~${pct(r.x)}–${pct(r.x + r.w)}% × ${pct(r.y)}–${pct(r.y + r.h)}% of the figure)`;
}

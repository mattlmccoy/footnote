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

import { isActiveComment } from './model.js?v=53aeded';

// A figure number is either a chapter digit form ("3", "3.1") OR an appendix letter form ("A.1", "AA.2") —
// appendix top-level numbers render as letters (preprocess.py _letter). Trailing period REQUIRED (figTableMaps).
const FIG_NUM_RE   = /^\s*Figure\s+([A-Z]+(?:\.\d+)+|\d+(?:\.\d+)*)\./;
const FIG_LABEL_RE = /^(Figure|Fig\.?|Table)\s*[A-Za-z]*[\d.]+/i;  // figureLabel: leading label token (incl. appendix letter)
const REF_RE       = /\bFigure\s+([A-Z]+\.\d+(?:\.\d+)*|\d+(?:\.\d+)*)/g;   // in-prose ref "Figure 3.1" / "Figure A.1"

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

// Reduce drawn markup shapes (canvas pixels: rects {x,y,w,h} and freehand {points:[[x,y]…]}) to a single
// 0..1 bounding box over the W×H canvas — the input describeRegion turns into the "where I drew" phrase that
// the comment body carries to Claude. [] when there is nothing drawn or the canvas has no size.
export function normalizedBBox(shapes, W, H) {
  if (!shapes || !shapes.length || !W || !H) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    if (!s) continue;
    if (s.type === 'rect') { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
    else if (s.points) { for (const p of s.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } }
  }
  if (!isFinite(x0)) return [];
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [{ x: clamp(x0 / W), y: clamp(y0 / H), w: clamp((x1 - x0) / W), h: clamp((y1 - y0) / H) }];
}

// ---- Slice 3: sweep state (per-figure "reviewed") + sequential navigation (pure) ----

// Stable per-figure key for owner-local sweep tracking. chapter id + parsed number (both human-meaningful
// and stable across rebuilds as long as numbering holds).
export function figureKey(chapterId, fignum) { return `${chapterId}#${fignum}`; }

// Immutable done-state map { key: true }. markReviewed(state, key, on) sets/clears; never mutates input.
export function markReviewed(reviewed, key, on) {
  const r = { ...(reviewed || {}) };
  if (on) r[key] = true; else delete r[key];
  return r;
}
export function isReviewed(reviewed, key) { return !!(reviewed && reviewed[key]); }

// Every figure across all chapters in reading order, each tagged with its sweep key.
export function flattenFigures(gallery) {
  const out = [];
  for (const g of gallery || []) {
    const chId = g && g.chapter && g.chapter.id;
    for (const f of (g && g.figures) || []) out.push({ ...f, chapterId: chId, key: figureKey(chId, f.fignum) });
  }
  return out;
}

// Sweep progress across the whole document.
export function sweepProgress(gallery, reviewed) {
  const flat = flattenFigures(gallery);
  const done = flat.filter((f) => isReviewed(reviewed, f.key)).length;
  return { total: flat.length, done, remaining: flat.length - done };
}

// Next/prev figure for keyboard nav. dir>0 forward, dir<0 back. A null/unknown currentKey seeds from the
// first (forward) or last (back); walking past an end returns null (the caller decides whether to wrap).
export function adjacentFigure(gallery, currentKey, dir) {
  const flat = flattenFigures(gallery);
  if (!flat.length) return null;
  if (currentKey == null) return dir >= 0 ? flat[0] : flat[flat.length - 1];
  const i = flat.findIndex((f) => f.key === currentKey);
  if (i < 0) return dir >= 0 ? flat[0] : flat[flat.length - 1];
  const j = i + (dir >= 0 ? 1 : -1);
  return j >= 0 && j < flat.length ? flat[j] : null;
}

// The next figure that still needs a look (for a "jump to next unreviewed" control); null when swept.
export function firstUnreviewedFigure(gallery, reviewed) {
  return flattenFigures(gallery).find((f) => !isReviewed(reviewed, f.key)) || null;
}

// ---- Slice 2: the bulk-review gallery (view-model + renderer) ----

const _esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Compose the whole-document figure gallery view-model from the same inputs the reader already has:
// the ordered units, each unit's rendered HTML fragment, and each unit's comments (owner + advisor).
// Pure — returns [{ chapter, count, figures:[{fignum,caption,label,imgSrc,imgSrcTail,referencedIn,activeComments}] }].
export function buildGallery(units, fragmentsById, commentsByChapter) {
  const frags = fragmentsById || {}, byCh = commentsByChapter || {};
  return groupFiguresByChapter(units, frags).map(({ chapter, figures }) => {
    const refs = figureRefsInFragment(frags[chapter.id] || '');
    const withRefs = figures.map((f) => ({ ...f, referencedIn: refs[f.fignum] || [] }));
    const withCounts = attachCommentCounts(withRefs, byCh[chapter.id] || []);
    return { chapter, count: withCounts.length, figures: withCounts };
  });
}

// Render the gallery as a self-contained, escaped HTML string (unit-testable; the DOM glue in app.js wires
// the actions). Chapters with no figures are omitted; a document with no figures shows an empty state.
// opts.reviewed (a { key:true } sweep map) turns on the review affordances: a sweep-progress header, a
// per-card "done" flag, and Draw / Mark-done actions. Each card carries data-fig-ch / data-fig-num /
// data-fig-key so app.js can jump to the figure, open the draw overlay, or toggle its reviewed state.
export function galleryHtml(gallery, opts) {
  const groups = (gallery || []).filter((g) => g && g.figures && g.figures.length);
  if (!groups.length) {
    return '<div class="figgal-empty" style="text-align:center;color:var(--text-3);padding:48px 16px;font-size:13.5px">' +
      'No figures found in this document yet. Figures appear here once your chapters are rendered.</div>';
  }
  const reviewed = (opts && opts.reviewed) || null;
  const abtn = 'font-size:10.5px;padding:3px 9px;border-radius:6px;border:.5px solid var(--border);background:var(--bg);color:var(--text-2,var(--text));cursor:pointer';
  const card = (chId, f) => {
    const key = figureKey(chId, f.fignum);
    const done = isReviewed(reviewed, key);
    const badge = f.activeComments > 0
      ? `<span class="figgal-badge" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent,#2c64c4);color:#fff;font-size:10.5px;font-weight:600"> ${f.activeComments} </span>`
      : '';
    const check = done ? '<span class="figgal-check" style="position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;background:var(--accent,#2c64c4);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px"><i class="ti ti-check"></i></span>' : '';
    const refs = (f.referencedIn && f.referencedIn.length)
      ? `Referenced in ${f.referencedIn.map(_esc).join(', ')}` : 'Not referenced in text';
    const acts = reviewed
      ? `<div class="figgal-acts" style="display:flex;gap:6px;align-items:center;margin-top:2px">
          <button data-act="context" title="See this figure in its chapter" style="${abtn}"><i class="ti ti-arrow-up-right" aria-hidden="true"></i> View in chapter</button>
          <button data-act="done" title="Mark this figure reviewed" style="${abtn}${done ? ';background:var(--accent-bg,#eef);color:var(--accent,#2c64c4)' : ''};margin-left:auto">${done ? 'Reviewed' : 'Mark done'}</button>
        </div>` : '';
    return `<div class="figgal-card${done ? ' figgal-done' : ''}" data-fig-ch="${_esc(chId)}" data-fig-num="${_esc(f.fignum)}" data-fig-key="${_esc(key)}" style="display:flex;flex-direction:column;gap:7px;padding:9px;border:.5px solid ${done ? 'var(--accent,#2c64c4)' : 'var(--border)'};border-radius:9px;background:var(--bg)">
      <div data-act="draw" title="Click to draw on this figure &amp; comment" style="display:flex;flex-direction:column;gap:7px;cursor:crosshair;text-align:left">
        <span class="figgal-thumb" style="position:relative;display:block;aspect-ratio:16/10;overflow:hidden;border-radius:6px;background:var(--bg-3,#eef)"><img src="${_esc(f.imgSrc)}" alt="${_esc(f.caption)}" loading="lazy" style="width:100%;height:100%;object-fit:contain">${check}<span class="figgal-drawhint" style="position:absolute;left:6px;bottom:6px;display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:10px"><i class="ti ti-scribble" aria-hidden="true"></i>Draw</span></span>
        <span class="figgal-cap" style="font-size:12px;line-height:1.4;color:var(--text);display:block">${_esc(f.caption)}</span>
        <span class="figgal-meta" style="display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:10.5px;color:var(--text-3)"><span>${refs}</span>${badge}</span>
      </div>${acts}
    </div>`;
  };
  const sections = groups.map((g) => {
    const title = g.chapter && g.chapter.title ? g.chapter.title : g.chapter && g.chapter.id;
    const n = g.chapter && (g.chapter.n != null) ? `${_esc(String(g.chapter.n))} · ` : '';
    return `<section class="figgal-ch" style="margin:0 0 22px">
      <h3 style="font-size:13px;font-weight:600;color:var(--text-2,var(--text));margin:0 0 10px;position:sticky;top:0;background:var(--bg);padding:6px 0">${n}${_esc(title)} <span style="color:var(--text-3);font-weight:400">· ${g.figures.length} figure${g.figures.length === 1 ? '' : 's'}</span></h3>
      <div class="figgal-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">${g.figures.map((f) => card(g.chapter.id, f)).join('')}</div>
    </section>`;
  }).join('');
  let header = '';
  if (reviewed) {
    const p = sweepProgress(gallery, reviewed);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    header = `<div class="figgal-progress" style="display:flex;align-items:center;gap:12px;margin:0 0 18px;font-size:12px;color:var(--text-3)">
      <span>${p.done} of ${p.total} reviewed</span>
      <span style="flex:1;height:5px;border-radius:3px;background:var(--bg-3,#eef);overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:var(--accent,#2c64c4)"></span></span>
    </div>`;
  }
  return header + sections;
}

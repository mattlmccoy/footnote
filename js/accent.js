// Accent color picker (Apple-style). A per-viewer choice recolors the two theme variables the whole UI
// already flows from (--accent, --accent-bg). Class-based so the CSS cascade handles light/dark:
// picking an accent sets an `ac-<id>` class on <html>; a `.dark.ac-<id>` rule supplies the dark values.
// Stored per-browser in localStorage (like the theme toggle). Pure helpers are unit-tested; the DOM
// apply + boot wiring are browser-verified. Shared by the owner (hub.js) and reviewer (advisor.js) boots.

// Ordered palette. `default` is a sentinel (no colors) → no override, the instance brand accent stands.
// Each named accent is tuned for BOTH modes so white button text stays legible (yellow is a deep gold).
export const ACCENTS = [
  { id: 'default', name: 'Default' },
  { id: 'blue',     name: 'Blue',     light: { accent: '#2c64c4', bg: '#eaf1fb' }, dark: { accent: '#6aa0ec', bg: '#1b2c44' } },
  { id: 'purple',   name: 'Purple',   light: { accent: '#7c4ddb', bg: '#efeafb' }, dark: { accent: '#b291f2', bg: '#241d3a' } },
  { id: 'pink',     name: 'Pink',     light: { accent: '#d23c7e', bg: '#fbe8f0' }, dark: { accent: '#ef83b1', bg: '#361b28' } },
  { id: 'red',      name: 'Red',      light: { accent: '#cf3b34', bg: '#fbe7e6' }, dark: { accent: '#ee8a84', bg: '#371c1a' } },
  { id: 'orange',   name: 'Orange',   light: { accent: '#cf7518', bg: '#fbeee0' }, dark: { accent: '#ef9f4d', bg: '#33260f' } },
  { id: 'yellow',   name: 'Yellow',   light: { accent: '#a9800a', bg: '#f7f0d8' }, dark: { accent: '#e0bd48', bg: '#2f280f' } },
  { id: 'green',    name: 'Green',    light: { accent: '#3f9142', bg: '#e7f4e7' }, dark: { accent: '#71c274', bg: '#182f19' } },
  { id: 'graphite', name: 'Graphite', light: { accent: '#71717a', bg: '#eef0f2' }, dark: { accent: '#a1a1aa', bg: '#26282c' } },
];

const NAMED = new Set(ACCENTS.filter(a => a.light).map(a => a.id));
const isValidAccent = (id) => id === 'default' || NAMED.has(id);
const STYLE_ID = 'accent-palette';
const KEY = 'accent';   // bare key, like the theme toggle's 'theme'

// The palette stylesheet: a light + dark rule per named accent, !important so it beats hub.js's inline
// brand --accent. No rule for `default` (no ac-* class → the brand accent stands). Pure.
export function accentPaletteCss() {
  return ACCENTS.filter(a => a.light).map(a =>
    `:root.ac-${a.id}{--accent:${a.light.accent}!important;--accent-bg:${a.light.bg}!important}\n` +
    `.dark.ac-${a.id}{--accent:${a.dark.accent}!important;--accent-bg:${a.dark.bg}!important}`
  ).join('\n');
}

// The picker row: one round swatch per accent. `default` is the multicolor gradient; the selected one
// gets a ring. Buttons carry data-accent (the click target). Self-contained + escaped. Pure.
export function swatchesHtml(selectedId) {
  const esc = (s) => String(s).replace(/[<>"&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
  return `<div class="ac-swatches" style="display:flex;gap:12px;flex-wrap:wrap">` + ACCENTS.map(a => {
    const on = a.id === selectedId;
    const fill = a.id === 'default'
      ? 'background:conic-gradient(from 0deg,#e0568c,#e58f2a,#e6b93a,#4a9e4a,#2c64c4,#8e5adf,#e0568c);'
      : `background:${a.light.accent};`;
    const ringColor = a.id === 'default' ? '#8e5adf' : a.light.accent;
    const ring = on ? `box-shadow:0 0 0 2px var(--bg,#fff),0 0 0 4px ${ringColor};` : '';
    return `<button type="button" class="ac-swatch" data-accent="${esc(a.id)}" data-on="${on ? '1' : '0'}"` +
      ` aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(a.name)}" title="${esc(a.name)}"` +
      ` style="width:24px;height:24px;border-radius:50%;border:0;padding:0;cursor:pointer;${fill}${ring}"></button>`;
  }).join('') + `</div>`;
}

// Compute the next <html> className for a chosen accent: drop any existing `ac-*`, keep everything else
// (e.g. `dark`), and add `ac-<id>` for a valid NAMED accent (default/unknown → none). Pure.
export function nextAccentClassName(currentClassName, id) {
  const kept = String(currentClassName || '').split(/\s+/).filter(t => t && !t.startsWith('ac-'));
  if (NAMED.has(id)) kept.push(`ac-${id}`);
  return kept.join(' ');
}

// localStorage read/write (bare 'accent' key). Unknown/absent → 'default'; saving normalizes. Pure.
export function storedAccent(storage) {
  try { const v = storage && storage.getItem(KEY); return isValidAccent(v) ? v : 'default'; }
  catch { return 'default'; }
}
export function saveAccent(storage, id) {
  const norm = isValidAccent(id) ? id : 'default';
  try { storage && storage.setItem(KEY, norm); } catch { /* private mode / blocked storage */ }
  return norm;
}

// ---- DOM (browser-verified) ----

// Inject the palette stylesheet once (idempotent).
export function ensurePaletteStyle(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || d.getElementById(STYLE_ID)) return;
  const style = d.createElement('style');
  style.id = STYLE_ID;
  style.textContent = accentPaletteCss();
  (d.head || d.documentElement).appendChild(style);
}

// Apply an accent by swapping the <html> ac-* class. Does NOT persist (caller decides).
export function applyAccent(id, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return;
  d.documentElement.className = nextAccentClassName(d.documentElement.className, id);
}

// Boot helper: inject the palette + apply the stored accent. Call after the theme class is set.
export function initAccent(doc, storage) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  ensurePaletteStyle(d);
  applyAccent(storedAccent(s), d);
}

// Accent color picker (Apple-style). A per-viewer choice recolors the two theme variables the whole UI
// already flows from (--accent, --accent-bg). Class-based so the CSS cascade handles light/dark:
// picking an accent sets an `ac-<id>` class on <html>; a `.dark.ac-<id>` rule supplies the dark values.
// Stored per-browser in localStorage (like the theme toggle). Pure helpers are unit-tested; the DOM
// apply + boot wiring are browser-verified. Shared by the owner (hub.js) and reviewer (advisor.js) boots.

// Ordered palette. `default` is a sentinel (no colors) → no override, the instance brand accent stands.
// Each named accent is tuned for BOTH modes so white button text stays legible (yellow is a deep gold).
export const ACCENTS = [
  { id: 'multicolor', name: 'Multicolor' },   // dynamic: cycles through the palette (see startMulticolor)
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
export const NAMED_IDS = ACCENTS.filter(a => a.light).map(a => a.id);   // the static colors Multicolor cycles through
const isValidAccent = (id) => id === 'default' || id === 'multicolor' || NAMED.has(id);
export const CYCLE_MS = 30 * 60 * 1000;   // Multicolor picks a new color every 30 minutes
export const SWEEP_MS = 1500;             // and sweeps round the hue wheel to get there
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
    const tip = a.light ? a.name : `${a.name} (click again to shuffle)`;
    const fill = !a.light
      ? 'background:conic-gradient(from 0deg,#e0568c,#e58f2a,#e6b93a,#4a9e4a,#2c64c4,#8e5adf,#e0568c);'
      : `background:${a.light.accent};`;
    const ringColor = a.light ? a.light.accent : '#8e5adf';
    const ring = on ? `box-shadow:0 0 0 2px var(--bg,#fff),0 0 0 4px ${ringColor};` : '';
    return `<button type="button" class="ac-swatch" data-accent="${esc(a.id)}" data-on="${on ? '1' : '0'}"` +
      ` aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(a.name)}" title="${esc(tip)}"` +
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
  stopMulticolor(d);                                 // also clears any inline colors the cycler set
  d.documentElement.className = nextAccentClassName(d.documentElement.className, id);
  if (id === 'multicolor') startMulticolor(d);       // drives --accent inline, a new color every 30 min
}

// Boot helper: inject the palette + apply the stored accent. Call after the theme class is set.
export function initAccent(doc, storage) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  ensurePaletteStyle(d);
  applyAccent(storedAccent(s), d);
}

// ---- Multicolor: a living accent that drifts through the palette ----
// Deterministic from the clock (every tab/window agrees and it never drifts), pseudo-random order.

export function accentForSlot(nowMs, ids, intervalMs = CYCLE_MS) {
  const slot = Math.floor(nowMs / intervalMs);
  const h = (Math.imul(slot ^ 0x9e3779b9, 2654435761) >>> 0);
  return ids[h % ids.length];
}

export function hexToHsl(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(seg[0])}${to(seg[1])}${to(seg[2])}`;
}

// Interpolate from → to at progress t, taking the LONG way around the hue wheel so the eye sees a
// little rainbow pass through instead of a flat blend. t=0 → from, t=1 → to. Pure.
export function rainbowSweep(fromHex, toHex, t) {
  const a = hexToHsl(fromHex), b = hexToHsl(toHex);
  let dh = b.h - a.h;
  if (Math.abs(dh) < 180) dh = dh > 0 ? dh - 360 : dh + 360;   // go the long way
  return hslToHex(a.h + dh * t, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t);
}

// Rotate a colour's hue by `deg` degrees, keeping saturation/lightness. Pure.
export function hueShift(hex, deg) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + deg, s, l);
}

// ---- the cycler (DOM; browser-verified) ----
let _timer = null, _raf = null, _obs = null, _cur = null, _inlineSet = false;
const _mode = (d) => (d.documentElement.classList.contains('dark') ? 'dark' : 'light');
const _vals = (id, mode) => { const a = ACCENTS.find(x => x.id === id); return a && a[mode]; };

function setInline(d, accent, bg) {
  // 'important' so the sweep beats the palette's own `:root.ac-<id>{--accent:…!important}` rule —
  // otherwise the animation is invisible whenever a static colour is selected.
  d.documentElement.style.setProperty('--accent', accent, 'important');
  if (bg) d.documentElement.style.setProperty('--accent-bg', bg, 'important');
  _inlineSet = true;
}
// Only clear what WE set, so an instance's inline brand accent isn't wiped.
function clearInline(d) {
  if (!_inlineSet) return;
  d.documentElement.style.removeProperty('--accent');
  d.documentElement.style.removeProperty('--accent-bg');
  _inlineSet = false;
}

export function stopMulticolor(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null); if (!d) return;
  if (_timer) clearTimeout(_timer);
  if (_raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(_raf);
  if (_obs) _obs.disconnect();
  _timer = _raf = _obs = _cur = null;
  clearInline(d);
}

function _reduceMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// Animate from one palette colour to another, the long way round the hue wheel. Shared by the
// 30-minute cycle and the manual shuffle.
function _sweepTo(d, fromId, toId) {
  const m = _mode(d), a = _vals(fromId, m), b = _vals(toId, m);
  if (!a || !b) return;
  if (_reduceMotion() || typeof requestAnimationFrame === 'undefined') { setInline(d, b.accent, b.bg); return; }
  if (_raf) cancelAnimationFrame(_raf);
  const t0 = Date.now();
  const step = () => {
    const p = Math.min(1, (Date.now() - t0) / SWEEP_MS);
    setInline(d, rainbowSweep(a.accent, b.accent, p), rainbowSweep(a.bg, b.bg, p));
    if (p < 1) _raf = requestAnimationFrame(step);
  };
  _raf = requestAnimationFrame(step);
}

// Pick a palette colour that isn't the current one. Pure (rand injectable).
export function pickDifferent(current, ids, rand = Math.random) {
  const pool = (ids || []).filter(i => i !== current);
  if (!pool.length) return current;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

// The hidden trigger: sweep to a new colour right now (the 30-minute schedule carries on after).
export function shuffleMulticolor(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !_cur) return null;
  const next = pickDifferent(_cur, NAMED_IDS);
  _sweepTo(d, _cur, next);
  _cur = next;
  return next;
}

// What a swatch click should do: re-clicking the ACTIVE Multicolor swatch shuffles instead of
// re-selecting (the subtle manual trigger); anything else selects normally.
export function chooseAccent(id, doc, storage) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (id === 'multicolor' && storedAccent(s) === 'multicolor') { shuffleMulticolor(d); return id; }
  applyAccent(id, d); saveAccent(s, id);
  return id;
}

export function startMulticolor(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null); if (!d) return;
  const paint = (id) => { const v = _vals(id, _mode(d)); if (v) setInline(d, v.accent, v.bg); };
  _cur = accentForSlot(Date.now(), NAMED_IDS, CYCLE_MS);
  paint(_cur);
  // keep the right light/dark value when the viewer flips the theme mid-cycle
  if (typeof MutationObserver !== 'undefined') {
    _obs = new MutationObserver(() => { if (_cur) paint(_cur); });
    _obs.observe(d.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
  const schedule = () => {
    _timer = setTimeout(() => {
      const next = accentForSlot(Date.now(), NAMED_IDS, CYCLE_MS);
      if (next !== _cur) { _sweepTo(d, _cur, next); _cur = next; }
      schedule();
    }, CYCLE_MS - (Date.now() % CYCLE_MS) + 50);
  };
  schedule();
}

// ---- completion celebration ----
// A one-off victory lap: sweep the accent a full turn around the hue wheel and land back on the
// colour you started with, so nothing about your chosen accent actually changes. Works whatever
// accent is active (including Multicolor), and afterwards the authoritative state is re-applied.
let _celebRaf = null;
export const CELEBRATE_MS = 2000;

export function celebrate(doc, storage) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof getComputedStyle === 'undefined') return false;
  if (_reduceMotion() || typeof requestAnimationFrame === 'undefined') return false;   // no flashing
  const cs = getComputedStyle(d.documentElement);
  const base = (cs.getPropertyValue('--accent') || '').trim();
  const baseBg = (cs.getPropertyValue('--accent-bg') || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(base)) return false;
  const bgOk = /^#[0-9a-f]{6}$/i.test(baseBg);
  if (_celebRaf) cancelAnimationFrame(_celebRaf);
  const t0 = Date.now();
  const step = () => {
    const p = Math.min(1, (Date.now() - t0) / CELEBRATE_MS);
    const deg = 360 * (p < 1 ? (1 - Math.pow(1 - p, 3)) : 1);   // ease-out: quick spin, gentle landing
    setInline(d, hueShift(base, deg), bgOk ? hueShift(baseBg, deg) : undefined);
    if (p < 1) { _celebRaf = requestAnimationFrame(step); return; }
    _celebRaf = null;
    clearInline(d);
    applyAccent(storedAccent(storage || (typeof localStorage !== 'undefined' ? localStorage : null)), d);
  };
  _celebRaf = requestAnimationFrame(step);
  return true;
}

// ---- easter egg: alt/option-click the theme button 3x to jump to a shuffling Multicolor ----
// Pure streak detector: N alt-clicks inside a rolling time window. Injectable clock for tests.
export class AltTripleClick {
  constructor(windowMs = 600, now = () => Date.now(), need = 3) { this.w = windowMs; this.now = now; this.need = need; this.n = 0; this.last = -Infinity; }
  hit(altKey) {
    const t = this.now();
    if (!altKey || t - this.last > this.w) this.n = 0;   // non-alt or too slow → restart the streak
    this.last = t;
    if (!altKey) return false;
    this.n += 1;
    if (this.n >= this.need) { this.n = 0; return true; }
    return false;
  }
}

// Wrap a theme-toggle handler so an alt-triple-click triggers Multicolor instead of toggling the
// theme on that 3rd click. The normal (non-alt) click still toggles; alt-clicks before the 3rd are
// swallowed so dark mode doesn't flicker. Returns the wrapped click handler. DOM (browser-verified).
export function withColorEasterEgg(toggleTheme, doc, storage) {
  const det = new AltTripleClick();
  return (e) => {
    if (e && e.altKey) {
      e.preventDefault();
      if (det.hit(true)) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        applyAccent('multicolor', d); saveAccent(s, 'multicolor');   // start the cycle…
        shuffleMulticolor(d);                                        // …and jump to a fresh colour now
      }
      return;                                    // alt-clicks never toggle the theme
    }
    det.hit(false);                              // a plain click breaks any in-progress streak
    toggleTheme(e);
  };
}

// One-shot rainbow "fill" celebration for a chapter card's progress bar (home grid). Grows the fill
// from 0 to 100% behind a moving rainbow gradient, then settles to the steady colour. DOM; the bar
// uses local --success/--accent (no !important class), so a plain inline write is fine here.
export function celebrateCardFill(fillEl, settleColor) {
  const d = typeof document !== 'undefined' ? document : null;
  if (!fillEl || !d) return false;
  if (_reduceMotion()) return false;   // no motion for those who opted out
  if (!d.getElementById('cardfill-kf')) {
    const st = d.createElement('style'); st.id = 'cardfill-kf';
    st.textContent = '@keyframes ccfill{from{width:0}to{width:100%}}@keyframes ccsweep{from{background-position:0 0}to{background-position:220px 0}}';
    (d.head || d.documentElement).appendChild(st);
  }
  const prev = fillEl.style.cssText;
  fillEl.style.background = 'linear-gradient(90deg,#e0568c,#e58f2a,#e6b93a,#4a9e4a,#2c64c4,#8e5adf,#e0568c)';
  fillEl.style.backgroundSize = '220px 100%';
  fillEl.style.width = '100%';
  fillEl.style.animation = 'ccfill .9s cubic-bezier(.22,.61,.36,1) both, ccsweep 1.1s linear';
  const done = () => {
    fillEl.removeEventListener('animationend', done);
    fillEl.style.cssText = prev;                 // back to the steady bar the render set
    fillEl.style.width = '100%';
    if (settleColor) fillEl.style.background = settleColor;
  };
  fillEl.addEventListener('animationend', done);
  setTimeout(done, 1600);                         // safety net if animationend is missed
  return true;
}

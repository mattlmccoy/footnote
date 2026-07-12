// Build-info tag: surfaces the running build SHA so cache staleness is diagnosable.
// The SHA comes for free from each entry module's own import.meta.url (?v=<sha>), which the
// cache-bust bot bumps on every deploy. AI-term-free on purpose so advisor.js stays grep-clean.

// Parse the cache-bust SHA out of a module URL. Returns 'dev' when absent/blank/malformed.
export function buildSha(metaUrl) {
  try {
    const v = new URL(metaUrl).searchParams.get('v');
    return v || 'dev';
  } catch {
    return 'dev';
  }
}

// The entry-module bundle name (hub|app|advisor) for the build indicator's module tag.
export function moduleName(metaUrl) {
  let path;
  try { path = new URL(metaUrl).pathname; }
  catch { path = String(metaUrl == null ? '' : metaUrl).split('?')[0]; }
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.js$/, '');
  return file || 'app';
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// ISO string -> "Jul 9, 2026 2:14 PM" in the viewer's local time. '' for missing/invalid.
export function formatBuildTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${m} ${ap}`;
}

// The tiny always-visible pill text: prefers the site-wide sha, falls back to the module hash then 'dev'.
export function collapsedLabel({ globalSha, fileHash } = {}) {
  return 'build ' + (globalSha || fileHash || 'dev');
}
// The expanded detail: "<module> <fileHash> · <time>", empty parts dropped.
export function detailLine({ module, fileHash, time } = {}) {
  const left = [module, fileHash].filter(Boolean).join(' ');
  return [left, time].filter(Boolean).join(' · ');
}

// Injects a small light-blue orb, fixed bottom-left. Hovering it (or clicking, for touch) expands the
// full build line: "build <sha> · <module> <fileHash> · <time> · Refresh". Collapsed it's just the orb, so
// it stays out of the way. Idempotent. build.json (fetched best-effort) upgrades the label to the site-wide
// sha + fills the timestamp; absent it, the module's own hash is shown. Refresh reloads the top-level HTML
// with a cache-busting ?r=<ts> so the CDN-cached shell (and newest module ?v=) is re-fetched.
// DOM/UI — browser-verified; the pure helpers are unit-tested. No assistant terms (advisor.js imports this).
export function showBuildTag(metaUrl, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || !w.document) return;
  const doc = w.document;
  if (doc.getElementById('fn-build')) return; // idempotent

  const fileHash = buildSha(metaUrl);
  const mod = moduleName(metaUrl);
  const state = { globalSha: '', time: '' };

  const el = doc.createElement('div');
  el.id = 'fn-build';
  el.setAttribute('style', 'position:fixed;left:9px;bottom:9px;z-index:900;font-size:10.5px;color:var(--text-3);font-family:inherit;user-select:none;display:flex;align-items:center;gap:7px;max-width:76vw;pointer-events:auto');

  // The orb: a small flat dot in the tool's accent — the only thing visible when collapsed. On open it
  // gets the same flat accent-bg halo the reader uses for hover states (no gradient/glow — matches the
  // flat editorial styling and adapts to light/dark via the CSS vars).
  const orb = doc.createElement('button');
  orb.setAttribute('data-role', 'orb');
  orb.setAttribute('aria-label', 'Build info');
  const orbStyle = (hot) =>
    'width:9px;height:9px;flex:0 0 auto;padding:0;border:0;border-radius:50%;cursor:pointer;' +
    'background:var(--accent);opacity:' + (hot ? '1' : '.55') + ';' +
    'box-shadow:' + (hot ? '0 0 0 3px var(--accent-bg)' : 'none') + ';' +
    'transition:opacity .15s ease, box-shadow .15s ease';
  orb.setAttribute('style', orbStyle(false));

  // The expandable text group (hidden until open).
  const label = doc.createElement('span');
  label.textContent = collapsedLabel({ globalSha: state.globalSha, fileHash });

  const detail = doc.createElement('span');
  detail.setAttribute('data-role', 'detail');
  detail.setAttribute('style', 'margin-left:6px;color:var(--text-3);opacity:.75');
  detail.textContent = detailLine({ module: mod, fileHash, time: state.time });

  const btn = doc.createElement('button');
  btn.textContent = 'Refresh';
  btn.setAttribute('style', 'margin-left:8px;background:none;border:0;color:var(--accent);font:inherit;cursor:pointer;padding:0;pointer-events:auto');
  btn.onclick = () => { const loc = w.location; loc.replace(loc.pathname + '?r=' + Date.now()); };

  const expandable = [label, detail, btn];

  let pinned = false, hovered = false;
  const isOpen = () => pinned || hovered;
  const apply = () => {
    label.textContent = collapsedLabel({ globalSha: state.globalSha, fileHash });
    detail.textContent = detailLine({ module: mod, fileHash, time: state.time });
    const open = isOpen();
    for (const node of expandable) {
      const base = node === btn
        ? 'margin-left:8px;background:none;border:0;color:var(--accent);font:inherit;cursor:pointer;padding:0;pointer-events:auto;'
        : (node === detail ? 'margin-left:6px;color:var(--text-3);opacity:.75;' : '');
      node.setAttribute('style', base + 'transition:opacity .15s ease;' + (open ? 'opacity:1;' : 'display:none;'));
    }
    orb.setAttribute('style', orbStyle(open));
    el.setAttribute('data-open', open ? '1' : '0');
  };

  orb.onclick = () => { pinned = !pinned; apply(); };          // touch / click-to-pin
  el.onmouseenter = () => { hovered = true; apply(); };        // desktop hover-expand
  el.onmouseleave = () => { hovered = false; apply(); };

  el.appendChild(orb);
  el.appendChild(label);
  el.appendChild(detail);
  el.appendChild(btn);
  (doc.body || doc.documentElement).appendChild(el);
  apply();   // collapsed initial state (orb only, data-open="0")

  if (typeof w.fetch === 'function') {
    w.fetch('build.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r && r.ok ? r.json() : null))
      .then(j => { if (j && (j.sha || j.time)) { state.globalSha = j.sha || ''; state.time = formatBuildTime(j.time); apply(); } })
      .catch(() => {});
  }
}

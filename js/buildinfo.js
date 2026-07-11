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

// Injects a muted, fixed bottom-left pill: "build <sha> · Refresh". Clicking the build label expands a
// detail line "<module> <fileHash> · <time>". Idempotent. build.json (fetched best-effort) upgrades the
// collapsed label to the site-wide sha + fills the timestamp; absent it, the module's own hash is shown.
// Refresh reloads the top-level HTML with a cache-busting ?r=<ts> so the CDN-cached shell is re-fetched
// (which in turn pulls the newest module ?v=). DOM/UI — browser-verified; the pure helpers are unit-tested.
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
  el.setAttribute('style', 'position:fixed;left:8px;bottom:7px;z-index:900;font-size:10.5px;color:var(--text-3);opacity:.55;font-family:inherit;user-select:none;display:flex;align-items:center;flex-wrap:wrap;max-width:70vw');

  const label = doc.createElement('button');
  label.setAttribute('style', 'background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;pointer-events:auto');
  label.textContent = collapsedLabel({ globalSha: state.globalSha, fileHash });

  const detail = doc.createElement('span');
  detail.setAttribute('data-role', 'detail');
  detail.setAttribute('style', 'display:none;margin-left:6px');
  detail.textContent = detailLine({ module: mod, fileHash, time: state.time });

  const sep = doc.createElement('span');
  sep.textContent = ' · ';
  sep.setAttribute('style', 'margin:0 4px');

  const btn = doc.createElement('button');
  btn.textContent = 'Refresh';
  btn.setAttribute('style', 'background:none;border:0;color:var(--accent);font:inherit;cursor:pointer;padding:0;pointer-events:auto');
  btn.onclick = () => { const loc = w.location; loc.replace(loc.pathname + '?r=' + Date.now()); };

  let open = false;
  const redraw = () => {
    label.textContent = collapsedLabel({ globalSha: state.globalSha, fileHash });
    detail.textContent = detailLine({ module: mod, fileHash, time: state.time });
    detail.setAttribute('style', (open ? 'display:inline;' : 'display:none;') + 'margin-left:6px');
  };
  label.onclick = () => { open = !open; redraw(); };

  el.appendChild(label);
  el.appendChild(detail);
  el.appendChild(sep);
  el.appendChild(btn);
  (doc.body || doc.documentElement).appendChild(el);

  if (typeof w.fetch === 'function') {
    w.fetch('build.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r && r.ok ? r.json() : null))
      .then(j => { if (j && (j.sha || j.time)) { state.globalSha = j.sha || ''; state.time = formatBuildTime(j.time); redraw(); } })
      .catch(() => {});
  }
}

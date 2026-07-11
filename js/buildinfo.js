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

// Inject a muted, fixed bottom-left pill: "build <sha> · Refresh". Idempotent.
// Refresh reloads the top-level HTML with a cache-busting ?r=<ts> so the CDN-cached shell is
// re-fetched (which in turn pulls the newest module ?v=). DOM/UI — browser-verified, not unit-tested.
export function showBuildTag(metaUrl, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || !w.document) return;
  const doc = w.document;
  if (doc.getElementById('fn-build')) return; // idempotent

  const el = doc.createElement('div');
  el.id = 'fn-build';
  el.setAttribute('style', 'position:fixed;left:8px;bottom:7px;z-index:900;font-size:10.5px;color:var(--text-3);opacity:.55;font-family:inherit;user-select:none;pointer-events:none');

  const label = doc.createElement('span');
  label.textContent = 'build ' + buildSha(metaUrl);
  const sep = doc.createElement('span');
  sep.textContent = ' · ';
  const btn = doc.createElement('button');
  btn.textContent = 'Refresh';
  btn.setAttribute('style', 'background:none;border:0;color:var(--accent);font:inherit;cursor:pointer;padding:0;pointer-events:auto');
  btn.onclick = () => { const loc = w.location; loc.replace(loc.pathname + '?r=' + Date.now()); };

  el.appendChild(label);
  el.appendChild(sep);
  el.appendChild(btn);
  (doc.body || doc.documentElement).appendChild(el);
}

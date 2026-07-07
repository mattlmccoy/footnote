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

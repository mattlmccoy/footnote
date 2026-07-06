// Connection-health banner. Footnote is network-bound — every page, comment, and save is a GitHub API
// call — so a weak or dropped connection should be visible, not a silent hang. This module watches the
// real requests (by wrapping fetch) plus the browser's online/offline events, and shows a thin banner
// when things degrade. Pure decision logic (netHealth/pushSample/bannerText) is unit-tested; startWatch
// does the browser wiring. No dependency on any app state — safe to start once at boot on any page.

// A bounded ring buffer of the most recent request outcomes ({ ok, ms }). Pure — returns a new array.
export function pushSample(recent, sample, max = 6) {
  return [...(recent || []), sample].slice(-max);
}

const SLOW_MS = 4000;   // a successful request slower than this counts as "slow"

// Decide the banner state from the browser online flag + recent samples.
//   'offline'     — navigator reports offline (no connection at all)
//   'unreachable' — navigator says ONLINE but requests keep failing → api.github.com is blocked
//                   (ad-blocker / privacy extension / DNS / corporate firewall), not a dead link
//   'slow'        — one recent failure, or several slow-but-successful requests
//   'ok'          — healthy (no banner)
export function netHealth({ online, recent } = {}) {
  if (online === false) return 'offline';
  const r = recent || [];
  const fails = r.filter(s => s && !s.ok).length;
  if (fails >= 2) return 'unreachable';   // online per the browser, yet GitHub won't respond → something is blocking it
  const slow = r.filter(s => s && s.ok && s.ms > SLOW_MS).length;
  if (fails >= 1 || slow >= 2) return 'slow';
  return 'ok';
}

// Honest per-state copy. Empty string means "show nothing".
export function bannerText(state) {
  if (state === 'offline') return 'You’re offline — Footnote can’t reach GitHub. Pages and comments can’t load or save until your connection is back.';
  if (state === 'unreachable') return 'Can’t reach GitHub — an ad-blocker or privacy extension may be blocking api.github.com. Disable blockers for this site (or try another browser), then reload.';
  if (state === 'slow') return 'Slow connection — loading and saving may be delayed.';
  return '';
}

// ---- browser wiring (not unit-tested; verified in the browser) ----

let _started = false;

function ensureBanner() {
  let el = document.getElementById('fn-netbanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fn-netbanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;display:none;padding:7px 16px;' +
      'text-align:center;font:500 12.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.18)';
    document.body.appendChild(el);
  }
  return el;
}

function paint(state) {
  const el = ensureBanner();
  const txt = bannerText(state);
  if (!txt) { el.style.display = 'none'; return; }
  el.style.background = (state === 'offline' || state === 'unreachable') ? '#b3261e' : '#8a6a00';   // red / amber
  el.textContent = txt;
  el.style.display = 'block';
}

// Start watching. Wraps window.fetch to sample every request, listens to online/offline, and repaints the
// banner only when the state actually changes. Idempotent — calling twice is a no-op.
export function startWatch(win = (typeof window !== 'undefined' ? window : null)) {
  if (_started || !win || typeof win.fetch !== 'function') return;
  _started = true;
  const now = () => (win.performance && win.performance.now ? win.performance.now() : new Date().getTime());
  let state = { online: win.navigator ? win.navigator.onLine !== false : true, recent: [] };
  let shown = null;
  const refresh = () => { const s = netHealth(state); if (s !== shown) { shown = s; paint(s); } };

  const orig = win.fetch.bind(win);
  win.fetch = async (...args) => {
    const t0 = now();
    try {
      const res = await orig(...args);
      state = { ...state, recent: pushSample(state.recent, { ok: true, ms: now() - t0 }) };
      refresh();
      return res;
    } catch (e) {
      // a thrown fetch = a real network failure (DNS/offline/CORS-preflight/abort), not an HTTP error status
      state = { ...state, recent: pushSample(state.recent, { ok: false, ms: now() - t0 }) };
      refresh();
      throw e;
    }
  };

  win.addEventListener('offline', () => { state = { ...state, online: false }; refresh(); });
  win.addEventListener('online', () => { state = { online: true, recent: [] }; refresh(); });   // clear stale failures on recovery
  refresh();
}

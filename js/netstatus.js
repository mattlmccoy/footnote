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

// Whether to show the banner given the live state and the state the user last dismissed. Dismissing
// silences only THAT exact state; escalating to a different state (e.g. slow → offline) shows again so a
// real degradation isn't hidden. 'ok'/empty never shows. Pure.
export function shouldShow(state, dismissedState) {
  if (!state || state === 'ok') return false;
  return state !== dismissedState;
}

// Honest per-state copy. Empty string means "show nothing".
export function bannerText(state) {
  if (state === 'offline') return 'You’re offline — Footnote can’t reach GitHub. Pages and comments can’t load or save until your connection is back.';
  if (state === 'unreachable') return 'Can’t reach GitHub right now — usually a GitHub outage (check githubstatus.com) or a local blocker (ad-blocker / privacy extension / VPN). Your data is safe; things recover on their own when GitHub is back.';
  if (state === 'slow') return 'Slow connection — loading and saving may be delayed.';
  return '';
}

// Collapse the health state into a subtle 3-way dot status: 'online' (green), 'unstable' (amber),
// 'offline' (grey). 'unreachable' (blocked/outage) and 'offline' both read as grey — the element stays,
// the dot just goes quiet. Default optimistic so a dot never starts alarming. Pure.
export function uiStatus(state) {
  if (state === 'offline' || state === 'unreachable') return 'offline';
  if (state === 'slow') return 'unstable';
  return 'online';
}

// ---- per-element status dots (subtle green/amber/grey; verified in the browser) ----

let _ui = 'online';
export function currentUiStatus() { return _ui; }   // for fresh renders to bake in the current status

// Paint one dot element for a ui status. Generic DOM — no app state. Colors fall back if the CSS var is absent.
export function applyDot(el, ui = _ui) {
  if (!el) return;
  const color = ui === 'online' ? 'var(--success, #3aa76d)'
              : ui === 'unstable' ? 'var(--warn, #b8860b)'
              : 'var(--text-3, #9aa0a6)';
  const label = ui === 'online' ? 'Online — GitHub reachable'
              : ui === 'unstable' ? 'Unstable connection — GitHub is responding slowly'
              : 'Can’t reach GitHub right now — your data is safe; this section will refill when it’s back';
  el.style.background = color;
  el.title = label;
  el.setAttribute('data-ui', ui);
}

// Repaint every `.fn-status-dot` in the document to the current status. Cheap; safe to call anytime.
export function paintDots(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.querySelectorAll) return;
  doc.querySelectorAll('.fn-status-dot').forEach(el => applyDot(el, _ui));
}

// ---- browser wiring (not unit-tested; verified in the browser) ----

let _started = false;
let _dismissed = null;      // the state the user last dismissed (silence only that exact state)

function ensureBanner() {
  let el = document.getElementById('fn-netbanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fn-netbanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // BOTTOM banner (was top, where it covered the toolbar) — a thin bar the user can dismiss, like the
    // update toast. Centered content + a close button; never blocks the top bar.
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;display:none;' +
      'align-items:center;gap:12px;padding:7px 16px;' +
      'font:500 12.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;' +
      'box-shadow:0 -1px 4px rgba(0,0,0,.18)';
    el.innerHTML = '<span id="fn-netbanner-txt" style="flex:1;text-align:center"></span>' +
      '<button id="fn-netbanner-x" aria-label="Dismiss" title="Dismiss" ' +
      'style="all:unset;cursor:pointer;padding:0 6px;font-size:15px;line-height:1;opacity:.85">×</button>';
    document.body.appendChild(el);
  }
  return el;
}

function paint(state) {
  const el = ensureBanner();
  if (state === 'ok') _dismissed = null;            // recovered → a later degradation should show again
  const txt = bannerText(state);
  if (!shouldShow(state, _dismissed) || !txt) { el.style.display = 'none'; return; }
  el.style.background = (state === 'offline' || state === 'unreachable') ? '#b3261e' : '#8a6a00';   // red / amber
  el.querySelector('#fn-netbanner-txt').textContent = txt;
  el.style.display = 'flex';
  const x = el.querySelector('#fn-netbanner-x');
  x.onclick = () => { _dismissed = state; el.style.display = 'none'; };   // silence THIS state until it changes
}

// Start watching. Wraps window.fetch to sample every request, listens to online/offline, and repaints the
// banner only when the state actually changes. Idempotent — calling twice is a no-op.
export function startWatch(win = (typeof window !== 'undefined' ? window : null)) {
  if (_started || !win || typeof win.fetch !== 'function') return;
  _started = true;
  const now = () => (win.performance && win.performance.now ? win.performance.now() : new Date().getTime());
  let state = { online: win.navigator ? win.navigator.onLine !== false : true, recent: [] };
  let shown = null;
  const refresh = () => { const s = netHealth(state); _ui = uiStatus(s); paintDots(); if (s !== shown) { shown = s; paint(s); } };

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

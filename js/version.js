// version.js — build-version awareness. Every module is loaded as `<file>.js?v=<sha>` (the cachebust bot
// stamps the commit sha). A module can read its OWN sha from import.meta.url, and compare it to the sha the
// LIVE html currently references — if they differ, the browser is running a stale cached bundle and the user
// should refresh. Pure string helpers (unit-tested); the fetch + the nudge UI live in the portals.

// Pull the `?v=<sha>` cachebust off a URL (e.g. import.meta.url). '' when absent.
export function parseVersion(url) {
  const m = /[?&]v=([^&#]+)/.exec(url || '');
  return m ? m[1] : '';
}

// Find the deployed `<bundle>?v=<sha>` a freshly-fetched HTML page references (e.g. bundle 'advisor.js').
// '' when the page doesn't reference it (or couldn't be read).
export function latestFromHtml(html, bundle) {
  const re = new RegExp(bundle.replace(/[.]/g, '\\.') + '\\?v=([^"&\\s#]+)');
  const m = re.exec(html || '');
  return m ? m[1] : '';
}

// Stale only when we know BOTH our sha and the deployed sha and they differ — never nag on uncertainty.
export function isStale(current, latest) {
  return !!(current && latest && current !== latest);
}

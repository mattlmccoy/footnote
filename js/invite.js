// Magic-link helpers for the reviewer portal. The invite email's link carries the access key as ?k=<key>
// so a reviewer just clicks — no token to copy/paste. On boot the portal reads the key, stores it, and
// strips it from the URL (so the token isn't left in the address bar or shared by copying the URL).
// Pure functions — unit-tested; no I/O.

// Extract the access key from a URL query string ('' if absent/blank).
export function keyFromSearch(search) {
  const k = new URLSearchParams(search || '').get('k');
  return (k || '').trim();
}

// Return the query string with the key (?k=) removed, preserving every other param and leading '?'.
// Used to scrub the token out of location after it's been stored.
export function searchWithoutKey(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('k')) return search || '';
  p.delete('k');
  const s = p.toString();
  return s ? `?${s}` : '';
}

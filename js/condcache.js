// Conditional-request cache for the GitHub REST reads that run in a loop (the repo tree + JSON files).
//
// GitHub answers a request carrying If-None-Match with 304 Not Modified when the resource is unchanged,
// and a 304 does NOT count against the REST rate limit. Every read still goes to GitHub and still
// revalidates, so freshness is exactly what it was before — only the quota cost changes. Nothing is ever
// served without GitHub confirming it is current, so this cannot show stale comments or stale state.
//
// In-memory only (per page session): nothing is persisted, so a reload always starts from the network.
// Payloads are stored as text/strings and re-parsed by the caller on every hit, so a caller that mutates
// what it got back can never corrupt the next read.

const _store = new Map();   // stable url -> { etag, payload }
let _owner;                 // token the cache was populated under
let _scoped = false;

export function condReset(){ _store.clear(); _owner = undefined; _scoped = false; }

// A different token may be a different account: drop everything rather than risk serving its data.
export function condScope(tok){
  if (_scoped && tok === _owner) return;
  if (_scoped) _store.clear();
  _owner = tok; _scoped = true;
}

export function condGet(url){ return _store.get(url) || null; }

// Returns a NEW header object (never mutates the caller's) with the validator attached when we hold one.
export function condHeaders(url, base){
  const hit = _store.get(url);
  return hit && hit.etag ? { ...base, 'If-None-Match': hit.etag } : { ...base };
}

export function condPut(url, etag, payload){
  if (!etag){ _store.delete(url); return; }   // no validator -> unrevalidatable -> refuse to cache it
  _store.set(url, { etag, payload });
}

export function condDrop(url){ _store.delete(url); }
export function condDropAll(){ _store.clear(); }
export function condSize(){ return _store.size; }

// Conditional GitHub readers, shared by both portals. Thin wrappers over condcache.js that add
// If-None-Match to a read and replay the cached payload on 304 — which costs no rate limit, and matters
// doubly here because the REST limit is per USER: every reviewer polls with the owner's shared key.
//
// Freshness is unchanged. Every call still goes to GitHub; a 304 is GitHub confirming the bytes are
// current, so a reviewer can never be shown a stale comment thread.
//
// Term-neutral by construction, so the reviewer portal can import it without breaking its clean gate.

import { condScope, condHeaders, condGet, condPut, condDrop } from './condcache.js?v=f5d7c87';
import { observeBudget } from './ratebudget.js?v=dbe477a';   // every response reports the remaining hourly budget — 304s included

const _f = impl => impl || fetch;
// Errors must stay classifiable by nethelpers.classifyGitHubError and advisor's is401, which regex-matches
// the status out of the MESSAGE — so keep the "<ctx> <status>" shape and carry .status/.headers.
const _err = (r, ctx) => { const e = new Error((ctx || 'GitHub') + ' ' + r.status); e.status = r.status; e.headers = r.headers; return e; };

// GitHub contents API (base64-wrapped JSON). Returns { json, sha }; { json:null, sha:null } on 404.
// The decoded TEXT is what gets cached, and it is re-parsed on every hit, so a caller that mutates a
// previous result cannot corrupt the next read.
export async function condJson(url, { headers = {}, token, fetchImpl, ctx, _retried } = {}){
  condScope(token);
  const r = await _f(fetchImpl)(url, { headers: condHeaders(url, headers), cache: 'no-store' });
  observeBudget(r.headers);
  if (r.status === 304){
    const hit = condGet(url);
    if (hit) return { json: JSON.parse(hit.payload.text), sha: hit.payload.sha };
    condDrop(url);                                        // validator desync: read it unconditionally once
    if (!_retried) return condJson(url, { headers, token, fetchImpl, ctx, _retried: true });
    throw _err(r, ctx);
  }
  if (r.status === 404){ condDrop(url); return { json: null, sha: null }; }
  if (!r.ok) throw _err(r, ctx);
  const d = await r.json();
  if (typeof d.content !== 'string' || !d.content.trim()) throw new Error('empty content');
  const text = decodeURIComponent(escape(atob(d.content.replace(/\s/g, ''))));   // GitHub wraps base64 in newlines
  condPut(url, r.headers.get('etag'), { text, sha: d.sha });
  return { json: JSON.parse(text), sha: d.sha };
}

// Raw file read (Accept: vnd.github.raw). Reports failure as { ok:false, status } rather than throwing,
// matching how the reviewer portal's raw reads are already written.
export async function condRaw(url, { headers = {}, token, fetchImpl, _retried } = {}){
  condScope(token);
  const r = await _f(fetchImpl)(url, { headers: condHeaders(url, headers), cache: 'no-store' });
  observeBudget(r.headers);
  if (r.status === 304){
    const hit = condGet(url);
    if (hit) return { ok: true, status: 200, text: hit.payload, fromCache: true };
    condDrop(url);
    if (!_retried) return condRaw(url, { headers, token, fetchImpl, _retried: true });
    return { ok: false, status: 304, text: null };
  }
  if (!r.ok) return { ok: false, status: r.status, text: null };
  const text = await r.text();
  condPut(url, r.headers.get('etag'), text);
  return { ok: true, status: r.status, text, fromCache: false };
}

// Generic conditional JSON read for arbitrary API endpoints (the diagnostics collector). Unlike condJson
// this does NOT decode a base64 contents wrapper — it returns the endpoint's own JSON body.
// `noCache` opts a URL out of validators entirely: /rate_limit reports the live budget, and serving that
// from a 304 would freeze the very number the page exists to show.
export async function condApi(url, { headers = {}, token, fetchImpl, noCache = false, _retried } = {}){
  condScope(token);
  const h = noCache ? { ...headers } : condHeaders(url, headers);
  const r = await _f(fetchImpl)(url, { headers: h, cache: 'no-store' });
  observeBudget(r.headers);
  if (r.status === 304 && !noCache){
    const hit = condGet(url);
    if (hit) return { ok: true, status: 200, headers: r.headers, json: JSON.parse(hit.payload), fromCache: true };
    condDrop(url);
    if (!_retried) return condApi(url, { headers, token, fetchImpl, noCache, _retried: true });
    return { ok: false, status: 304, headers: r.headers, json: null };
  }
  if (!r.ok) return { ok: false, status: r.status, headers: r.headers, json: null };
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  // cached as a STRING and re-parsed per hit, so a caller mutating one result can't corrupt the next
  if (!noCache && json !== null) condPut(url, r.headers.get('etag'), JSON.stringify(json));
  return { ok: true, status: r.status, headers: r.headers, json, fromCache: false };
}

// After a write, drop the entry so the next read refetches rather than revalidating a known-stale token.
export { condDrop as condInvalidate };

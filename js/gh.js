import { getConfig, dataRepoParts, dataPath } from './config.js?v=f58d6b0';
import { fetchWithTimeout } from './nethelpers.js?v=a764ebc';
import { condScope, condHeaders, condGet, condPut, condDrop } from './condcache.js?v=f5d7c87';
// Every GitHub request is bounded (timeout + one transport retry) so a hung request can't hang the app,
// and non-ok responses throw an error carrying .status + .headers so callers can classify rate limits.
const gfetch = (url, opts) => fetchWithTimeout(url, opts, { timeoutMs:15000, retries:1 });
const ghErr = (r, ctx) => { const e = new Error('GitHub '+(ctx?ctx+' ':'')+r.status); e.status = r.status; e.headers = r.headers; return e; };
export const reviewPath = ch => `reviews/${ch}.json`;
export const mergeReview = (local, remote) => {
  if (!remote) return local;
  const deleted = new Set([ ...((local.deleted)||[]), ...((remote.deleted)||[]) ]);   // tombstones: never resurrect a deleted comment
  const byId = Object.fromEntries((remote.comments||[]).map(c=>[c.id,c]));
  const comments = (local.comments||[]).filter(lc => !deleted.has(lc.id)).map(lc => { const rc = byId[lc.id];
    return rc ? { ...lc, status:rc.status, claude:rc.claude, staged_edit:rc.staged_edit, resolution:rc.resolution } : lc; });
  // include remote-only comments (e.g. created on another machine), but not ones tombstoned on either side
  for (const rc of remote.comments||[]) if (!deleted.has(rc.id) && !comments.find(c=>c.id===rc.id)) comments.push(rc);
  // read-state is app-owned; union so a section checked on any device stays checked
  const read = { ...(remote.read||{}), ...(local.read||{}) };
  return { ...remote, ...local, comments, read, secCount: local.secCount || remote.secCount, ...(deleted.size?{deleted:[...deleted]}:{}) };
};
const API='https://api.github.com';
// data repo is read from footnote.config.json (loaded once at boot), not hardcoded.
const slug = () => { const { owner, repo } = dataRepoParts(getConfig()); return `${owner}/${repo}`; };
// Project path prefix into the data repo: '' (legacy, root) or '<id>/' (workspace repo, one repo many projects).
const dp = path => dataPath(getConfig(), path);
const hdr = tok => ({ Authorization:`Bearer ${tok}`, Accept:'application/vnd.github+json' });
// one call to list every file path in the data repo (so the inbox only fetches files that exist). In
// workspace mode the tree holds every project's files, so filter to this project's prefix and strip it —
// callers get the same repo-relative paths (reviews/x.json) whether legacy or workspace.
// Stable URLs (no ?t= buster) so an ETag can key them. `cache:'no-store'` still keeps the BROWSER out of
// the loop — every read reaches GitHub — but we attach our own If-None-Match, so an unchanged resource
// comes back 304 and costs no rate limit. Freshness is unchanged: nothing is served un-revalidated.
const treeUrl = () => `${API}/repos/${slug()}/git/trees/main?recursive=1`;
const contentUrl = path => `${API}/repos/${slug()}/contents/${dp(path)}`;
// A write changes the file AND the repo tree; drop both so the next read re-fetches rather than revalidating
// a token we already know is stale (this is what keeps putJson's 409 retry looking at a current sha).
const invalidate = path => { condDrop(contentUrl(path)); condDrop(treeUrl()); };

export async function ghTree(tok, _retried){
  condScope(tok);
  const url = treeUrl();
  const r = await gfetch(url, { headers: condHeaders(url, hdr(tok)), cache:'no-store' });
  const pfx = getConfig().dataPrefix || '';
  const shape = paths => paths.filter(p => p.startsWith(pfx)).map(p => p.slice(pfx.length));
  if (r.status===304){
    const hit = condGet(url);
    if (hit) return shape(hit.payload);
    condDrop(url);                                        // validator desync: read it unconditionally once
    if (!_retried) return ghTree(tok, true);
    throw ghErr(r, 'tree');
  }
  if (!r.ok) throw ghErr(r, 'tree');
  const d = await r.json();
  const blobs = (d.tree||[]).filter(x => x.type==='blob').map(x => x.path);
  condPut(url, r.headers.get('etag'), blobs);             // cache unfiltered: the prefix is applied per call
  return shape(blobs);
}
export async function getJson(tok, path, _retried){
  condScope(tok);
  const url = contentUrl(path);
  const r = await gfetch(url, { headers: condHeaders(url, hdr(tok)), cache:'no-store' });
  if (r.status===304){
    const hit = condGet(url);
    // re-parse the cached TEXT so a caller that mutated an earlier result can't corrupt this one
    if (hit) return { json: JSON.parse(hit.payload.text), sha: hit.payload.sha };
    condDrop(url);
    if (!_retried) return getJson(tok, path, true);
    throw ghErr(r);
  }
  if (r.status===404){ condDrop(url); return { json:null, sha:null }; }
  if (!r.ok) throw ghErr(r);
  const d = await r.json();
  if (typeof d.content !== 'string' || !d.content.trim()) throw new Error('empty content for '+path);
  const txt = decodeURIComponent(escape(atob(d.content.replace(/\s/g,''))));   // strip GitHub's base64 newlines (atob is strict on some mobile browsers)
  condPut(url, r.headers.get('etag'), { text: txt, sha: d.sha });
  return { json: JSON.parse(txt), sha:d.sha };
}
// binary file helpers (figure markup PNGs): content is already base64 (no JSON wrapping)
export async function getSha(tok, path){
  const r = await gfetch(`${API}/repos/${slug()}/contents/${dp(path)}?t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (r.status===404) return null; if (!r.ok) throw ghErr(r);
  return (await r.json()).sha;
}
export async function putFile(tok, path, base64, msg){
  invalidate(path);
  const put = s => gfetch(`${API}/repos/${slug()}/contents/${dp(path)}`, { method:'PUT', headers:hdr(tok),
    body: JSON.stringify({ message:msg, content:base64, sha:s||undefined }) });
  let r = await put(await getSha(tok, path).catch(() => null));
  if (!r.ok) throw ghErr(r, 'put file');
  invalidate(path);
  return (await r.json()).content.sha;
}
export async function deleteFile(tok, path, msg){
  invalidate(path);
  const sha = await getSha(tok, path).catch(() => null);
  if (!sha) return false;                                  // already gone
  const r = await gfetch(`${API}/repos/${slug()}/contents/${dp(path)}`, { method:'DELETE', headers:hdr(tok),
    body: JSON.stringify({ message:msg, sha }) });
  if (!r.ok) throw ghErr(r, 'delete');
  invalidate(path);
  return true;
}
export async function getDataUrl(tok, path, mime='image/png'){
  const r = await gfetch(`${API}/repos/${slug()}/contents/${dp(path)}?t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (!r.ok) throw ghErr(r);
  const d = await r.json(); return `data:${mime};base64,` + (d.content||'').replace(/\s/g,'');
}
export async function putJson(tok, path, obj, sha, msg, autoRetry=true){
  invalidate(path);
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj,null,2))));
  const put = s => gfetch(`${API}/repos/${slug()}/contents/${dp(path)}`, { method:'PUT', headers:hdr(tok),
    body: JSON.stringify({ message:msg, content, sha:s||undefined }) });
  let r = await put(sha);
  if (r.status === 409 && autoRetry){                      // stale sha (whole-file replace) — refetch + retry once
    try { const cur = await getJson(tok, path); r = await put(cur.sha); } catch(e){}
  }
  if (!r.ok) throw ghErr(r, 'put');
  invalidate(path);          // re-drop: a concurrent read may have re-cached the pre-write content
  return (await r.json()).content.sha;
}

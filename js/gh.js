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
const API='https://api.github.com', OWNER='mattlmccoy', REPO='dissertation-tracker-data';
const hdr = tok => ({ Authorization:`Bearer ${tok}`, Accept:'application/vnd.github+json' });
// one call to list every file path in the data repo (so the inbox only fetches files that exist)
export async function ghTree(tok){
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/git/trees/main?recursive=1&t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (!r.ok) throw new Error('GitHub tree '+r.status);
  const d = await r.json(); return (d.tree||[]).filter(x => x.type==='blob').map(x => x.path);
}
export async function getJson(tok, path){
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}?t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (r.status===404) return { json:null, sha:null };
  if (!r.ok) throw new Error('GitHub '+r.status);
  const d = await r.json();
  if (typeof d.content !== 'string' || !d.content.trim()) throw new Error('empty content for '+path);
  const txt = decodeURIComponent(escape(atob(d.content.replace(/\s/g,''))));   // strip GitHub's base64 newlines (atob is strict on some mobile browsers)
  return { json: JSON.parse(txt), sha:d.sha };
}
// binary file helpers (figure markup PNGs): content is already base64 (no JSON wrapping)
export async function getSha(tok, path){
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}?t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (r.status===404) return null; if (!r.ok) throw new Error('GitHub '+r.status);
  return (await r.json()).sha;
}
export async function putFile(tok, path, base64, msg){
  const put = s => fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, { method:'PUT', headers:hdr(tok),
    body: JSON.stringify({ message:msg, content:base64, sha:s||undefined }) });
  let r = await put(await getSha(tok, path).catch(() => null));
  if (!r.ok) throw new Error('github put file failed: '+r.status);
  return (await r.json()).content.sha;
}
export async function deleteFile(tok, path, msg){
  const sha = await getSha(tok, path).catch(() => null);
  if (!sha) return false;                                  // already gone
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, { method:'DELETE', headers:hdr(tok),
    body: JSON.stringify({ message:msg, sha }) });
  if (!r.ok) throw new Error('github delete failed: '+r.status);
  return true;
}
export async function getDataUrl(tok, path, mime='image/png'){
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}?t=${Date.now()}`, { headers:hdr(tok), cache:'no-store' });
  if (!r.ok) throw new Error('GitHub '+r.status);
  const d = await r.json(); return `data:${mime};base64,` + (d.content||'').replace(/\s/g,'');
}
export async function putJson(tok, path, obj, sha, msg, autoRetry=true){
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj,null,2))));
  const put = s => fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, { method:'PUT', headers:hdr(tok),
    body: JSON.stringify({ message:msg, content, sha:s||undefined }) });
  let r = await put(sha);
  if (r.status === 409 && autoRetry){                      // stale sha (whole-file replace) — refetch + retry once
    try { const cur = await getJson(tok, path); r = await put(cur.sha); } catch(e){}
  }
  if (!r.ok) throw new Error('github put failed: '+r.status); return (await r.json()).content.sha;
}

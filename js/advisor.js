// advisor.js — reviewer portal for a single named reviewer. Shows only the chapters released to
// them, lets them comment on text and figures and propose exact edits, and submits those back
// privately. Self-contained (only the anchor helper is shared) — no build tooling of any kind.
import { anchorFromSelection } from './anchor.js?v=b9529aa';
import { startTour, tourSeen, markTourSeen } from './tour.js?v=b9529aa';
import { wordDiff } from './textdiff.js';

// A sample chapter shown ONLY during the tour, so the reading + commenting features have real-looking
// content to point at even before any real chapter is released. Restored when the tour ends. The tour
// only spotlights and explains — nothing here is ever sent or saved.
function loadDemoChapter(){
  const el = document.getElementById('read'); if (!el) return () => {};
  const wasReading = !!document.querySelector('#doc');   // was a real chapter open before the demo?
  const cmt = document.getElementById('comments');
  const fig = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="520" height="200"><rect width="520" height="200" fill="#e9e7e1"/><text x="260" y="106" font-family="sans-serif" font-size="16" fill="#8f8d84" text-anchor="middle">Sample figure</text></svg>');
  el.innerHTML = `<article id="doc">
    <h1>Chapter 3 · Sample (tour preview)</h1>
    <p id="tour-demo-select">This preview chapter shows how reviewing works. Lorem ipsum dolor sit amet, consectetur adipiscing elit; radio-frequency heating enables rapid, volumetric energy delivery through a dielectric medium. Select any words here to attach a comment.</p>
    <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.</p>
    <figure><img alt="Sample figure" src="${fig}"><figcaption>Figure 3.1. A sample figure — click it to comment on the figure itself.</figcaption></figure>
    <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
    <table><caption>Table 3.1. Sample results.</caption><thead><tr><th>Case</th><th>Value</th></tr></thead>
      <tbody><tr><td>Baseline</td><td>12.4</td></tr><tr><td>Compensated</td><td>4.1</td></tr></tbody></table>
    <p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam.</p></article>`;
  try { wireFigures(document.getElementById('doc')); } catch {}   // make the sample figure clickable
  if (cmt){                                                        // show a sample note + a submit button
    cmt.style.display = '';
    cmt.innerHTML = `<div class="lbl">MY COMMENTS<span style="margin-left:auto">1 active</span></div>
      <div id="tour-demo-note" style="border:.5px solid var(--border);border-radius:9px;padding:10px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-3)">§ Chapter 3 · on "reviewing works"</div>
        <div style="font-size:13px;margin:5px 0 7px;color:var(--text)">Consider clarifying this sentence for a general reader.</div>
        <span class="chip" style="background:var(--wording-bg);color:var(--wording)">wording</span></div>
      `;
  }
  // Teardown must RE-RENDER the real view (not paste back innerHTML) — restoring an HTML string
  // creates fresh nodes with no event handlers, leaving the page looking right but unclickable.
  return () => { if (wasReading && current) loadChapter(current); else enterHome(); };
}
// First-run walkthrough of the whole review pipeline, on interactive demo content. Spotlight-explain;
// the demo is live so text-select and figure-click actually work, but nothing is sent or saved.
const ADVISOR_TOUR = [
  { sel:'#nav', title:'Released chapters', body:'The chapters the author shared with you. Click one to open it. (We loaded a sample chapter so you can see the rest of the tour.)' },
  { sel:'#doc h1', title:'The reading view', body:'Chapters open on a clean, distraction-free page. Read top to bottom.' },
  { sel:'#tour-demo-select', title:'Comment on text', body:'Select a few of these words and a box pops up to type your note, pick a tag, and save. It attaches exactly there, private to the author.', pin:'bl' },
  { sel:'#doc figure', title:'Comment on a figure', body:'Click the sample figure to comment on it, and you can even draw a box or circle to point at the issue.', pin:'bl' },
  { sel:'#doc table', title:'Everything is reviewable', body:'Tables, equations, and figures can all be commented on, not just paragraphs.' },
  { sel:'#tour-demo-note', title:'Your notes', body:'Every note you leave collects here (this one is a sample). In a note you can also propose exact replacement wording for the author to accept in one click.' },
  { sel:'#tour-demo-note', title:'Shared instantly', body:'Every comment is shared with the author the moment you add it. There is no submit step, and you can edit or delete any comment afterward. Their replies appear here automatically.' },
  { sel:'#adv-tour-btn', title:'Replay anytime', body:'Reopen this tour whenever you like with the ? button.' },
];
function launchAdvisorTour(){ const restore = loadDemoChapter(); startTour(ADVISOR_TOUR, { storageKey:'tour-advisor-v1', onDone: restore }); }
// Short walkthrough of commenting on the proposed outline (auto-launches once the first time the outline opens).
const ADVISOR_OUTLINE_TOUR = [
  { sel:'.ol-chapter', title:'The proposed structure', body:'This is the author\'s planned outline. Click a chapter to expand its sections and subsections.' },
  { sel:'.ol-cmt', title:'Comment on any part', body:'Use the comment button on any chapter, section, or subsection to weigh in on the structure before the full chapters arrive.' },
];
function launchAdvisorOutlineTour(){ startTour(ADVISOR_OUTLINE_TOUR, { storageKey:'tour-advisor-outline-v1' }); }

// --- comment model (self-contained) ---
let _seq = 0; const nid = () => `c_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
const newReview = chapter => ({ chapter, cursor:null, comments:[] });
const addComment = (r, c) => ({ ...r, comments:[...r.comments, {
  id:nid(), kind:c.kind||'text',
  anchor:{ quote:c.anchor?.quote||'', rects:c.anchor?.rects||[], section:c.anchor?.section||'', figure:c.anchor?.figure||null, confirmed:!!c.anchor?.confirmed },
  tag:c.tag||'other', body:c.body||'', status:'open', author:c.author||null, edit:c.edit||null, created_ts:new Date().toISOString() }] });
const updateComment = (r, id, patch) => ({ ...r, comments:r.comments.map(c => c.id===id ? { ...c, ...patch } : c) });
const deleteComment = (r, id) => ({ ...r, comments:r.comments.filter(c => c.id!==id), deleted:[...new Set([...(r.deleted||[]), id])] });
// --- data-repo I/O (self-contained) ---
const _API='https://api.github.com', _OWNER='mattlmccoy', _REPO='dissertation-tracker-data';
const _hdr = t => ({ Authorization:`Bearer ${t}`, Accept:'application/vnd.github+json' });
async function getJson(t, path){ const r=await fetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${path}?t=${Date.now()}`,{headers:_hdr(t),cache:'no-store'}); if(r.status===404) return {json:null,sha:null}; if(!r.ok) throw new Error('GitHub '+r.status); const d=await r.json(); if(typeof d.content!=='string'||!d.content.trim()) throw new Error('empty content'); return {json:JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g,''))))),sha:d.sha}; }
async function putJson(t, path, obj, sha, msg, autoRetry=true){ const content=btoa(unescape(encodeURIComponent(JSON.stringify(obj,null,2)))); const put=s=>fetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${path}`,{method:'PUT',headers:_hdr(t),body:JSON.stringify({message:msg,content,sha:s||undefined})}); let r=await put(sha); if(r.status===409&&autoRetry){ try{ const cur=await getJson(t,path); r=await put(cur.sha); }catch(e){} } if(!r.ok) throw new Error('put failed: '+r.status); return (await r.json()).content.sha; }
// binary file I/O (PNG markups) — self-contained, mirrors the JSON helpers above
async function _getSha(t, path){ try{ const r=await fetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${path}?t=${Date.now()}`,{headers:_hdr(t),cache:'no-store'}); if(!r.ok) return null; return (await r.json()).sha; }catch(e){ return null; } }
async function putFile(t, path, base64, msg){ const put=s=>fetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${path}`,{method:'PUT',headers:_hdr(t),body:JSON.stringify({message:msg,content:base64,sha:s||undefined})}); const r=await put(await _getSha(t,path)); if(!r.ok) throw new Error('put file failed: '+r.status); return (await r.json()).content.sha; }
async function getDataUrl(t, path, mime='image/png'){ const r=await fetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${path}?t=${Date.now()}`,{headers:_hdr(t),cache:'no-store'}); if(!r.ok) throw new Error('GitHub '+r.status); const d=await r.json(); return `data:${mime};base64,`+(d.content||'').replace(/\s/g,''); }
// merge two reviews of the SAME reviewer file without losing anything: union comments by id;
// remote wins owner-authoritative fields, local wins reviewer-authoritative fields; thread merged by (author,ts).
function mergeReviews(remote, local){
  const out = { ...(remote||{}), ...(local||{}) };
  // deletion tombstones: an id deleted on either side stays deleted — never resurrected by the merge
  const deleted = new Set([ ...((remote&&remote.deleted)||[]), ...((local&&local.deleted)||[]) ]);
  const FINAL = new Set(['merged','declined','answered']);   // owner-finalized states a stale local copy must never downgrade
  const rById = Object.fromEntries(((remote&&remote.comments)||[]).map(c=>[c.id,c]));
  const lById = Object.fromEntries(((local&&local.comments)||[]).map(c=>[c.id,c]));
  const ids = [...new Set([...Object.keys(rById), ...Object.keys(lById)])].filter(id => !deleted.has(id));
  out.comments = ids.map(id => {
    const r = rById[id], l = lById[id];
    if (r && !l) return r;                 // owner-only (e.g. injected) — keep
    if (l && !r) return l;                 // new local comment not yet pushed — NEVER drop
    const thread = [];                     // union threads by (author,ts)
    const seen = new Set();
    for (const m of [...(r.thread||[]), ...(l.thread||[])]){ const k = (m.author||'')+'|'+(m.ts||''); if (!seen.has(k)){ seen.add(k); thread.push(m); } }
    return { ...r,                         // remote base → owner fields (resolution, read, sent, advisor_state, reopened) win
      body:l.body, edit:l.edit, status:(FINAL.has(r.status)&&!FINAL.has(l.status))?r.status:l.status, anchor:l.anchor, kind:l.kind, tag:l.tag, author:l.author, created_ts:l.created_ts||r.created_ts,
      ...(thread.length?{thread}:{}) };
  });
  if (deleted.size) out.deleted = [...deleted]; else delete out.deleted;  // persist tombstones so deletes survive future syncs
  const la=[out.last_active, remote&&remote.last_active, local&&local.last_active].filter(Boolean).sort().pop(); if(la) out.last_active=la;   // keep the most recent activity stamp
  delete out.pending;                      // pending is a local-only marker, never written to the remote payload
  return out;
}

const ADVISOR = window.ADVISOR || { id: '?', name: 'Reviewer' };
// shared "general/lab" portal: many people use one link, each gets a per-person comment file
const SHARED = !!ADVISOR.shared;
const reviewerName = () => localStorage.getItem('reviewerName') || '';
function ensureReviewerId(){
  let id = localStorage.getItem('reviewerId');
  if (!id){ const base = (reviewerName()||'guest').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,20) || 'guest';
    id = 'general-' + base + '-' + Math.random().toString(36).slice(2,6); localStorage.setItem('reviewerId', id); }
  return id;
}
const effId = () => SHARED ? (localStorage.getItem('reviewerId') || ADVISOR.id) : ADVISOR.id;   // per-person file id
const RELEASE_ID = SHARED ? 'general' : ADVISOR.id;                                              // shared gate
const authorId = () => SHARED ? (reviewerName() || 'Lab reviewer') : ADVISOR.id;                // comment attribution
const displayName = () => SHARED ? (reviewerName() || ADVISOR.name) : ADVISOR.name;
const DATA_REPO = 'mattlmccoy/dissertation-tracker-data';
const CHAPTERS = [
  { id:'ch_introduction', n:1, title:'Introduction' },
  { id:'ch_background',   n:2, title:'Background: RF Dielectric Heating and Prior RFAM' },
  { id:'ch_platform',     n:3, title:'Design and Characterization of a Custom RFAM Platform' },
  { id:'ch_modeling',     n:4, title:'Computational Modeling of RF Sintering' },
  { id:'ch_compensation', n:5, title:'Simulation-Guided Compensation' },
  { id:'ch_validation',   n:6, title:'Experimental Validation' },
  { id:'ch_design_guide', n:7, title:'Design for RFAM: A Physics-Derived Capability Envelope' },
  { id:'ch_materials',    n:8, title:'Extensibility of RF in Advanced Manufacturing' },
  { id:'ch_conclusions',  n:9, title:'Conclusions' },
];
const chMeta = id => CHAPTERS.find(c => c.id === id) || (id === '__outline__' ? { n:'·', title:'Proposed outline' } : { n:'?', title:id });
const TAGS = ['suggestion','wording','figure','question','clarity','citation'];
const shortTitle = t => { const s = t.split(':')[0].trim(); return s.length <= 34 ? s : s.slice(0,34).replace(/\s\S*$/,'') + '…'; };
const escapeHtml = s => (s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
// platform-adaptive modifier label (handlers accept ⌘ or Ctrl; this is just the on-screen text)
const IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const fmtDate = ts => { if(!ts) return ''; const d=new Date(ts); if(isNaN(d)) return ''; return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };

const read = document.getElementById('read');
let current = null, review = null, released = [], responsesReleased = false;
const tok = () => localStorage.getItem('ghpat');
let keyBad = false, revoked = false;
const is401 = e => /\b401\b/.test((e && e.message) || '');
function showKeyExpired(){
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">Dissertation review · ${escapeHtml(ADVISOR.name)}</strong>`;
  read.innerHTML = `<div class="empty"><i class="ti ti-key-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Your access key has expired</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px;max-width:430px">Access keys are time-limited for security. Please request a fresh key, then enter it below to pick up where you left off — your comments are saved.</div>
    <button class="btn btn-primary" id="newkey">Enter a new key</button></div>`;
  read.querySelector('#newkey').onclick = () => { const v = prompt('New access key:'); if (v && v.trim()){ localStorage.setItem('ghpat', v.trim()); keyBad = false; boot(); } };
}
function showRevoked(){
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">Dissertation review</strong>`;
  read.innerHTML = `<div class="empty" style="max-width:460px;margin:12vh auto;text-align:center"><i class="ti ti-lock-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">This review link is no longer active</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-3)">Access for this reviewer has been removed by the author. If you think this is a mistake, please contact them for a new invitation.</div></div>`;
}
const reviewPath = ch => `advisor/${effId()}/${ch}.json`;
const localKey = ch => `adv:${effId()}:${ch}`;
const loadLocal = ch => JSON.parse(localStorage.getItem(localKey(ch)) || 'null') || newReview(ch, '');
const save = () => localStorage.setItem(localKey(current), JSON.stringify(review));
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');

// ---------- sync (this reviewer's own comment file only) ----------
let reviewSha = null, syncTimer = null;
async function syncDown(){ const t = tok(); if (!t) return;
  try { const { json, sha } = await getJson(t, reviewPath(current)); reviewSha = sha;
    if (json){ const rById = Object.fromEntries((json.comments||[]).map(c=>[c.id,c]));
      // honor deletion tombstones from both sides so a deleted comment is never pulled back in
      const deleted = new Set([ ...((review.deleted)||[]), ...((json.deleted)||[]) ]);
      if (deleted.size) review.deleted = [...deleted];
      // keep this reviewer's own body/edit/status; pull in the author's resolution from the remote file
      // adopt owner-authoritative fields from the remote so owner replies (thread), read-state, and
      // send-state show in the main comment rail too — not only in the Responses view
      review.comments = review.comments.filter(lc => !deleted.has(lc.id)).map(lc => { const rc = rById[lc.id]; return rc ? { ...lc, resolution: rc.resolution || lc.resolution, thread: rc.thread || lc.thread, read: rc.read ?? lc.read, sent: rc.sent ?? lc.sent } : lc; });
      (json.comments||[]).forEach(rc => { if (!deleted.has(rc.id) && !review.comments.find(c=>c.id===rc.id)) review.comments.push(rc); });
      save(); renderComments(); if (document.getElementById('doc')) paintHighlights(); } }
  catch(e){ /* first time / offline */ } }
// Live polling: re-pull the author's replies/resolutions on a cadence + when the tab refocuses.
// Guard: skip the poll while the reviewer is mid-write (a comment popover is open, or a textarea in the
// comment area has focus) so a re-render never yanks their cursor. Data is already merge-safe in syncDown.
let livePollTimer = null;
function isAdvisorBusy(){
  if (typeof pending !== 'undefined' && pending) return true;
  const a = document.activeElement;
  return !!(a && a.tagName === 'TEXTAREA');
}
function livePoll(){ if (!tok() || document.hidden || isAdvisorBusy()) return; syncDown(); }
function startLiveSync(){ stopLiveSync(); livePollTimer = setInterval(livePoll, 20000); }
function stopLiveSync(){ if (livePollTimer){ clearInterval(livePollTimer); livePollTimer = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) livePoll(); });
// a local mutation isn't safe until confirmed on GitHub — flag it, persist, and schedule a push
// the "unsaved" banner is driven purely by sync OUTCOME — syncUp clears it on a confirmed PUT
// and raises it on a real failure, and the 30s heartbeat surfaces genuinely-stuck chapters.
// markDirty never shows it, so a normal (even slow) save never flashes a warning.
function markDirty(){ review.pending = true; review.last_active = new Date().toISOString(); save(); syncUpSoon(); }
function syncUpSoon(){ if (!tok()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncUp(), 1200); }
// read-modify-merge push: returns true only when GitHub confirms (2xx). Never clobbers owner edits.
async function syncUp(){ const t = tok(); if (!t) return false;
  const path = reviewPath(current), label = effId();
  for (let attempt = 0; attempt < 5; attempt++){
    let remote = null, sha = reviewSha;
    try { const g = await getJson(t, path); remote = g.json; sha = g.sha; }
    catch(e){ if (is401(e)){ keyBad = true; renderBanner(); return false; }
      /* non-401 (404 / empty / corrupt remote): don't reuse a stale sha — refetch the real one so the PUT can overwrite */
      sha = await _getSha(t, path); }
    const merged = mergeReviews(remote, review);
    try { reviewSha = await putJson(t, path, merged, sha, `review(${label}): ${current}`, false);
      merged.pending = false; review = merged; save(); renderBanner(); return true; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r => setTimeout(r, 250*(attempt+1))); continue; } renderBanner(); return false; }
  }
  renderBanner(); return false;
}
// ---------- durable outbox: any chapter with unconfirmed local edits gets retried until it lands ----------
function pendingChapters(){ const out = []; const pre = `adv:${effId()}:`;
  for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (!k || !k.startsWith(pre)) continue;
    try { const r = JSON.parse(localStorage.getItem(k) || 'null'); if (r && r.pending) out.push(k.slice(pre.length)); } catch(e){} }
  return out; }
async function retryPending(){ const t = tok(); if (!t) return; const chs = pendingChapters(); if (!chs.length) return;
  for (const ch of chs){
    if (ch === current){ await syncUp(); continue; }                 // active chapter: merge against the live object
    const path = `advisor/${effId()}/${ch}.json`; const lk = `adv:${effId()}:${ch}`;
    let local = null; try { local = JSON.parse(localStorage.getItem(lk) || 'null'); } catch(e){} if (!local) continue;
    try { let remote = null, sha = null; try { const g = await getJson(t, path); remote = g.json; sha = g.sha; } catch(e){ if (is401(e)){ keyBad = true; break; } }
      const merged = mergeReviews(remote, local);
      await putJson(t, path, merged, sha, `review(${effId()}): ${ch} (retry)`, false);
      merged.pending = false; localStorage.setItem(lk, JSON.stringify(merged)); }
    catch(e){ /* stays pending; next tick retries */ }
  }
  renderBanner();
}
function renderBanner(){
  let el = document.getElementById('syncbanner');
  const chs = pendingChapters();
  if (keyBad || !chs.length){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'syncbanner'; document.body.appendChild(el); }
  const n = chs.length;
  el.innerHTML = `<i class="ti ti-cloud-up"></i><span>${n} chapter${n>1?'s have':' has'} comments not yet saved to the server — keep this browser open.</span><button id="syncretry">Retry now</button>`;
  el.querySelector('#syncretry').onclick = () => { el.querySelector('#syncretry').textContent = 'Retrying…'; retryPending(); };
}

// ---------- release gate + content ----------
async function loadRelease(){
  const t = tok();
  if (location.hostname==='localhost'||location.hostname==='127.0.0.1'){ try { const r=await fetch('./release.json'); if(r.ok){ apply(await r.json()); return; } } catch(e){} }
  if (!t){ released = []; return; }
  try { const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/release.json?t=${Date.now()}`,{ headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (r.status === 401){ keyBad = true; return; }
    if (r.ok) apply(await r.json()); } catch(e){ released = []; }
  function apply(j){ if (j && typeof j === 'object' && !(RELEASE_ID in j)){ revoked = true; return; }   // no gate entry → this reviewer was removed
    released = (j?.[RELEASE_ID]?.released) || []; responsesReleased = !!(j?.[RELEASE_ID]?.responses_released); }
}
function doRefresh(){ try{ sessionStorage.setItem('_resume', current||''); }catch(e){} const u = new URL(location.href); u.searchParams.set('_r', Date.now()); location.replace(u.toString()); }   // reload for a fresh deploy, keeping your place
async function loadChapter(ch){
  if (ch === '__outline__'){ loadOutline(); return; }   // the outline isn't a real chapter
  current = ch; review = loadLocal(ch);
  read.innerHTML = `<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading Chapter ${chMeta(ch).n}…</div></div>`;
  document.getElementById('nav').style.display=''; document.getElementById('comments').style.display='';
  renderTopbar(); renderComments();
  const dev = location.hostname==='localhost'||location.hostname==='127.0.0.1';
  if (dev){ try { const r=await fetch(`./chapters/${ch}.html`); if(r.ok){ renderDoc(await r.text()); return; } } catch(e){} }
  const t = tok(); if (!t){ renderConnect(); return; }
  try { const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/content/${ch}.html?t=${Date.now()}`,{ headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (!r.ok) throw new Error('HTTP '+r.status); renderDoc(await r.text()); }
  catch(e){ if (is401(e)) return showKeyExpired();
    read.innerHTML = `<div class="empty">Couldn't load Chapter ${chMeta(ch).n} (${e.message}). Check your access link.</div>`; }
}
function renderConnect(){
  read.innerHTML = `<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Enter your access key</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Paste the access key you were emailed. It's stored only in this browser.</div>
    <button class="btn" id="connect">Add access key</button></div>`;
  document.getElementById('connect').onclick = () => { const v = prompt('Access key:'); if (v){ localStorage.setItem('ghpat', v.trim()); boot(); } };
}

// ---------- document rendering (math, footnotes, figures, cross-refs) ----------
function renderDoc(fragment){
  read.innerHTML = `<article id="doc">${fragment}</article>`;
  const doc = document.getElementById('doc');
  fixFootnotes(doc); runKatex(doc); wireFigures(doc); wireCitations(doc); linkCrossRefs(doc); buildNav(); markWhatsNew(doc); paintHighlights();
  if (review.cursor?.sec) document.getElementById(review.cursor.sec)?.scrollIntoView();
  syncDown(); startLiveSync();
  if (pendingJump){ const q=pendingJump; pendingJump=null; let tries=14;
    const tick=()=>{ const el=(document.getElementById('doc')?locateAnchor({anchor:{quote:q}}):null);
      if(el){ scrollFlash(el); return; } if(tries-->0) setTimeout(tick,280); };
    tick(); }
}
// "what changed since you last looked": per-section content fingerprint, compared to the last visit
function _hash(s){ let h = 0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) | 0; return h; }
function sectionText(h){
  let txt = h.textContent; let el = h.nextElementSibling;
  while (el && !/^H[1-3]$/.test(el.tagName)){ txt += ' ' + el.textContent; el = el.nextElementSibling; }
  return txt.replace(/\s+/g,' ').trim();
}
function sectionSig(doc){
  return [...doc.querySelectorAll('h2, h3')].map(h => { const x = sectionText(h); return { t:h.textContent.trim(), h:_hash(x), x }; });
}
// Wrap the words the author ADDED/changed in this section (per the word-diff) in <mark class="wn-add">,
// walking the section's text nodes in order. Uses the diff only for the added flags; renders the DOM's
// own text so whitespace/inline markup (citations, math) stay intact.
function highlightSection(head, tokens){
  const nodes = []; let wi = 0;
  const collect = root => { const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let t; while ((t = tw.nextNode())) nodes.push(t); };
  collect(head);
  let el = head.nextElementSibling;
  while (el && !/^H[1-3]$/.test(el.tagName)){ collect(el); el = el.nextElementSibling; }
  for (const node of nodes){
    const parts = node.textContent.match(/\s+|\S+/g); if (!parts) continue;   // words AND whitespace runs, preserved
    const frag = document.createDocumentFragment(); let any = false;
    for (const p of parts){
      if (/^\s+$/.test(p)){ frag.appendChild(document.createTextNode(p)); continue; }   // whitespace: pass through, don't consume a diff token
      const tk = tokens[wi++];
      if (tk && tk.added){ const mk = document.createElement('mark'); mk.className = 'wn-add'; mk.textContent = p; frag.appendChild(mk); any = true; }
      else frag.appendChild(document.createTextNode(p)); }
    if (any) node.replaceWith(frag);
  }
}
function markWhatsNew(doc){
  const key = 'seen:'+effId()+':'+current, cur = sectionSig(doc);
  let prev = null; try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){}
  if (prev && prev.length === cur.length && prev.every((p,i) => p.t === cur[i].t)){
    const changed = cur.map((c,i) => prev[i].h !== c.h ? i : -1).filter(i => i >= 0);
    if (changed.length){
      const links = [...document.querySelectorAll('#nav a')];
      const heads = [...doc.querySelectorAll('h2, h3')];
      changed.forEach(i => { links[i]?.classList.add('changed');
        if (prev[i] && prev[i].x != null && heads[i]) highlightSection(heads[i], wordDiff(prev[i].x, cur[i].x)); });
      showNewBanner(changed, doc);
    }
  }
  localStorage.setItem(key, JSON.stringify(cur));
}
function showNewBanner(changed, doc){
  document.getElementById('whatsnew')?.remove();
  const heads = [...doc.querySelectorAll('h2, h3')];
  const bar = document.createElement('div'); bar.id = 'whatsnew'; bar.className = 'whatsnew';
  bar.innerHTML = `<i class="ti ti-sparkles"></i><span><b>${changed.length}</b> section${changed.length>1?'s':''} updated since your last visit — the new text is highlighted</span><button class="wn-go">Jump to first change</button>`;
  read.prepend(bar);
  bar.querySelector('.wn-go').onclick = () => { const mk = doc.querySelector('.wn-add'), h = heads[changed[0]]; const target = mk || h;
    if (target){ target.scrollIntoView({behavior:'smooth',block:'center'}); if (h){ h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 1500); } }; };
}
const SIUNITX = { henry:'H',farad:'F',ohm:'\\Omega',siemens:'S',volt:'V',watt:'W',ampere:'A',kelvin:'K',hertz:'Hz',joule:'J',newton:'N',pascal:'Pa',metre:'m',meter:'m',gram:'g',mole:'mol',tesla:'T',weber:'Wb',coulomb:'C',radian:'rad',decibel:'dB',inch:'in',poise:'P',percent:'\\%',degree:'^\\circ',nano:'n',micro:'\\mu',milli:'m',pico:'p',femto:'f',kilo:'k',mega:'M',giga:'G',centi:'c',deci:'d' };
function expandUnits(tex){ return tex.replace(/\\degreeCelsius\b/g,'{}^\\circ\\mathrm{C}').replace(/\\([a-zA-Z]+)\b/g,(m,name)=>{ if(!(name in SIUNITX)) return m; const v=SIUNITX[name]; return /^[A-Za-z]+$/.test(v)?`\\mathrm{${v}}`:v; }); }
function runKatex(el){ if(!window.katex){ setTimeout(()=>runKatex(el),100); return; }
  el.querySelectorAll('span.math').forEach(s=>{ const tex=expandUnits(s.textContent.replace(/\\label\{[^}]*\}/g,'')); try{ window.katex.render(tex,s,{displayMode:s.classList.contains('display'),throwOnError:false}); }catch(e){} }); }
function fixFootnotes(doc){
  const fn=doc.querySelector('#footnotes'); if(fn&&!fn.querySelector('h2.fn-h')){ const h=document.createElement('h2'); h.className='fn-h'; h.textContent='Notes'; fn.insertBefore(h,fn.firstChild); }
  doc.querySelectorAll('a.footnote-ref').forEach(a=>{ a.onclick=e=>{ e.preventDefault(); e.stopPropagation(); document.getElementById('fn-tip')?.remove();
    const li=doc.querySelector(a.getAttribute('href')); if(!li) return; const html=li.cloneNode(true); html.querySelectorAll('a.footnote-back').forEach(b=>b.remove());
    const tip=document.createElement('div'); tip.id='fn-tip'; tip.className='fn-tip'; tip.innerHTML=`<div class="fn-tip-h">Note ${a.textContent.replace(/[^0-9]/g,'')}</div>`; tip.append(...html.childNodes); read.appendChild(tip);
    const rr=read.getBoundingClientRect(), ar=a.getBoundingClientRect(); tip.style.top=(ar.bottom-rr.top+read.scrollTop+6)+'px'; tip.style.left=Math.min(ar.left-rr.left,read.clientWidth-360)+'px';
    const close=ev=>{ if(!tip.contains(ev.target)){ tip.remove(); document.removeEventListener('mousedown',close); } }; setTimeout(()=>document.addEventListener('mousedown',close),0); }; });
  doc.querySelectorAll('a.footnote-back').forEach(a=>{ a.onclick=e=>{ e.preventDefault(); const t=doc.querySelector(a.getAttribute('href')); if(t){ t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('flash'); setTimeout(()=>t.classList.remove('flash'),1500); } }; });
}
// in-text citation → hover shows the reference(s); click jumps to the bibliography
let citeHideT=null;
function hideCiteTip(){ document.getElementById('cite-tip')?.remove(); }
function wireCitations(doc){
  doc.querySelectorAll('.citation').forEach(cit=>{ if(cit.dataset.citeWired) return; cit.dataset.citeWired='1'; cit.classList.add('cite-link');
    const keys=(cit.dataset.cites||'').split(/\s+/).filter(Boolean);
    cit.addEventListener('mouseenter',()=>showCiteTip(cit,keys,doc));
    cit.addEventListener('mouseleave',()=>{ citeHideT=setTimeout(hideCiteTip,220); });
    cit.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); const ref=keys[0]&&document.getElementById('ref-'+keys[0]); if(ref){ ref.scrollIntoView({behavior:'smooth',block:'center'}); ref.classList.add('flash'); setTimeout(()=>ref.classList.remove('flash'),1500); } }); });
}
function showCiteTip(cit,keys,doc){
  clearTimeout(citeHideT); hideCiteTip();
  const entries=keys.map(k=>document.getElementById('ref-'+k)).filter(Boolean); if(!entries.length) return;
  const tip=document.createElement('div'); tip.id='cite-tip'; tip.className='cite-tip';
  tip.innerHTML=entries.map(e=>`<div class="cite-entry">${e.innerHTML}</div>`).join('');
  read.appendChild(tip);
  const rr=read.getBoundingClientRect(), ar=cit.getBoundingClientRect();
  tip.style.top=(ar.bottom-rr.top+read.scrollTop+6)+'px';
  tip.style.left=Math.max(8,Math.min(ar.left-rr.left, read.clientWidth-400))+'px';
  tip.addEventListener('mouseenter',()=>clearTimeout(citeHideT));
  tip.addEventListener('mouseleave',()=>{ citeHideT=setTimeout(hideCiteTip,220); });
}
function figureLabel(fig){ const cap=fig.querySelector('figcaption')?.textContent.trim()||''; const m=cap.match(/^(Figure|Fig\.?|Table)\s*[\d.]+/i); return { quote:cap.slice(0,150), label:(m?m[0]:''), id:fig.querySelector('img')?.getAttribute('src')?.slice(-40)||'' }; }
function wireFigures(doc){ doc.querySelectorAll('figure, img').forEach(el=>{ const fig=el.tagName==='FIGURE'?el:(el.closest('figure')||el); if(fig.dataset.figWired) return; fig.dataset.figWired='1'; fig.classList.add('fig-commentable');
  fig.addEventListener('click',e=>{ if(window.getSelection().toString().trim()) return; e.stopPropagation(); document.getElementById('pop')?.remove(); const info=figureLabel(fig);
    const rr=read.getBoundingClientRect(), fr=fig.getBoundingClientRect(); const rects=[{x:fr.x-rr.x,y:fr.y-rr.y+read.scrollTop,w:fr.width,h:fr.height}];
    pending={ quote: info.label?`${info.label}${info.quote?': '+info.quote:''}`:(info.quote||'Figure'), kind:'figure', figure:info.id, section:headingFor(fig), confirmed:true, rects:[] }; showPopover(pending,rects,'figure',fig); }); });
  // tables and display equations are commentable too (no drawing — they carry no raster image)
  doc.querySelectorAll('table, .katex-display').forEach(el=>{ if(el.dataset.blkWired) return; if(el.closest('figure')?.dataset.figWired) return; el.dataset.blkWired='1'; el.classList.add('blk-commentable');
    el.addEventListener('click',e=>{ if(window.getSelection().toString().trim()) return; e.stopPropagation(); document.getElementById('pop')?.remove();
      const isTable=el.tagName==='TABLE'; let label='', quote='';
      if(isTable){ const cap=el.querySelector('caption')?.textContent.trim()||el.closest('figure')?.querySelector('figcaption')?.textContent.trim()||''; const m=cap.match(/^\s*Table\s+[\d.]+/i); label=m?m[0].trim():'Table'; quote=cap.slice(0,150)||'Table'; }
      else { const num=(el.querySelector('.tag, .eqn-num')?.textContent||'').replace(/[()]/g,'').trim(); label=num?`Equation (${num})`:'Equation'; quote=(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120)||'Equation'; }
      const rr=read.getBoundingClientRect(), fr=el.getBoundingClientRect(); const rects=[{x:fr.x-rr.x,y:fr.y-rr.y+read.scrollTop,w:fr.width,h:fr.height}];
      pending={ quote: label?`${label}: ${quote}`:quote, kind:'figure', figure:label, section:headingFor(el), confirmed:true, rects:[] }; showPopover(pending,rects,'figure'); }); }); }
const chapterByNum = n => CHAPTERS.find(c=>c.n===n);
function sectionNumberMap(doc){ const n=chMeta(current).n; const map={}; let h2=0,h3=0; doc.querySelectorAll('h2, h3').forEach(h=>{ if(h.tagName==='H2'){h2++;h3=0;map[`${n}.${h2}`]=h;} else {h3++;map[`${n}.${h2}.${h3}`]=h;} }); return map; }
function figTableMaps(doc){ const fig={},tab={}; doc.querySelectorAll('figure').forEach(f=>{ const m=(f.querySelector(':scope > figcaption')?.textContent||'').match(/^\s*Figure\s+(\d+(?:\.\d+)*)\./); if(m) fig[m[1]]=f; });
  doc.querySelectorAll('table caption, figcaption').forEach(c=>{ const m=c.textContent.match(/^\s*Table\s+(\d+(?:\.\d+)*)\./); if(m) tab[m[1]]=c.closest('figure')||c.closest('table')||c; }); return {fig,tab}; }
function linkCrossRefs(doc){
  const secMap=sectionNumberMap(doc), ftMap=figTableMaps(doc), curN=chMeta(current).n;
  const re=/\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+(\d+(?:\.\d+)*)/gi, reTest=/\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+\d/i;
  const walker=document.createTreeWalker(doc,NodeFilter.SHOW_TEXT,{ acceptNode:t=>{ if(!t.nodeValue.trim()||!reTest.test(t.nodeValue)) return NodeFilter.FILTER_REJECT; const bad=t.parentElement?.closest('a, h1, h2, h3, figcaption, .math, .katex, #footnotes, script, style'); return bad?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT; } });
  const todo=[]; let node; while((node=walker.nextNode())) todo.push(node);
  todo.forEach(text=>{ const frag=document.createDocumentFragment(); let last=0; const s=text.nodeValue; re.lastIndex=0; let m;
    while((m=re.exec(s))){ const kw=m[1], num=m[2], lead=parseInt(num,10); const isFig=/^Fig/i.test(kw), isTab=/^Tab/i.test(kw), isChap=/^Chap/i.test(kw); let handler=null;
      if(isFig||isTab){ if(lead===curN){ const t=(isFig?ftMap.fig:ftMap.tab)[num]; if(t) handler=()=>scrollFlash(t); } }
      else if(!isChap){ if(lead===curN){ const h=secMap[num]; if(h) handler=()=>scrollFlash(h); } }
      if(last<m.index) frag.appendChild(document.createTextNode(s.slice(last,m.index)));
      if(handler){ const a=document.createElement('a'); a.className='xref'; a.textContent=m[0]; a.href='javascript:void 0'; a.onclick=e=>{ e.preventDefault(); e.stopPropagation(); handler(); }; frag.appendChild(a); }
      else frag.appendChild(document.createTextNode(m[0]));
      last=m.index+m[0].length; }
    if(last<s.length) frag.appendChild(document.createTextNode(s.slice(last))); text.parentNode.replaceChild(frag,text); });
}
function scrollFlash(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1500); }

// ---------- section navigator ----------
function buildNav(){
  const nav=document.getElementById('nav'); const hs=[...document.querySelectorAll('#doc h2, #doc h3')];
  review.read=review.read||{};   // advisor-private per-section read check-offs
  const doneN=hs.filter((h,i)=>review.read[h.id||('sec-'+i)]).length;
  nav.innerHTML=`<div class="lbl">SECTIONS<span style="margin-left:auto">${doneN}/${hs.length}</span></div>`;
  hs.forEach((h,i)=>{ if(!h.id) h.id='sec-'+i; const sub=h.tagName==='H3'; const cnt=review.comments.filter(c=>(c.anchor.section||'')===h.textContent.trim()).length;
    const done=!!review.read[h.id];
    const a=document.createElement('a'); a.className=sub?'sub':''; a.dataset.sec=h.id;
    a.innerHTML=`<button class="chk${done?' on':''}" title="Mark section read"><i class="ti ti-${done?'circle-check-filled':'circle'}"></i></button>
      <span class="nav-t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap${done?';color:var(--text-3)':''}">${h.textContent}</span>${cnt?`<span class="count">${cnt}</span>`:''}`;
    a.querySelector('.nav-t').onclick=()=>h.scrollIntoView({behavior:'smooth',block:'start'});
    a.querySelector('.chk').onclick=e=>{ e.stopPropagation();
      if(review.read[h.id]) delete review.read[h.id]; else review.read[h.id]=true;
      markDirty(); buildNav(); };
    nav.appendChild(a); });
  read.onscroll=()=>{ let cur=null; hs.forEach(h=>{ if(h.getBoundingClientRect().top<140) cur=h.id; }); nav.querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.dataset.sec===cur)); review.cursor={sec:cur}; clearTimeout(scrollT); scrollT=setTimeout(save,900); };
  read.onscroll();
}
let scrollT=null;
function headingFor(node){ let el=node.nodeType===1?node:node.parentElement; while(el&&el.id!=='doc'){ let p=el.previousElementSibling; while(p){ if(/^H[1-3]$/.test(p.tagName)) return p.textContent.trim(); p=p.previousElementSibling; } el=el.parentElement; } return ''; }

// ---------- select-to-comment + suggest-edit ----------
let pending=null;
function selToPopover(){ if(document.getElementById('pop')) return; const sel=window.getSelection(); const text=sel.toString();
  if(!text.trim()||sel.rangeCount===0) return; const range=sel.getRangeAt(0); if(!range.startContainer.parentElement?.closest('#doc')) return;
  const rr=read.getBoundingClientRect(); const rects=[...range.getClientRects()].map(r=>({x:r.x-rr.x,y:r.y-rr.y+read.scrollTop,w:r.width,h:r.height}));
  pending=anchorFromSelection({text,page:null,rects}); pending.section=headingFor(range.startContainer); showPopover(pending,rects); }
read.addEventListener('mouseup', selToPopover);
read.addEventListener('touchend', ()=>setTimeout(selToPopover,10));
function showPopover(anchor,rects,defaultTag='wording',figEl=null){
  document.getElementById('pop')?.remove(); const top=Math.max(...rects.map(r=>r.y+r.h))+10; const isFig=anchor.kind==='figure';
  const pop=document.createElement('div'); pop.id='pop'; pop.className='popover'; pop.style.top=top+'px'; pop.style.left='50%'; pop.style.transform='translateX(-50%)';
  const modes=isFig?'':`<div class="pmodes" id="pmodes"><button data-m="note" class="on">Comment</button><button data-m="replace">Replace</button><button data-m="insert">Insert after</button><button data-m="delete">Delete</button></div>`;
  pop.innerHTML=`<div class="head"><i class="ti ti-${isFig?'photo':'link'}" style="margin-right:5px"></i>Commenting on ${isFig?'figure':''}<span class="loc"><i class="ti ti-circle-check-filled"></i>${anchor.section?'§ '+anchor.section.slice(0,38):(isFig?'this figure':'this passage')}</span></div>
    <div class="snip" id="psnip">"${escapeHtml(anchor.quote.slice(0,150))}"</div>${modes}
    ${isFig&&figEl?`<button class="btn figdraw-btn" id="figdraw"><i class="ti ti-pencil"></i>Draw on the figure</button>`:''}
    <textarea id="crepl" class="crepl" style="display:none"></textarea><div class="tags" id="tags"></div>
    <textarea id="cbody" placeholder="Leave a comment…  (⌥1–6 to tag · ${MOD}↵ to save)"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary" id="csave">Comment</button><button class="btn" id="ccancel">Cancel</button></div>`;
  read.appendChild(pop);
  let tag=defaultTag, mode='note'; const tr=pop.querySelector('#tags');
  TAGS.forEach(t=>{ const b=document.createElement('button'); b.textContent=t; const pick=()=>{ tag=t; [...tr.children].forEach(x=>{x.className='';x.style.background='transparent';x.style.color='var(--text-2)';x.style.borderColor='var(--border)';}); b.className='on'; b.style.background=`var(--${t}-bg)`; b.style.color=`var(--${t})`; b.style.borderColor='transparent'; }; b.onclick=pick; tr.appendChild(b); if(t===defaultTag) pick(); });
  const repl=pop.querySelector('#crepl'), body=pop.querySelector('#cbody'), saveBtn=pop.querySelector('#csave');
  const setMode=m=>{ mode=m; pop.querySelectorAll('#pmodes button').forEach(b=>b.classList.toggle('on',b.dataset.m===m)); const nr=m==='replace'||m==='insert'; repl.style.display=nr?'block':'none';
    repl.placeholder=m==='replace'?'Exact replacement text (verbatim)…':'Exact text to insert after the selection (verbatim)…'; body.placeholder=m==='note'?`Leave a comment…  (⌥1–6 to tag · ${MOD}↵ to save)`:'Optional note for this edit…';
    saveBtn.textContent=m==='note'?'Comment':m==='delete'?'Suggest deletion':m==='insert'?'Suggest insertion':'Suggest replacement'; saveBtn.className='btn '+(m==='delete'?'btn-danger':m==='note'?'btn-primary':'btn-suggest');
    pop.querySelector('#psnip').style.textDecoration=m==='delete'?'line-through':'none'; (nr?repl:body).focus(); };
  pop.querySelectorAll('#pmodes button').forEach(b=>b.onclick=()=>setMode(b.dataset.m)); body.focus();
  pop.querySelector('#ccancel').onclick=()=>{ pop.remove(); window.getSelection().removeAllRanges(); };
  pop.querySelector('#figdraw')?.addEventListener('click',()=>{ pop.remove(); openFigureMarkup(figEl,anchor); });
  pop._commit=()=>saveBtn.click(); pop._pickTag=i=>{ const b=tr.children[i]; if(b) b.click(); };
  saveBtn.onclick=()=>{ let edit=null;
    if(mode==='replace') edit={op:'replace',find:anchor.quote,replacement:repl.value};
    else if(mode==='insert') edit={op:'insert',find:anchor.quote,position:'after',replacement:repl.value};
    else if(mode==='delete') edit={op:'delete',find:anchor.quote,replacement:''};
    if(edit&&mode!=='delete'&&!repl.value.trim()){ flash('Enter the '+(mode==='insert'?'text to insert':'replacement text')+'.'); return; }
    review=addComment(review,{ anchor:pending, kind:edit?'suggestion':pending.kind, tag:edit?'edit':tag, body:body.value, edit, author:authorId(), status:'submitted' });
    markDirty(); renderComments(); buildNav(); paintHighlights(); pop.remove(); window.getSelection().removeAllRanges(); };
}

// ---------- draw-on-figure markup (capture-only: composites figure + strokes → PNG) ----------
const markupCache = {};   // path -> dataURL, so a freshly-drawn markup shows instantly
function openFigureMarkup(fig, anchor){
  document.getElementById('pop')?.remove();
  const img = fig.querySelector('img') || fig;
  const ir = img.getBoundingClientRect();
  const W = Math.max(40, Math.round(ir.width)), H = Math.max(40, Math.round(ir.height));
  const ov = document.createElement('div'); ov.id = 'figmk'; ov.className = 'figmk-back';
  ov.innerHTML = `<div class="figmk-modal">
    <div class="figmk-tools">
      <button class="figmk-tool on" data-t="box" title="Drag a box around the area with the issue"><i class="ti ti-square"></i>Box</button>
      <button class="figmk-tool" data-t="free" title="Freehand — circle or point at something"><i class="ti ti-scribble"></i>Draw</button>
      <span class="figmk-sep"></span>
      <button class="figmk-undo">Undo</button><button class="figmk-clear">Clear</button>
      <span class="figmk-hint">box = mark the area · draw = circle or point</span></div>
    <div class="figmk-stage" style="width:${W}px;height:${H}px">
      <img class="figmk-img" src="${img.src}" width="${W}" height="${H}" crossorigin="anonymous">
      <canvas class="figmk-canvas" width="${W}" height="${H}"></canvas></div>
    <textarea class="figmk-note" rows="2" placeholder="Describe the change you want…"></textarea>
    <div class="figmk-actions"><button class="btn btn-primary figmk-save">Save markup</button><button class="btn figmk-cancel">Cancel</button></div>
  </div>`;
  document.body.appendChild(ov);
  const canvas = ov.querySelector('.figmk-canvas'), ctx = canvas.getContext('2d');
  const COLOR = '#d6409f';                       // single high-visibility annotation color
  let tool = 'box', drawing = false, shapes = [], cur = null, start = null;
  const drawShape = s => { ctx.strokeStyle=COLOR; ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round';
    if (s.type === 'rect'){ ctx.fillStyle='rgba(214,64,159,.12)'; ctx.fillRect(s.x,s.y,s.w,s.h); ctx.strokeRect(s.x,s.y,s.w,s.h); }
    else { ctx.beginPath(); s.points.forEach((p,i) => i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); } };
  const redraw = preview => { ctx.clearRect(0,0,W,H); shapes.forEach(drawShape); if (preview) drawShape(preview); };
  const pos = e => { const r = canvas.getBoundingClientRect(); return [ (e.clientX-r.left)*(W/r.width), (e.clientY-r.top)*(H/r.height) ]; };
  const rectOf = (a,b) => ({ type:'rect', x:Math.min(a[0],b[0]), y:Math.min(a[1],b[1]), w:Math.abs(b[0]-a[0]), h:Math.abs(b[1]-a[1]) });
  canvas.addEventListener('pointerdown', e => { drawing=true; start=pos(e);
    if (tool==='free'){ cur={type:'free',points:[start]}; shapes.push(cur); } canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p=pos(e);
    if (tool==='free'){ cur.points.push(p); redraw(); } else redraw(rectOf(start,p)); });
  canvas.addEventListener('pointerup', e => { if (!drawing) return; drawing=false;
    if (tool==='box'){ const r=rectOf(start,pos(e)); if (r.w>4 && r.h>4) shapes.push(r); redraw(); } });
  ov.querySelectorAll('.figmk-tool').forEach(b => b.onclick = () => { tool=b.dataset.t; ov.querySelectorAll('.figmk-tool').forEach(x => x.classList.toggle('on', x===b)); });
  ov.querySelector('.figmk-undo').onclick = () => { shapes.pop(); redraw(); };
  ov.querySelector('.figmk-clear').onclick = () => { shapes=[]; redraw(); };
  ov.querySelector('.figmk-cancel').onclick = () => ov.remove();
  ov.querySelector('.figmk-save').onclick = async () => {
    if (!shapes.length){ flash('Mark the figure first (Box or Draw), or Cancel.'); return; }
    const note = ov.querySelector('.figmk-note').value.trim();
    let b64 = null;
    try { const ex = document.createElement('canvas'); ex.width=W; ex.height=H; const ec = ex.getContext('2d');
      ec.drawImage(ov.querySelector('.figmk-img'), 0,0, W,H); ec.drawImage(canvas, 0,0);
      const dataUrl = ex.toDataURL('image/png'); b64 = dataUrl.split(',')[1];
      review = addComment(review, { anchor, kind:'figure', tag:'figure', body:note, author:authorId() });
      const c = review.comments[review.comments.length-1];
      const path = `markups/${c.id}.png`; markupCache[path] = dataUrl;
      review = updateComment(review, c.id, { markup:{ path, ts:new Date().toISOString() } });
      markDirty(); renderComments(); buildNav(); paintHighlights(); ov.remove();
      const t = tok();
      if (t){ await putFile(t, path, b64, `markup: ${effId()} ${c.id}`); flash('Markup saved.'); }
      else flash('Markup saved locally — add your access key to upload it.');
    } catch(e){ flash('Markup upload failed: '+e.message); }
  };
}
function loadMarkupThumb(el, path){
  if (markupCache[path]){ el.querySelector('img').src = markupCache[path]; return; }
  const t = tok(); if (!t) return;
  getDataUrl(t, path).then(u => { markupCache[path] = u; const img = el.querySelector('img'); if (img) img.src = u; }).catch(() => {});
}

// ---------- comments rail ----------
let editingId=null, activeId=null, _railResolvedOpen=false;
// rail filter/sort state for the ACTIVE comment list (persists across re-renders)
let _railFilter={ q:'', kind:'all', sort:'doc' };
// map comment id -> vertical position of its mark/anchor in the rendered doc
function _railDocOrder(){
  const map={}; const order=[...document.querySelectorAll('#doc .cmark[data-id], #doc figure[data-cid], #doc .cmark-el[data-cid]')];
  order.forEach((el,i)=>{ const id=el.dataset.id||el.dataset.cid; if(id!=null && !(id in map)) map[id]=i; });
  return map;
}
// filter ACTIVE comments by search + kind, then sort by doc order or newest-first
function _railFilterSort(active){
  const f=_railFilter, q=f.q.trim().toLowerCase();
  let cs=active.filter(c=>{
    if(f.kind==='figure' && c.kind!=='figure') return false;
    if(f.kind==='suggestion' && c.kind!=='suggestion') return false;
    if(!q) return true;
    const hay=((c.body||'')+' '+(c.anchor&&c.anchor.quote||'')).toLowerCase();
    return hay.includes(q);
  });
  const cts=c=>String(c.created_ts ?? '');   // coerce: a numeric created_ts must never crash the sort (localeCompare is String-only)
  if(f.sort==='new') cs=[...cs].sort((a,b)=>cts(b).localeCompare(cts(a)));
  else { const ord=_railDocOrder(); const pos=c=>(c.id in ord)?ord[c.id]:1e6;
    cs=[...cs].sort((a,b)=>(pos(a)-pos(b))||cts(a).localeCompare(cts(b))); }
  return cs;
}
function suggHtml(c){ if(!c.edit) return ''; const e=c.edit, find=escapeHtml((e.find||'').slice(0,140)), repl=escapeHtml((e.replacement||'').slice(0,240));
  const label=e.op==='replace'?'Replace':e.op==='insert'?'Insert after':'Delete'; const inner=e.op==='delete'?`<del>${find}</del>`:e.op==='insert'?`<span style="color:var(--text-3)">…${find}</span> <ins>${repl}</ins>`:`<del>${find}</del> <ins>${repl}</ins>`;
  return `<div class="sugg"><div class="op"><i class="ti ti-pencil"></i>Suggested ${label} · verbatim</div>${inner}</div>`; }
function resolHtml(c){ if(!c.resolution) return ''; const r=c.resolution;
  const label=r.state==='addressed'?'Addressed':r.state==='declined'?'Kept as written':'Noted';
  const icon=r.state==='addressed'?'circle-check':r.state==='declined'?'circle-x':'info-circle';
  const diff=(r.before||r.after)?`<div class="rdiff">${r.before?`<del>${escapeHtml(r.before)}</del>`:''}${r.after?` <ins>${escapeHtml(r.after)}</ins>`:''}</div>`:'';
  return `<div class="resol resol-${r.state||'noted'}"><div class="resol-h"><i class="ti ti-${icon}"></i>${label} by the author${r.ts?` · ${(r.ts||'').slice(0,10)}`:''}</div>${r.note?`<div>${escapeHtml(r.note)}</div>`:''}${diff}</div>`; }
function threadHtml(c){ return (c.thread||[]).map(m=>`<div class="resp-fup" style="border-left-color:${m.author==='author'?'var(--accent)':'var(--success)'}"><span class="resp-fup-h">${m.author==='author'?'Author':'You'} · ${fmtDate(m.ts)}</span>${escapeHtml(m.text)}</div>`).join(''); }
function seenHtml(c){ return c.read?`<div class="seen"><i class="ti ti-check" style="font-size:11px"></i> Seen by the author</div>`:''; }
// a comment leaves the active rail once the author has addressed it (recorded a
// resolution) or it has been resolved here — it folds into the collapsed Resolved group.
const _isArchived = c => !c.reopened && (!!c.resolution || c.status==='resolved' || c.advisor_state==='resolved');
function _buildCard(c){
  const card=document.createElement('div'); card.className='ccard'; card.dataset.id=c.id;
  if(editingId===c.id){ card.appendChild(editCard(c)); return card; }
  const st=c.status; const resolved=st==='resolved'; const submitted=st==='submitted';
  const stBadge = resolved ? '<span class="status" style="color:var(--text-3)">resolved</span>'
    : submitted ? '<span class="status" style="background:var(--success-bg);color:var(--success)">submitted</span>' : '<span class="status" style="display:none"></span>';
  card.innerHTML=`<div class="row"><span class="chip" style="background:var(--${c.tag}-bg);color:var(--${c.tag})">${c.kind==='figure'?'<i class="ti ti-photo" style="font-size:11px;margin-right:2px"></i>':c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:11px;margin-right:2px"></i>':''}${c.tag}</span>
      <span class="cactions" style="margin-left:auto;display:none;gap:1px">
        <button class="icbtn cact" data-act="resolve" title="${resolved?'Reopen':'Resolve'}" style="width:25px;height:25px;font-size:14px"><i class="ti ti-${resolved?'rotate-clockwise':'check'}"></i></button>
        <button class="icbtn cact" data-act="edit" title="Edit" style="width:25px;height:25px;font-size:14px"><i class="ti ti-pencil"></i></button>
        <button class="icbtn cact" data-act="del" title="Delete" style="width:25px;height:25px;font-size:14px"><i class="ti ti-trash"></i></button></span>
      ${stBadge}</div>
    <div class="snip">"${escapeHtml((c.anchor.quote||'').slice(0,52))}"${c.created_ts?`<span class="cmeta"> · ${fmtDate(c.created_ts)}</span>`:''}</div><div class="body" style="${resolved?'opacity:.5;text-decoration:line-through':''}">${escapeHtml(c.body)}</div>${suggHtml(c)}${resolHtml(c)}${threadHtml(c)}${seenHtml(c)}${c.markup?`<div class="cmarkup" data-path="${escapeHtml(c.markup.path)}" title="Your markup"><img alt="figure markup"></div>`:''}`;
  if(c.markup) loadMarkupThumb(card.querySelector('.cmarkup'), c.markup.path);
  if(c.id===activeId) card.classList.add('active');
  card.onmouseenter=()=>{ card.querySelector('.cactions').style.display='flex'; const s=card.querySelector('.status'); if(s&&s.textContent) s.style.visibility='hidden'; document.querySelector(`#doc .cmark[data-id="${c.id}"]`)?.classList.add('cmark-hot'); };
  card.onmouseleave=()=>{ card.querySelector('.cactions').style.display='none'; const s=card.querySelector('.status'); if(s) s.style.visibility=''; document.querySelector(`#doc .cmark[data-id="${c.id}"]`)?.classList.remove('cmark-hot'); };
  card.querySelector('.snip').onclick=()=>jumpTo(c); card.querySelector('.body').onclick=()=>jumpTo(c);
  card.querySelectorAll('.cact').forEach(b=>b.onclick=e=>{ e.stopPropagation(); commentAction(c.id,b.dataset.act); });
  return card;
}
function renderComments(){
  const pane=document.getElementById('comments');
  const active=review.comments.filter(c=>!_isArchived(c));
  const archived=review.comments.filter(_isArchived);
  const open=active.filter(c=>c.status==='open').length;
  pane.innerHTML=`<div class="lbl">MY COMMENTS<span style="margin-left:auto">${active.length} active${open?` · ${open} open`:''}</span></div>`;
  if(!review.comments.length){ pane.innerHTML+=`<div style="font-size:12.5px;color:var(--text-3);padding:8px 2px">Select text or click a figure to leave a comment.</div>`; return; }
  // filter / sort toolbar (acts on the ACTIVE list only)
  if(active.length){
    const f=_railFilter;
    const bar=document.createElement('div'); bar.className='cbar';
    bar.innerHTML=`<input class="csel" id="rfq" type="search" placeholder="Search comments" value="${escapeHtml(f.q)}" style="flex:2">
      <select class="csel" id="rfkind"><option value="all"${f.kind==='all'?' selected':''}>all kinds</option><option value="figure"${f.kind==='figure'?' selected':''}>figures</option><option value="suggestion"${f.kind==='suggestion'?' selected':''}>suggestions</option></select>
      <button class="csort" id="rfsort" title="Sort">${f.sort==='doc'?'↓ document':'↓ newest'}</button>`;
    pane.appendChild(bar);
    const qel=bar.querySelector('#rfq');
    qel.oninput=e=>{ _railFilter.q=e.target.value; renderComments(); const n=document.getElementById('rfq'); if(n){ n.focus(); const v=n.value.length; n.setSelectionRange(v,v); } };
    bar.querySelector('#rfkind').onchange=e=>{ _railFilter.kind=e.target.value; renderComments(); };
    bar.querySelector('#rfsort').onclick=()=>{ _railFilter.sort=_railFilter.sort==='doc'?'new':'doc'; renderComments(); };
  }
  const shown=_railFilterSort(active);
  shown.forEach(c=>pane.appendChild(_buildCard(c)));
  if(active.length && !shown.length){ pane.insertAdjacentHTML('beforeend',`<div class="cempty">No comments match this filter.</div>`); }
  if(!active.length && archived.length){ pane.insertAdjacentHTML('beforeend',`<div style="font-size:12.5px;color:var(--text-3);padding:8px 2px">All your comments here have been addressed by the author.</div>`); }
  if(archived.length){
    const grp=document.createElement('div'); grp.style.marginTop='10px';
    const head=document.createElement('button'); head.type='button';
    head.style.cssText='display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;color:var(--text-3);font:inherit;font-size:12px;padding:6px 2px';
    head.innerHTML=`<i class="ti ti-chevron-${_railResolvedOpen?'down':'right'}"></i><span>Resolved</span><span style="margin-left:auto;color:var(--text-3);font-size:11px">${archived.length}</span>`;
    const body=document.createElement('div'); body.style.display=_railResolvedOpen?'block':'none';
    archived.forEach(c=>{ const cc=_buildCard(c); cc.style.opacity='.72'; body.appendChild(cc); });
    head.onclick=()=>{ _railResolvedOpen=!_railResolvedOpen; renderComments(); };
    grp.appendChild(head); grp.appendChild(body); pane.appendChild(grp);
  }
}
function commentAction(id,act){ const c=review.comments.find(x=>x.id===id); if(!c) return;
  if(act==='edit'){ editingId=id; renderComments(); return; }
  if(act==='del'){ if(!confirm('Delete this comment?')) return; review=deleteComment(review,id); }
  else if(act==='resolve'){ const reopening = c.status==='resolved';   // reopen restores 'submitted' (still submitted to the author), NOT 'open' (a draft the author hides)
    review=updateComment(review,id,{status: reopening?'submitted':'resolved', reopened: reopening}); }
  markDirty(); renderComments(); buildNav(); paintHighlights(); }
function editCard(c){ const w=document.createElement('div');
  w.innerHTML=`<textarea id="ebody" style="width:100%;border:.5px solid var(--accent);border-radius:6px;padding:7px;font:inherit;background:var(--bg);color:var(--text);min-height:54px;outline:none">${escapeHtml(c.body)}</textarea>
    <div id="etags" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-primary" id="esave" style="padding:5px 13px;font-size:12px">Save</button><button class="btn" id="ecancel" style="padding:5px 13px;font-size:12px">Cancel</button></div>`;
  let etag=c.tag; const tr=w.querySelector('#etags');                       // re-tag from the edit card, per-tag colored like the owner
  TAGS.forEach(t=>{ const b=document.createElement('button'); b.textContent=t; b.style.cssText='font-size:11.5px;padding:3px 11px;border-radius:20px;border:.5px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer';
    const pick=()=>{ etag=t; [...tr.children].forEach(x=>{x.style.background='transparent';x.style.color='var(--text-2)';x.style.borderColor='var(--border)';}); b.style.background=`var(--${t}-bg)`; b.style.color=`var(--${t})`; b.style.borderColor='transparent'; };
    b.onclick=pick; tr.appendChild(b); if(t===c.tag) pick(); });
  w.querySelector('#ecancel').onclick=()=>{ editingId=null; renderComments(); };
  w.querySelector('#esave').onclick=()=>{ review=updateComment(review,c.id,{body:w.querySelector('#ebody').value, tag:etag}); editingId=null; markDirty(); renderComments(); buildNav(); paintHighlights(); }; return w; }
// robust anchor location: a stored quote rarely byte-matches rendered HTML (injected
// "Figure 3.9." prefixes, KaTeX math, citation brackets, curly quotes/dashes).
function normText(s){ return (s||'').replace(/ /g,' ').normalize('NFKD')
  .replace(/[‐-―]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').toLowerCase().trim(); }
function keyWords(s){ return normText(s)
  .replace(/^(figure|fig\.?|table|tab\.?|eq\.?|equation)\s*[\d.]+\s*[:.]?\s*/i,'')
  .replace(/\[[^\]]*\]/g,' ').replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w=>w.length>=3); }
function locateAnchor(c){
  if(current==='__outline__'){   // outline comments live on .ol-node/.ol-cmt buttons, not in #doc
    const q=c.anchor?.quote||'', s=c.anchor?.section||'';
    const btn=[...document.querySelectorAll('.ol-cmt')].find(b=>b.dataset.node===q && b.dataset.sec===s);
    if(btn){ btn.closest('.ol-chapter')?.classList.add('open'); return btn.closest('.ol-node, .ol-chead')||btn; }
    return null;
  }
  const mark=document.querySelector(`#doc .cmark[data-id="${c.id}"], #doc .cmark[data-aid="${c.id}"], #doc figure[data-cid="${c.id}"], #doc .cmark-el[data-cid="${c.id}"]`); if(mark) return mark;
  const quote=c.anchor?.quote||'';
  const cands=[...document.querySelectorAll('#doc p, #doc li, #doc figure, #doc figcaption, #doc h2, #doc h3, #doc td, #doc blockquote')];
  const nq=normText(quote);
  for(const len of [90,55,32,18]){ if(nq.length<8) break; const probe=nq.slice(0,Math.min(len,nq.length)); const hit=cands.find(e=>normText(e.textContent).includes(probe)); if(hit) return hit; }
  const nw=keyWords(quote).slice(0,12);
  if(nw.length){ let best=null,bs=0; for(const e of cands){ const hay=new Set(keyWords(e.textContent)); let s=0; for(const w of nw) if(hay.has(w)) s++; if(s>bs){ bs=s; best=e; } } if(best&&bs>=Math.max(3,Math.ceil(nw.length*0.5))) return best; }
  if(c.anchor?.section){ const ns=normText(c.anchor.section); const sec=[...document.querySelectorAll('#doc h2, #doc h3')].find(h=>normText(h.textContent).includes(ns)); if(sec) return sec; }
  return null;
}
// ---------- inline track-changes rendering of a suggested edit ----------
// length-preserving fold (NFKD changes length, so this stays separate from normText): lowercase +
// unicode dash/quote/nbsp normalized to single chars, so a collapsed-index maps back into the raw node.
function litefold(s){ return (s||'').replace(/ /g,' ').replace(/[‐-―]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').toLowerCase(); }
// map an index in the whitespace-collapsed fold of `raw` back to an index in `raw`
function _mapCollapsedIndex(raw, collapsedIdx){
  const f=litefold(raw); let ci=0, prevSpace=false;
  for(let i=0;i<f.length;i++){ const isSpace=/\s/.test(f[i]); const out=isSpace?(prevSpace?'':' '):f[i]; if(out){ if(ci===collapsedIdx) return i; ci++; } prevSpace=isSpace; }
  return raw.length;
}
// the before/after of a comment's edit (advisor edits live on c.edit; resolutions on c.resolution)
function editPair(c){
  const e=c.edit, r=c.resolution;
  const before=(e?.find ?? r?.before ?? '').toString();
  const after =(e?.replacement ?? r?.after ?? '').toString();
  return (before.trim() || after.trim()) ? { before: before.trim().replace(/\s+/g,' '), after: after.trim().replace(/\s+/g,' ') } : null;
}
// find `text` inside one text node of a candidate block (fold + whitespace-tolerant) → {node,start,end}
function findEditRange(doc, text){
  if(!text || text.length < 4) return null;
  const probe=litefold(text).replace(/\s+/g,' ').trim().slice(0,40);
  const fullLen=litefold(text).replace(/\s+/g,' ').trim().length;
  for(const el of doc.querySelectorAll('p, li, figcaption, td, blockquote')){
    if(!litefold(el.textContent).replace(/\s+/g,' ').includes(probe)) continue;
    const tw=document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while((node=tw.nextNode())){
      const collapsed=litefold(node.nodeValue).replace(/\s+/g,' ');
      const i=collapsed.indexOf(probe); if(i<0) continue;
      const start=_mapCollapsedIndex(node.nodeValue, i);
      const end=Math.min(node.nodeValue.length, _mapCollapsedIndex(node.nodeValue, i+fullLen));
      return { node, start, end };
    }
  }
  return null;
}
// remove any previously-painted track-changes nodes (restore original text) so diffs don't stack
function clearEditNodes(){
  document.querySelectorAll('#doc ins.tc-stage').forEach(n=>n.remove());
  document.querySelectorAll('#doc del.tc-stage').forEach(n=>{ const p=n.parentNode; n.replaceWith(...n.childNodes); p.normalize(); });
}
// paint a struck-through `before` + highlighted `after` inline at the edit's spot. Works whether the
// OLD text is still present (anchors on `before`) or already replaced by the NEW text (anchors on
// `after`). Returns the node to scroll to, or null if the passage can't be located.
function paintEditDiff(c){
  const doc=document.getElementById('doc'); if(!doc) return null;
  const p=editPair(c); if(!p) return null;
  clearEditNodes();
  const mkDel=()=>{ const d=document.createElement('del'); d.className='tc-stage'; return d; };
  const mkIns=(t)=>{ const n=document.createElement('ins'); n.className='tc-stage'; if(t!=null) n.textContent=t; return n; };
  // case A: old text still in the doc → wrap it as del, append the new as ins (insert op: before is empty → skip)
  let rng=p.before ? findEditRange(doc, p.before) : null;
  if(rng){
    try{
      const r=document.createRange(); r.setStart(rng.node, rng.start); r.setEnd(rng.node, rng.end);
      if(p.after && p.after.replace(/\s+/g,' ').startsWith(p.before)){   // pure append
        const ins=mkIns(p.after.slice(p.before.length)); r.collapse(false); r.insertNode(ins); return ins;
      }
      const del=mkDel(); r.surroundContents(del);
      const ins=mkIns(p.after ? ' '+p.after : ''); del.after(ins); return p.after ? ins : del;   // delete op: del only
    }catch(e){ /* range spans element boundaries — fall through */ }
  }
  // case B: old text gone (edit applied), or insert op with no before → anchor on the NEW text
  rng=p.after ? findEditRange(doc, p.after) : null;
  if(rng){
    try{
      const r=document.createRange(); r.setStart(rng.node, rng.start); r.setEnd(rng.node, rng.end);
      const ins=mkIns(); r.surroundContents(ins);                       // highlight the new text in place
      if(p.before){ const del=mkDel(); del.textContent=p.before+' '; ins.before(del); }
      return ins;
    }catch(e){ /* range spans element boundaries — fall through */ }
  }
  return null;
}
function jumpTo(c){ activeId=c.id;
  if(editPair(c)){ const el=paintEditDiff(c); if(el){ scrollFlash(el); return; } }   // suggestion: paint the diff inline
  clearEditNodes();                                                                   // plain comment: drop any stale diff
  const el=locateAnchor(c);
  if(el) scrollFlash(el); else flash('Couldn’t find this passage — it may have changed since the comment.'); }
function activateComment(id){ activeId=id; renderComments(); document.querySelector(`#comments .ccard[data-id="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}); }
function paintHighlights(){ const doc=document.getElementById('doc'); if(!doc) return;
  doc.querySelectorAll('mark.cmark').forEach(m=>{ const p=m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
  doc.querySelectorAll('figure[data-cid]').forEach(f=>{ f.classList.remove('cmark-fig'); delete f.dataset.cid; });
  doc.querySelectorAll('.cmark-el').forEach(e=>{ e.classList.remove('cmark-el'); delete e.dataset.cid; e.onclick=null; });   // block-level fallback marks
  // normalize each block's/figure's text ONCE, not once per comment (was O(comments × blocks))
  const blocks=[...doc.querySelectorAll('p, li, figcaption')].map(el=>({el,txt:el.textContent.replace(/\s+/g,' ')}));
  const figs=[...doc.querySelectorAll('figure')].map(el=>({el,txt:el.textContent.replace(/\s+/g,' ')}));
  review.comments.forEach(c=>{ if(c.kind==='figure'){ const q=(c.anchor.quote||'').replace(/^[^:]*:\s*/,'').replace(/\s+/g,' ').trim().slice(0,30); const fig=(figs.find(f=>f.txt.includes(q)) || figs.find(f=>f.el.querySelector('img')?.src.endsWith(c.anchor.figure||' ')))?.el; if(fig){ fig.classList.add('cmark-fig'); fig.dataset.cid=c.id; fig.style.setProperty('--mk',`var(--${c.tag})`); } return; }
    const q=(c.anchor.quote||'').replace(/\s+/g,' ').trim(); if(q.length<4) return; const needle=q.slice(0,50); const el=blocks.find(b=>b.txt.includes(needle.slice(0,40)))?.el; if(!el) return; if(!wrapInNode(el,needle,c)){ el.classList.add('cmark-el'); el.dataset.cid=c.id; el.style.setProperty('--mk',`var(--${c.tag})`); el.onclick=()=>activateComment(c.id); } }); }
function wrapInNode(el,needle,c){ const tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let node, probe=needle.slice(0,30);
  while((node=tw.nextNode())){ const idx=node.nodeValue.indexOf(probe); if(idx>=0){ const r=document.createRange(); r.setStart(node,idx); r.setEnd(node,Math.min(node.nodeValue.length,idx+needle.length));
    const mk=document.createElement('mark'); mk.className='cmark'; mk.dataset.id=c.id; mk.dataset.tag=c.tag; if(c.edit) mk.dataset.sugg=c.edit.op; try{ r.surroundContents(mk); mk.onclick=e=>{ e.stopPropagation(); activateComment(c.id); }; return true; }catch(e){ return false; } } } return false; }

// ---------- top bar / home / search ----------
function renderTopbar(){ const m=chMeta(current);
  document.getElementById('topbar').innerHTML=`
    <button class="icbtn" id="btn-home" title="All chapters"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel"><i class="ti ti-book-2"></i><span>Chapter ${m.n} · ${shortTitle(m.title)}</span><i class="ti ti-chevron-down" style="font-size:15px;color:var(--text-3)"></i></button>
    <div class="search"><i class="ti ti-search"></i><input id="search" placeholder="Search chapter"></div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      <button class="icbtn" id="btn-theme" title="Theme"><i class="ti ti-moon"></i></button>
      <button class="icbtn" id="btn-export" title="Download this chapter (Word · Markdown · PDF)"><i class="ti ti-file-export"></i></button>
      <button class="icbtn" id="btn-key" title="Access key"><i class="ti ti-key"></i></button>
    </div>`;
  document.getElementById('btn-home').onclick=enterHome;
  document.getElementById('chsel').onclick=openChapterMenu;
  document.getElementById('btn-theme').onclick=()=>{ document.documentElement.classList.toggle('dark'); localStorage.setItem('theme',document.documentElement.classList.contains('dark')?'dark':'light'); };
  document.getElementById('btn-export').onclick=()=>exportDialog(current);
  document.getElementById('btn-key').onclick=()=>{ const v=prompt('Access key:',tok()||''); if(v!==null){ if(v.trim()) localStorage.setItem('ghpat',v.trim()); else localStorage.removeItem('ghpat'); boot(); } };
  const si=document.getElementById('search'); si.addEventListener('keydown',e=>{ if(e.key==='Enter') runSearch(si.value); if(e.key==='Escape'){ si.value=''; clearSearch(); } });
}
function openChapterMenu(){ const old=document.getElementById('chmenu'); if(old){ old.remove(); return; } const menu=document.createElement('div'); menu.id='chmenu';
  menu.style.cssText='position:absolute;top:50px;left:16px;z-index:40;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 34px rgba(0,0,0,.16);padding:6px;min-width:330px';
  const list=CHAPTERS.filter(c=>released.includes(c.id));
  menu.innerHTML=list.map(c=>`<div data-ch="${c.id}" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px${c.id===current?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px">${c.n}</span>${shortTitle(c.title)}</div>`).join('')||`<div style="padding:10px;color:var(--text-3);font-size:12.5px">No chapters released yet.</div>`;
  menu.querySelectorAll('[data-ch]').forEach(d=>{ d.onclick=()=>{ menu.remove(); loadChapter(d.dataset.ch); }; });
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',function h(e){ if(!menu.contains(e.target)&&e.target.id!=='chsel'){ menu.remove(); document.removeEventListener('click',h); } }),0);
}
function enterHome(){
  stopLiveSync();
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='none';
  document.getElementById('topbar').innerHTML=`<span style="display:inline-flex;align-items:center;gap:8px"><svg width="20" height="20" viewBox="0 0 52 52" style="flex:0 0 auto"><rect x="3" y="3" width="46" height="46" rx="12" fill="#2c64c4"/><line x1="19" y1="14" x2="19" y2="38" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="38" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="38" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.6" fill="#fff"/></svg><strong style="font-size:16px;font-weight:600">Footnote</strong><span style="font-size:13px;color:var(--text-2)">· ${escapeHtml(ADVISOR.name)}</span></span>
     <button class="icbtn" id="btn-theme" style="margin-left:auto"><i class="ti ti-moon"></i></button>
     <button class="icbtn" id="btn-key" title="Access key"><i class="ti ti-key"></i></button>`;
  document.getElementById('btn-theme').onclick=()=>{ document.documentElement.classList.toggle('dark'); localStorage.setItem('theme',document.documentElement.classList.contains('dark')?'dark':'light'); };
  const askKey=()=>{ const v=prompt('Access key:',tok()||''); if(v!==null){ if(v.trim()) localStorage.setItem('ghpat',v.trim()); else localStorage.removeItem('ghpat'); boot(); } };
  document.getElementById('btn-key').onclick=askKey;
  // first-run: no access key yet — prompt for it before anything else
  if(!tok()){
    read.innerHTML=`<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Welcome, ${escapeHtml(ADVISOR.name)}</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Enter the access key you were emailed to open the chapters shared with you for review. It's stored only in this browser.</div>
      <button class="btn btn-primary" id="connect">Enter access key</button></div>`;
    read.querySelector('#connect').onclick=askKey; return;
  }
  const list=CHAPTERS.filter(c=>released.includes(c.id));
  const cards=list.map(c=>{ const r=JSON.parse(localStorage.getItem(localKey(c.id))||'null'); const n=r?.comments?.length||0;
    return `<div class="chcard" data-ch="${c.id}" style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 15px;cursor:pointer">
      <div style="font-size:11.5px;color:var(--text-3)">Chapter ${c.n}</div>
      <div style="font-size:14px;font-weight:500;line-height:1.35;margin:3px 0 11px;min-height:38px">${shortTitle(c.title)}</div>
      <div style="font-size:11px;color:var(--text-2)">${n?`${n} comment${n>1?'s':''}`:'open to review'}</div></div>`; }).join('');
  const oc=JSON.parse(localStorage.getItem(localKey('__outline__'))||'null'); const ocn=oc?.comments?.length||0;
  read.innerHTML=`<div style="max-width:900px;margin:0 auto;padding:28px 24px 90px">
      <div style="font-size:13px;color:var(--text-2);margin-bottom:20px">Welcome, ${escapeHtml(displayName())}. The chapters released for your review are below. Open one to read it and leave comments or suggested edits — each one is shared with the author as soon as you add it.</div>
      <button id="outline-card" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:.5px solid var(--accent);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;background:var(--accent-bg);cursor:pointer;font:inherit;color:var(--text)">
        <i class="ti ti-list-tree" style="font-size:22px;color:var(--accent)"></i>
        <div style="min-width:0"><div style="font-size:14px;font-weight:500">Proposed dissertation outline</div>
        <div style="font-size:11.5px;color:var(--text-2)">See the planned structure and comment on it — available before chapters are released.</div></div>
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-2);white-space:nowrap">${ocn?ocn+' comment'+(ocn>1?'s':''):'open to review'} <i class="ti ti-chevron-right" style="vertical-align:-2px"></i></span></button>
      ${responsesReleased ? `<button id="responses-card" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:.5px solid var(--success);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;background:var(--success-bg);cursor:pointer;font:inherit;color:var(--text)">
        <i class="ti ti-message-check" style="font-size:22px;color:var(--success)"></i>
        <div style="min-width:0"><div style="font-size:14px;font-weight:500">Responses to your comments</div>
        <div style="font-size:11.5px;color:var(--text-2)">See how the author addressed each comment you submitted.</div></div>
        <span style="margin-left:auto;color:var(--text-2)"><i class="ti ti-chevron-right" style="vertical-align:-2px"></i></span></button>` : ''}
      <div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:13px">CHAPTERS FOR REVIEW</div>
      ${list.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px">${cards}</div>`:`<div class="empty">No chapters have been released for your review yet. You'll see them here once they're shared.</div>`}<div id="adv-downloads"></div></div>`;
  read.querySelectorAll('[data-ch]').forEach(el=>el.onclick=()=>loadChapter(el.dataset.ch));
  document.getElementById('outline-card').onclick=loadOutline;
  document.getElementById('responses-card')?.addEventListener('click', loadResponses);
  renderAdvisorDownloads();
}
// ---------- responses to your comments (read-only; gated by the owner's release toggle) ----------
async function loadResponses(){
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='none';
  document.getElementById('topbar').innerHTML=`<button class="icbtn" id="resp-back" title="All chapters"><i class="ti ti-layout-grid"></i></button>
    <strong style="font-size:15px;font-weight:600;margin-left:4px">Responses to your comments</strong>`;
  document.getElementById('resp-back').onclick=enterHome;
  read.innerHTML=`<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading…</div></div>`;
  const t=tok(); const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  const chs=[...released,'__outline__'];
  const groups=[];
  for(const ch of chs){
    let json=null;
    try{
      if(dev){ const r=await fetch(`./advisor/${effId()}/${ch}.json`); if(r.ok) json=await r.json(); }
      else if(t){ const r=await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/advisor/${effId()}/${ch}.json?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.status===401) return showKeyExpired(); if(r.ok) json=await r.json(); }
    }catch(e){}
    const cs=(json?.comments||[]).filter(c=>c.status==='submitted');
    cs.forEach(c=>{ const ov=localStorage.getItem(_respStateKey(ch,c.id)); if(ov!==null){ if(ov==='__open__') delete c.advisor_state; else c.advisor_state=ov; } });   // re-apply a triage flag that didn't sync
    if(cs.length) groups.push({ch, comments:cs});
  }
  renderResponses(groups);
}
let pendingJump = null;          // a quote to scroll to + flash after the next chapter render
const _respFigCache = {};        // ch -> published HTML (so we extract figures without refetching)
let _respGroups = [];            // retained so triage actions can re-render
let _respResolvedOpen = false;
function _findRespComment(cid){ for(const g of _respGroups){ const c=(g.comments||[]).find(x=>x.id===cid); if(c) return c; } return null; }
const _respStateKey = (ch, cid) => 'respstate:' + effId() + ':' + ch + ':' + cid;   // durable triage override, survives reload until the server confirms
function renderResponses(groups){
  _respGroups = groups;
  if(!groups.length){ read.innerHTML=`<div class="empty">Nothing here yet. Once you've submitted comments and the author has replied, you'll see their replies here.</div>`; return; }
  const item=(c,ch)=>{
    const st=c.advisor_state;
    const fups=(c.followups||[]).map(f=>`<div class="resp-fup"><span class="resp-fup-h">You · ${fmtDate(f.ts)}</span>${escapeHtml(f.text)}</div>`).join('');
    return `<div class="resp-item${st==='flagged'?' resp-flagged':''}" data-cid="${escapeHtml(c.id)}" data-ch="${escapeHtml(ch)}" data-q="${escapeHtml((c.anchor?.quote||'').slice(0,60))}" data-fig="${c.kind==='figure'?'1':''}">
        <div class="resp-top"><div class="resp-q">"${escapeHtml((c.anchor?.quote||'').slice(0,90))}"</div><span class="resp-time">${fmtDate(c.created_ts)}</span></div>
        ${st==='flagged'?`<div class="resp-flag-tag"><i class="ti ti-flag"></i>Flagged for later</div>`:''}
        <div class="resp-b">${escapeHtml(c.body||'')}</div>${suggHtml(c)}
        ${c.resolution?resolHtml(c):`<div class="resol resol-noted"><div class="resol-h"><i class="ti ti-clock"></i>Awaiting reply</div></div>`}
        ${threadHtml(c)}${seenHtml(c)}
        ${c.kind==='figure'?`<div class="resp-fig"></div>`:''}${fups}
        <div class="resp-acts">${ch!=='__outline__'?`<button class="btn resp-context"><i class="ti ti-arrow-right"></i>See in context</button>`:''}<button class="btn resp-reply"><i class="ti ti-message"></i>Reply</button>
          <button class="btn resp-flag">${st==='flagged'?'<i class="ti ti-flag-off"></i>Unflag':'<i class="ti ti-flag"></i>Flag for later'}</button>
          <button class="btn resp-resolve">${st==='resolved'?'<i class="ti ti-rotate-clockwise"></i>Reopen':'<i class="ti ti-check"></i>Mark resolved'}</button></div>
        <div class="resp-replybox" style="display:none"><textarea rows="2" placeholder="If this wasn't fully addressed, add a note for the author…"></textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-primary resp-send">Send reply</button><button class="btn resp-cancel">Cancel</button></div></div>
      </div>`;
  };
  const head=g=>g.ch==='__outline__'?'Proposed outline':`Chapter ${chMeta(g.ch).n} · ${escapeHtml(shortTitle(chMeta(g.ch).title))}`;
  const activeSecs=groups.map(g=>{ const cs=(g.comments||[]).filter(c=>!_isArchived(c)); return cs.length?`<div class="resp-sec"><div class="resp-ch">${head(g)}</div>${cs.map(c=>item(c,g.ch)).join('')}</div>`:''; }).join('');
  const resolved=groups.flatMap(g=>(g.comments||[]).filter(c=>_isArchived(c)).map(c=>({c,ch:g.ch})));
  const resolvedHtml=resolved.length?`<div class="resp-resolved-grp"><button class="resp-resolved-head"><i class="ti ti-chevron-${_respResolvedOpen?'down':'right'}"></i><span>Resolved</span><span class="rcount">${resolved.length}</span></button><div class="resp-resolved-body" style="display:${_respResolvedOpen?'block':'none'}">${resolved.map(r=>item(r.c,r.ch)).join('')}</div></div>`:'';
  const _cn={addressed:0,declined:0,noted:0};
  for(const c of groups.flatMap(g=>g.comments||[])){ const s=c.resolution&&c.resolution.state; if(s&&_cn[s]!=null) _cn[s]++; }
  const _parts=[]; if(_cn.addressed) _parts.push(`${_cn.addressed} addressed`); if(_cn.declined) _parts.push(`${_cn.declined} kept as written`); if(_cn.noted) _parts.push(`${_cn.noted} noted`);
  const _countsLine=_parts.length?`<div class="resp-counts">${_parts.join(' · ')}</div>`:'';
  read.innerHTML=`<div class="resp-wrap"><h1 class="ol-h1">Responses to your comments</h1>${_countsLine}${activeSecs||`<div class="empty" style="margin:8vh auto">You've cleared all your open responses${resolved.length?' — see Resolved below':''}.</div>`}${resolvedHtml}</div>`;
  read.querySelectorAll('.resp-item').forEach(el=>{
    const cid=el.dataset.cid, ch=el.dataset.ch;
    el.querySelector('.resp-context')?.addEventListener('click',()=>seeInContext(ch, el.dataset.q));
    const rb=el.querySelector('.resp-replybox');
    el.querySelector('.resp-reply').addEventListener('click',()=>{ rb.style.display=rb.style.display==='none'?'block':'none'; if(rb.style.display==='block') rb.querySelector('textarea').focus(); });
    el.querySelector('.resp-cancel').addEventListener('click',()=>{ rb.style.display='none'; });
    el.querySelector('.resp-send').addEventListener('click',()=>replyToResponse(cid, ch, rb));
    el.querySelector('.resp-flag').addEventListener('click',()=>setAdvisorState(cid, ch, _findRespComment(cid)?.advisor_state==='flagged'?null:'flagged'));
    el.querySelector('.resp-resolve').addEventListener('click',()=>setAdvisorState(cid, ch, _findRespComment(cid)?.advisor_state==='resolved'?null:'resolved'));
  });
  const rh=read.querySelector('.resp-resolved-head'); if(rh) rh.onclick=()=>{ _respResolvedOpen=!_respResolvedOpen; renderResponses(_respGroups); };
  embedChangedFigures(groups);
}
async function setAdvisorState(cid, ch, state){
  const c=_findRespComment(cid); if(c){ if(state) c.advisor_state=state; else delete c.advisor_state; }
  renderResponses(_respGroups);
  localStorage.setItem(_respStateKey(ch,cid), state||'__open__');   // persist locally first so the flag survives a reload even if the sync fails
  const t=tok(); if(!t) return;
  // refetch-and-reapply each attempt so a 409 never re-sends a stale snapshot over a concurrent write
  const path=`advisor/${effId()}/${ch}.json`;
  for(let attempt=0; attempt<5; attempt++){
    try{ const { json, sha }=await getJson(t, path);
      const tc=(json?.comments||[]).find(x=>x.id===cid); if(!tc){ localStorage.removeItem(_respStateKey(ch,cid)); return; }   // withdrawn/absent — nothing to write
      if(state) tc.advisor_state=state; else delete tc.advisor_state;
      await putJson(t, path, json, sha, `triage(${effId()}): ${ch} ${cid} ${state||'open'}`, false);
      localStorage.removeItem(_respStateKey(ch,cid)); return;   // confirmed on the server — drop the local override
    }catch(e){ if(/\b409\b/.test(e.message)&&attempt<4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } flash('Saved here; sync failed: '+e.message); return; }
  }
}
function seeInContext(ch, q){
  if(ch==='__outline__'){ loadOutline(); return; }
  pendingJump=q; loadChapter(ch);
}
async function replyToResponse(cid, ch, rb){
  const ta=rb.querySelector('textarea'); const v=ta.value.trim(); if(!v) return;
  const t=tok(); if(!t){ flash('Add your access key first.'); return; }
  const path=`advisor/${effId()}/${ch}.json`;
  const msg={ author:'advisor', text:v, ts:new Date().toISOString() };
  // refetch-and-reapply each attempt: on a 409 we append to the FRESH remote, never overwrite it with a stale copy
  for(let attempt=0; attempt<5; attempt++){
    try{
      const { json, sha }=await getJson(t, path);
      const c=(json?.comments||[]).find(x=>x.id===cid); if(!c){ flash('Could not find that comment.'); return; }
      c.thread=[...(c.thread||[]), msg]; c.status='submitted'; c.reopened=true;
      await putJson(t, path, json, sha, `reply(${effId()}): ${ch} ${cid}`, false);
      const fup=document.createElement('div'); fup.className='resp-fup'; fup.style.borderLeftColor='var(--success)'; fup.innerHTML=`<span class="resp-fup-h">You · ${new Date().toISOString().slice(0,10)}</span>${escapeHtml(v)}`;
      rb.before(fup); rb.style.display='none'; ta.value='';
      flash('Reply sent to the author.'); return;
    }catch(e){ if(/\b409\b/.test(e.message)&&attempt<4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } flash('Reply failed: '+e.message); return; }
  }
}
async function embedChangedFigures(groups){
  const t=tok(); const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  const chs=[...new Set(groups.filter(g=>g.ch!=='__outline__' && g.comments.some(c=>c.kind==='figure')).map(g=>g.ch))];
  for(const ch of chs){
    let html=_respFigCache[ch]||null;
    if(!html){ try{
      if(dev){ const r=await fetch(`./chapters/${ch}.html`); if(r.ok) html=await r.text(); }
      else if(t){ const r=await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/content/${ch}.html?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.ok) html=await r.text(); }
    }catch(e){} if(html) _respFigCache[ch]=html; }
    if(!html) continue;
    const tmp=document.createElement('div'); tmp.innerHTML=html; const figs=[...tmp.querySelectorAll('figure')];
    document.querySelectorAll(`.resp-item[data-fig="1"][data-ch="${ch}"]`).forEach(it=>{
      // captions carry no "Figure N" number in the raw HTML (added at render time), so match by caption text
      const q=it.dataset.q||''; const bare=q.replace(/(Figure|Fig\.?|Table)\s*[\d.]+[.:]*\s*/gi,'').replace(/\s+/g,' ').trim();
      const probe=bare.slice(0,35);
      const fig=probe ? figs.find(f=>f.textContent.replace(/\s+/g,' ').includes(probe)) : null;
      const slot=it.querySelector('.resp-fig');
      if(fig && slot){ slot.innerHTML=`<div class="resp-fig-lbl">Updated figure</div>${fig.outerHTML}`; runKatex(slot); }
      else slot?.remove();
    });
  }
  document.querySelectorAll('.resp-fig:empty').forEach(s=>s.remove());
}
// ---------- proposed outline (available before chapters are released) ----------
async function loadOutline(){
  current='__outline__'; review=loadLocal('__outline__');
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='';
  renderOutlineTopbar();
  read.innerHTML=`<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading outline…</div></div>`;
  let data=null; const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  try{
    if(dev){ const r=await fetch('./outline.json'); if(r.ok) data=await r.json(); }
    if(!data){ const t=tok(); if(t){ const r=await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/outline.json?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.status===401) return showKeyExpired(); if(r.ok) data=await r.json(); } }
  }catch(e){}
  if(!data){ read.innerHTML=`<div class="empty">Couldn't load the outline. Check your access key.</div>`; return; }
  renderOutline(data); renderComments(); syncDown();
  if (tok() && !tourSeen('tour-advisor-outline-v1')){ markTourSeen('tour-advisor-outline-v1'); setTimeout(() => { try { launchAdvisorOutlineTour(); } catch {} }, 900); }
}
function renderOutlineTopbar(){
  document.getElementById('topbar').innerHTML=`
    <button class="icbtn" id="btn-home" title="All chapters"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel" style="cursor:default"><i class="ti ti-list-tree"></i><span>Proposed outline</span></button>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      <button class="icbtn" id="btn-theme" title="Theme"><i class="ti ti-moon"></i></button>
      <button class="icbtn" id="btn-key" title="Access key"><i class="ti ti-key"></i></button></div>`;
  document.getElementById('btn-home').onclick=enterHome;
  document.getElementById('btn-theme').onclick=()=>{ document.documentElement.classList.toggle('dark'); localStorage.setItem('theme',document.documentElement.classList.contains('dark')?'dark':'light'); };
  document.getElementById('btn-key').onclick=()=>{ const v=prompt('Access key:',tok()||''); if(v!==null){ if(v.trim()) localStorage.setItem('ghpat',v.trim()); else localStorage.removeItem('ghpat'); boot(); } };
}
function renderOutline(data){
  const cnt=(label,sec)=>review.comments.filter(c=>c.anchor?.quote===label && c.anchor?.section===sec).length;
  const badge=n=>n?`<i class="ti ti-message"></i>${n}`:`<i class="ti ti-message-plus"></i>`;
  const node=(title, synopsis, sec, cls)=>`<div class="ol-node ${cls}">
      <div class="ol-srow"><span class="ol-slabel">${escapeHtml(title)}</span>${synopsis?`<span class="ol-syn">${escapeHtml(synopsis)}</span>`:''}</div>
      <button class="ol-cmt" data-node="${escapeHtml(title)}" data-sec="${escapeHtml(sec)}">${badge(cnt(title, sec))}</button></div>`;
  const chapters=data.chapters.map(ch=>{
    const secs=(ch.sections||[]).map(s=>{
      const subs=(s.subsections||[]).map(ss=>node(ss.title, ss.synopsis, ch.title, 'ol-sub')).join('');
      return node(s.title, s.synopsis, ch.title, 'ol-sec')+subs;
    }).join('');
    return `<div class="ol-chapter">
      <div class="ol-chead" data-toggle><i class="ti ti-chevron-right ol-chev"></i><span class="ol-cn">${ch.n}</span>
        <div style="min-width:0;flex:1"><div class="ol-ctitle">${escapeHtml(ch.title)}</div>${ch.synopsis?`<div class="ol-csyn">${escapeHtml(ch.synopsis)}</div>`:''}</div>
        <button class="ol-cmt" data-node="${escapeHtml(ch.title)}" data-sec="${escapeHtml(ch.title)}">${badge(cnt(ch.title, ch.title))}</button></div>
      <div class="ol-sections">${secs}</div></div>`;
  }).join('');
  read.innerHTML=`<div class="ol-wrap"><h1 class="ol-h1">${escapeHtml(data.title||'Proposed outline')}</h1>
    <p class="ol-intro">${escapeHtml(data.intro||'')}</p>${chapters}</div>`;
  read.querySelectorAll('[data-toggle]').forEach(h=>h.onclick=e=>{ if(e.target.closest('.ol-cmt')) return; h.closest('.ol-chapter').classList.toggle('open'); });
  read.querySelectorAll('.ol-cmt').forEach(b=>b.onclick=e=>{ e.stopPropagation(); outlineComment(b, b.dataset.node, b.dataset.sec); });
}
function outlineComment(btn, label, section){
  document.getElementById('ol-composer')?.remove();
  const box=document.createElement('div'); box.id='ol-composer'; box.className='ol-composer';
  box.innerHTML=`<textarea rows="2" placeholder="Comment on “${escapeHtml(label)}”…"></textarea>
    <div class="ol-cactions"><button class="btn btn-primary ol-save">Add comment</button><button class="btn ol-cancel">Cancel</button></div>`;
  (btn.closest('.ol-node, .ol-chead')||btn).after(box); box.querySelector('textarea').focus();
  box.querySelector('.ol-cancel').onclick=()=>box.remove();
  box.querySelector('.ol-save').onclick=()=>{ const v=box.querySelector('textarea').value.trim(); if(!v) return;
    review=addComment(review,{ anchor:{quote:label, section}, kind:'text', tag:'suggestion', body:v, author:authorId() });
    markDirty(); box.remove();
    const n=review.comments.filter(c=>c.anchor?.quote===label && c.anchor?.section===section).length; btn.innerHTML=`<i class="ti ti-message"></i>${n}`;
    renderComments(); flash('Comment added — shared with the author.'); };
}
function runSearch(q){ clearSearch(); if(!q.trim()) return; const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'); let first=null;
  document.querySelectorAll('#doc p').forEach(p=>{ if(re.test(p.textContent)){ p.innerHTML=p.innerHTML.replace(re,m=>`<mark style="background:var(--warn-bg)">${m}</mark>`); if(!first) first=p; } }); if(first) first.scrollIntoView({behavior:'smooth',block:'center'}); }
function clearSearch(){ document.querySelectorAll('#doc mark:not(.cmark)').forEach(m=>m.replaceWith(...m.childNodes)); }
function flash(msg, ms=2600){ const t=document.createElement('div'); t.textContent=msg; t.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:9px 16px;border-radius:20px;font-size:13px;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:88vw;text-align:center'; document.body.appendChild(t); setTimeout(()=>t.remove(),ms); }

// ---------- download a chapter as Word / Markdown / PDF, with your comments ----------
// Mirrors the owner reviewer's export: queue a build job, the cloud pipeline (pandoc +
// LaTeX) produces the files, and they appear under Downloads on the home screen.
const _EXP_FMT = { docx:'Word', pdf:'PDF', md:'Markdown' };
const _expOpen = new Set();
function exportDialog(scope){
  document.getElementById('expdlg')?.remove();
  const m = chMeta(scope);
  const title = scope==='__outline__' ? 'the proposed outline' : `Chapter ${m.n} · ${shortTitle(m.title)}`;
  const back=document.createElement('div'); back.id='expdlg';
  back.style.cssText='position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center';
  back.innerHTML=`<div style="background:var(--bg);border:.5px solid var(--border-2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(440px,92vw);padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:3px">Download ${escapeHtml(title)}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Built in the cloud with your comments included. It appears under Downloads on the home screen when ready, usually within a few minutes.</div>
      <div style="font-size:11px;letter-spacing:.05em;color:var(--text-3);margin-bottom:6px">FORMATS</div>
      <label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" class="exp-fmt" value="docx" checked> Word (.docx), with your comments</label>
      <label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" class="exp-fmt" value="md" checked> Markdown</label>
      <label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" class="exp-fmt" value="pdf"> PDF <span style="color:var(--text-3)">(slower to build)</span></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn" id="exp-cancel">Cancel</button>
        <button class="btn btn-primary" id="exp-go"><i class="ti ti-file-export"></i>Download</button></div>
      <div id="exp-stat" style="font-size:12px;color:var(--text-3);margin-top:8px"></div></div>`;
  document.body.appendChild(back);
  back.onclick=e=>{ if(e.target===back) back.remove(); };
  back.querySelector('#exp-cancel').onclick=()=>back.remove();
  const stat=back.querySelector('#exp-stat');
  back.querySelector('#exp-go').onclick=async()=>{
    const formats=[...back.querySelectorAll('.exp-fmt:checked')].map(x=>x.value);
    if(!formats.length){ stat.textContent='Pick at least one format.'; return; }
    stat.textContent='Requesting…';
    try{ await queueExport(scope, formats);
      stat.textContent='Requested. Check Downloads on the home screen in a few minutes.';
      setTimeout(()=>back.remove(),1800); }
    catch(e){ stat.textContent='Failed: '+e.message; }
  };
}
async function queueExport(scope, formats){
  const t=tok(); if(!t) throw new Error('add your access key first');
  const { json, sha } = await getJson(t,'jobs.json').catch(()=>({json:null,sha:null}));
  const jobs = Array.isArray(json)?json:[];
  jobs.push({ id:'j_'+Date.now().toString(36), type:'export', chapter:scope, formats,
    opts:{ resolved:true, reviewers:[effId()] }, status:'queued',
    requested_ts:new Date().toISOString(), requested_by:effId() });
  await putJson(t,'jobs.json',jobs,sha,`export: ${effId()} ${scope} (${formats.join(',')})`);
}
async function listExports(){
  const t=tok(); if(!t) return [];
  const { json } = await getJson(t,'jobs.json').catch(()=>({json:null}));
  return (Array.isArray(json)?json:[]).filter(j=>j.type==='export' && j.requested_by===effId())
    .sort((a,b)=>(b.requested_ts||'').localeCompare(a.requested_ts||''));
}
function exportPick(anchorBtn){
  document.getElementById('exppick')?.remove();
  const list=(released||[]).filter(id=>id!=='__outline__');
  const items=list.map(id=>{ const m=chMeta(id); return `<div data-ch="${id}" class="exppick-it" style="padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px"><span style="color:var(--text-3);min-width:18px;display:inline-block">${m.n}</span> ${shortTitle(m.title)}</div>`; }).join('')||`<div style="padding:10px;color:var(--text-3);font-size:12.5px">No chapters released yet.</div>`;
  const pop=document.createElement('div'); pop.id='exppick';
  pop.style.cssText='position:fixed;z-index:85;background:var(--bg);border:.5px solid var(--border-2);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:6px;min-width:252px;max-height:60vh;overflow:auto';
  const r=anchorBtn.getBoundingClientRect(); pop.style.top=(r.bottom+6)+'px'; pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-264))+'px';
  pop.innerHTML=`<div style="font-size:10.5px;letter-spacing:.05em;color:var(--text-3);padding:4px 10px 6px">EXPORT WHICH CHAPTER?</div>`+items;
  document.body.appendChild(pop);
  pop.querySelectorAll('[data-ch]').forEach(d=>{ d.onmouseenter=()=>d.style.background='var(--accent-bg)'; d.onmouseleave=()=>d.style.background=''; d.onclick=()=>{ pop.remove(); exportDialog(d.dataset.ch); }; });
  setTimeout(()=>document.addEventListener('click',function h(e){ if(!pop.contains(e.target)&&e.target!==anchorBtn){ pop.remove(); document.removeEventListener('click',h); } }),0);
}
async function renderAdvisorDownloads(){
  const box=document.getElementById('adv-downloads'); if(!box) return;
  const jobs=await listExports();
  const header=`<div style="display:flex;align-items:center;gap:10px;margin:24px 0 13px">
      <div style="font-size:11px;letter-spacing:.06em;color:var(--text-3)">DOWNLOADS</div>
      <button class="btn" id="adv-export-btn" style="margin-left:auto;padding:5px 11px;font-size:12px"><i class="ti ti-file-export"></i>Export a chapter…</button></div>`;
  if(!jobs.length){
    box.innerHTML=header+`<div style="font-size:12.5px;color:var(--text-3);line-height:1.6">No downloads yet. Use <strong>Export a chapter…</strong> above (or the export icon inside any chapter) to download it as Word, Markdown, or PDF with your comments.</div>`;
    box.querySelector('#adv-export-btn').onclick=e=>exportPick(e.currentTarget); return;
  }
  const groups={}; for(const j of jobs){ (groups[j.chapter] ||= []).push(j); }
  box.innerHTML=header+Object.keys(groups).map(scope=>{
    const list=groups[scope]; const m=chMeta(scope);
    const name=scope==='__outline__'?'Proposed outline':`Chapter ${m.n} · ${shortTitle(m.title)}`;
    const pending=list.filter(j=>j.status!=='done').length; const open=_expOpen.has(scope);
    const versions=list.map(j=>{
      const when=j.done_ts?fmtDate(j.done_ts):(j.requested_ts?fmtDate(j.requested_ts):'');
      if(j.status!=='done') return `<div style="padding:7px 0;font-size:11.5px;color:var(--text-3)"><i class="ti ti-clock"></i> ${when} · building, check back soon</div>`;
      const dls=(j.artifacts||[]).map(art=>`<button class="btn dl-get" data-path="${escapeHtml(art.path)}" style="padding:3px 9px;font-size:11.5px"><i class="ti ti-download"></i>${_EXP_FMT[art.fmt]||art.fmt}</button>`).join(' ');
      return `<div style="padding:7px 0;border-top:.5px solid var(--border)"><div style="font-size:11.5px;color:var(--text-3)">${when}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${dls||'<span style="font-size:11.5px;color:var(--text-3)">no files</span>'}</div></div>`;
    }).join('');
    return `<div style="border:.5px solid var(--border);border-radius:10px;padding:4px 12px 6px;margin-bottom:10px"><button class="dl-grp-h" data-scope="${escapeHtml(scope)}" style="display:flex;align-items:center;gap:7px;width:100%;background:none;border:none;cursor:pointer;font:inherit;color:var(--text);padding:8px 0"><i class="ti ti-chevron-${open?'down':'right'}"></i><span style="font-size:13px">${name}</span><span style="margin-left:auto;color:var(--text-3);font-size:11.5px">${list.length} version${list.length>1?'s':''}${pending?` · ${pending} building`:''}</span></button><div style="display:${open?'block':'none'}">${versions}</div></div>`;
  }).join('');
  box.querySelector('#adv-export-btn').onclick=e=>exportPick(e.currentTarget);
  box.querySelectorAll('.dl-grp-h').forEach(h=>h.onclick=()=>{ const s=h.dataset.scope; _expOpen.has(s)?_expOpen.delete(s):_expOpen.add(s); renderAdvisorDownloads(); });
  box.querySelectorAll('.dl-get').forEach(b=>b.onclick=()=>downloadArtifact(b.dataset.path));
}
async function downloadArtifact(path){
  const t=tok(); if(!t){ flash('Add your access key first.'); return; }
  flash('Fetching…');
  try{ const url=`https://api.github.com/repos/${DATA_REPO}/contents/${path}?t=${Date.now()}`;
    const r=await fetch(url,{ headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if(!r.ok) throw new Error('GitHub '+r.status);
    const blob=await r.blob();
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=path.split('/').pop(); document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
    flash('Saved ✓');
  }catch(e){ flash('Download failed: '+e.message); }
}

// ---------- mobile: comments rail as a bottom sheet ----------
function setupMobileSheet(){
  const back=document.createElement('div'); back.id='sheetbackdrop'; back.onclick=()=>document.body.classList.remove('sheet-open');
  const fab=document.createElement('button'); fab.id='sheetfab'; fab.innerHTML='<i class="ti ti-message-circle"></i>'; fab.onclick=()=>document.body.classList.toggle('sheet-open');
  document.body.append(back, fab);
}
// ---------- boot ----------
async function boot(){ keyBad = false; revoked = false; await loadRelease(); if (revoked){ showRevoked(); return; } if (keyBad && tok()){ showKeyExpired(); return; }
  if (SHARED && tok() && !reviewerName()){ showNameEntry(); return; }
  const _r = sessionStorage.getItem('_resume'); if (_r){ sessionStorage.removeItem('_resume'); loadChapter(_r); } else enterHome();   // a refresh returns you to where you were (loadChapter routes __outline__ to the outline)
  startOutbox(); retryPending(); renderBanner();
  ensureTourButton();
  // Only auto-run once the reviewer is actually in (has an access key) — never over the login screen.
  // Mark seen at launch (not just on finish) so a hard refresh doesn't re-show it to a returning reviewer.
  if (tok() && !tourSeen('tour-advisor-v1')){ markTourSeen('tour-advisor-v1'); setTimeout(() => { try { launchAdvisorTour(); } catch {} }, 1400); } }
// Floating replay button (always available); appended once.
function ensureTourButton(){
  if (document.getElementById('adv-tour-btn')) return;
  const b = document.createElement('button');
  b.id = 'adv-tour-btn'; b.title = 'Tour'; b.className = 'icbtn';
  b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:40;width:36px;height:36px;border-radius:50%;background:var(--bg);border:.5px solid var(--border-2);box-shadow:0 4px 14px rgba(0,0,0,.14)';
  b.innerHTML = '<i class="ti ti-help-circle"></i>';
  b.onclick = launchAdvisorTour;
  document.body.appendChild(b);
}
// outbox heartbeat: retry any unconfirmed local edits on a timer, when the tab regains focus,
// and when connectivity returns — so a comment written offline still reaches GitHub later.
let outboxStarted = false;
function startOutbox(){ if (outboxStarted) return; outboxStarted = true;
  setInterval(() => { if (navigator.onLine && tok()) retryPending(); }, 30000);
  window.addEventListener('online', () => retryPending());
  window.addEventListener('visibilitychange', () => { if (!document.hidden) retryPending(); });
  window.addEventListener('beforeunload', e => { if (pendingChapters().length){ e.preventDefault(); e.returnValue = ''; } });   // warn before leaving with unsynced work
}
function showNameEntry(){
  document.getElementById('nav').style.display = 'none'; document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">Dissertation review</strong>`;
  read.innerHTML = `<div class="empty"><i class="ti ti-user-circle" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Welcome — what's your name?</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:14px;max-width:400px">So the author knows who left each comment. Stored only in this browser.</div>
    <input id="rname" placeholder="Your name" autocomplete="name" style="padding:9px 12px;border:.5px solid var(--border-2);border-radius:8px;font:inherit;font-size:14px;min-width:250px;background:var(--bg);color:var(--text);outline:none"><br>
    <button class="btn btn-primary" id="rgo" style="margin-top:13px">Start reviewing</button></div>`;
  const go = () => { const v = read.querySelector('#rname').value.trim(); if (!v) return; localStorage.setItem('reviewerName', v); ensureReviewerId(); boot(); };
  read.querySelector('#rgo').onclick = go;
  read.querySelector('#rname').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  read.querySelector('#rname').focus();
}
setupMobileSheet();
// ---------- panes / focus / keyboard (reading ergonomics) ----------
function toggleNav(){ const n=document.getElementById('nav'); if(n) n.style.display=n.style.display==='none'?'':'none'; }
function toggleRail(){ const c=document.getElementById('comments'); if(c) c.style.display=c.style.display==='none'?'':'none'; }
function toggleFocus(){ document.body.classList.toggle('focusmode'); flash(document.body.classList.contains('focusmode')?'Focus mode on — press f to exit':'Focus mode off'); }
// move a current-index pointer over the VISIBLE active comments (rail filter/sort order), jump + activate
function cycleComment(dir){
  const active=review.comments.filter(c=>!_isArchived(c));
  const list=_railFilterSort(active); if(!list.length) return;
  let i=list.findIndex(c=>c.id===activeId);
  i = i<0 ? (dir>0?0:list.length-1) : (i+dir+list.length)%list.length;
  const c=list[i]; jumpTo(c); activateComment(c.id); }
const SHORTCUTS=[['j / k','next / previous comment'],['↵ on a comment','jump to its place in the text'],['f','focus (distraction-free) mode'],['[ / ]','collapse left nav / comments rail'],['/','search this chapter'],['Esc','close popover / overlay'],[`${MOD}↵ (in popover)`,'save the comment'],['⌥1–6 (in popover)','pick a tag'],['?','show this help']];
function toggleHelp(){
  const ex=document.getElementById('helpov'); if(ex){ ex.remove(); return; }
  const ov=document.createElement('div'); ov.id='helpov';
  ov.innerHTML=`<div class="help-card"><div class="help-h">Keyboard shortcuts</div>
    ${SHORTCUTS.map(([k,d])=>`<div class="help-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}
    <div style="text-align:right;margin-top:14px"><button class="btn" id="help-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#help-x').onclick=()=>ov.remove();
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
}
window.addEventListener('keydown',e=>{
  const pop=document.getElementById('pop');
  if(pop){
    if(e.key==='Escape'){ pop.querySelector('#ccancel').click(); return; }
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); pop._commit(); return; }
    if(e.altKey&&e.key>='1'&&e.key<='6'){ e.preventDefault(); pop._pickTag(+e.key-1); return; }
    return;
  }
  if(document.getElementById('helpov')&&e.key==='Escape'){ toggleHelp(); return; }
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable;
  if(typing){ if(e.key==='Escape') document.activeElement.blur(); return; }
  if(!document.getElementById('doc') && !['?','f'].includes(e.key)) return;   // comment nav needs an open chapter
  switch(e.key){
    case 'j': e.preventDefault(); cycleComment(1); break;
    case 'k': e.preventDefault(); cycleComment(-1); break;
    case 'Enter': { const c=review.comments.find(x=>x.id===activeId); if(c){ e.preventDefault(); jumpTo(c); } break; }
    case 'f': toggleFocus(); break;
    case '[': toggleNav(); break;
    case ']': toggleRail(); break;
    case '/': e.preventDefault(); document.getElementById('search')?.focus(); break;
    case '?': toggleHelp(); break;
  }
});
document.addEventListener('click', e => { if (e.target.closest('#btn-refresh')) doRefresh(); });   // refresh buttons across every topbar
boot();

// advisor.js — reviewer portal for a single named reviewer. Shows only the chapters released to
// them, lets them comment on text and figures and propose exact edits, and submits those back
// privately. Self-contained (only the anchor helper is shared) — no build tooling of any kind.
import { anchorFromSelection } from './anchor.js?v=a2ba4a9';
import { startTour, tourSeen, markTourSeen } from './tour.js?v=1dde05d';
import { wordDiff } from './textdiff.js?v=112b6a1';
import { loadConfig, dataRepoParts, loadChapters, setConfig, dataRepoFromParams, workspaceInviteBroken } from './config.js?v=f58d6b0';   // instance config + chapter manifest; assistant-free by construction
import { visibleUnitIds } from './releasegate.js?v=eeccf52';
import { livePollDelay } from './polldelay.js?v=d6ff0d6';   // one cadence policy for both portals   // appendices follow their home chapter's release (one rule, both portals)
import { attachmentsView } from './appattach.js?v=3a4f618';   // which appendix attaches to which chapter (source-derived; term-neutral)
import { keyFromSearch, searchWithoutKey, readReviewerKey, writeReviewerKey, clearReviewerKey, reviewerKeyWarning } from './invite.js?v=2a36cf4';   // magic-link: key in the invite URL + reviewer-key storage (own slot, not the owner ghpat)
import { makeSafeStore } from './safestore.js?v=43e41dd';   // never-throw storage so a blocked browser can't kill boot (F4)
import { initAccent, swatchesHtml, chooseAccent, storedAccent, celebrate } from './accent.js?v=609b2d1';   // per-viewer accent color (theme-only; no assistant)
import { parseVersion, latestFromHtml, isStale } from './version.js?v=b8a0753';
import { condJson, condRaw, condInvalidate } from './condfetch.js?v=acd31f3';
import { budgetLevel, budgetFactor, budgetSnapshot } from './ratebudget.js?v=dbe477a';   // the hourly budget is the OWNER's, shared across reviewers — ease off before it runs out   // conditional reads: a 304 costs no rate limit (the limit is per-USER, shared with the owner)   // stale-bundle refresh nudge
import { reviewingHeader, releaseView, validateKey, FIRST_RUN_TOUR, commentDraftKey } from './onboarding.js?v=8cb7d00';   // pure onboarding logic (header/state routing/key validation/first-run guide/draft key)
import { orderedUnits, mergeReviews as flattenReviews, routeWrite, wrapUnit, stripSegmentId } from './wholedoc.js?v=80e01b5';   // whole-document reader mirror (used on render + comment paths) — DO NOT drop; a bad merge once did and broke the reviewer
import { parseLatexTitle } from './docparse.js?v=c61fbc8';   // authoritative doc title = the LaTeX \title in the uploaded source
import { buildRefsSection } from './wholerefs.js?v=4260d4d';   // consolidate scattered per-unit reference lists into one at the end of the whole-doc
import { unitLabel, unitLabelWithTitle, unitTag } from './unitlabel.js?v=7d58e97';   // "Chapter 3"/"Appendix A", compact "3"/"A" — one label rule for both portals
import { brandMark } from './brandmark.js?v=a2aa2c8';   // the real Footnote logo (shared with the launcher)
import { recentsKey, recentsAdd, recentsList, linkFor, newCount, pickAuthorName } from './reviewerhome.js?v=5c25117';   // remembered documents for the reviewer Home
import { startWatch as startNetWatch } from './netstatus.js?v=0760473';
import { showBuildTag } from './buildinfo.js?v=2e84ce0';
import { readProgress, chapterMilestones, newMilestones } from './cardstats.js?v=cfa6c99';   // shared read-progress derivation (parity with author cards)
import { fetchWithTimeout, classifyGitHubError, retryAfterMs, TTLCache, orphanComments } from './nethelpers.js?v=a764ebc';   // bounded fetch + rate-limit backoff + read cache + orphan fallback
startNetWatch();
showBuildTag(import.meta.url);

// A sample chapter shown ONLY during the tour, so the reading + commenting features have real-looking
// content to point at even before any real chapter is released. Restored when the tour ends. The tour
// only spotlights and explains — nothing here is ever sent or saved.
function loadDemoChapter(){
  const el = document.getElementById('read'); if (!el) return () => {};
  const wasReading = !!document.querySelector('#doc');   // was a real chapter open before the demo?
  const cmt = document.getElementById('comments');
  const fig = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="520" height="200"><rect width="520" height="200" fill="#e9e7e1"/><text x="260" y="106" font-family="sans-serif" font-size="16" fill="#8f8d84" text-anchor="middle">Sample figure</text></svg>');
  el.innerHTML = `<article id="doc">
    <h1>${UNITC} 3 · Sample (tour preview)</h1>
    <p id="tour-demo-select">This preview ${UNIT} shows how reviewing works. Lorem ipsum dolor sit amet, consectetur adipiscing elit; radio-frequency heating enables rapid, volumetric energy delivery through a dielectric medium. Select any words here to attach a comment.</p>
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
        <div style="font-size:11px;color:var(--text-3)">§ ${UNITC} 3 · on "reviewing works"</div>
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
// One-time, skippable first-run guide: a brand-new reviewer sees the three-step gist BEFORE the detailed
// interactive tour. Steps are FIRST_RUN_TOUR data. "Show me" launches the full interactive walkthrough;
// "Got it" dismisses. Fires once (remembered via tourSeen/markTourSeen 'guide-advisor-v1').
function launchFirstRunGuide(onShowMe){
  if (document.getElementById('firstrun')) return;
  const ov = document.createElement('div'); ov.id = 'firstrun';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:18px';
  const steps = FIRST_RUN_TOUR.map(s => `<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
      <div style="flex:0 0 26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center">${s.step}</div>
      <div style="min-width:0"><div style="font-size:14px;font-weight:600;margin-bottom:2px">${escapeHtml(s.title)}</div>
      <div style="font-size:12.5px;color:var(--text-2);line-height:1.5">${escapeHtml(s.body)}</div></div></div>`).join('');
  ov.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Welcome to Footnote" style="background:var(--bg);border:.5px solid var(--border-2);border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.3);width:min(440px,94vw);padding:24px 24px 20px">
      <div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">WELCOME</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:16px">Reviewing here takes three steps</div>
      ${steps}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn" id="fr-skip">Got it</button>
        <button class="btn btn-primary" id="fr-show">Show me</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); close(); } };
  ov.querySelector('#fr-skip').onclick = close;
  ov.querySelector('#fr-show').onclick = () => { close(); try { (onShowMe || launchAdvisorTour)(); } catch {} };
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey, true);
}
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
  tag:c.tag||'other', body:c.body||'', status:c.status||'submitted', author:c.author||null, edit:c.edit||null, created_ts:new Date().toISOString() }] });   // 'submitted' = shared with the author (no submit step); 'open' would be hidden as a draft. Explicit status wins.
const updateComment = (r, id, patch) => ({ ...r, comments:r.comments.map(c => c.id===id ? { ...c, ...patch } : c) });
const deleteComment = (r, id) => ({ ...r, comments:r.comments.filter(c => c.id!==id), deleted:[...new Set([...(r.deleted||[]), id])] });
// --- data-repo I/O (self-contained) ---
const _API='https://api.github.com';
let _OWNER='', _REPO='';   // populated from footnote.config.json at boot (before any fetch)
let _PREFIX='';   // consolidated-workspace project prefix ('<id>/') from the invite link's &p=<id>; '' for legacy
const _hdr = t => ({ Authorization:`Bearer ${t}`, Accept:'application/vnd.github+json' });
// Every reviewer-portal GitHub request is bounded (timeout + one transport retry) so a hung request can't
// freeze the portal forever, and non-ok responses throw an error carrying .status+.headers so callers can
// classify a 403 rate limit (F2/F3).
const _gfetch = (url, opts) => fetchWithTimeout(url, opts, { timeoutMs:15000, retries:1 });
const _ghErr = (r, ctx) => { const e = new Error((ctx||'GitHub')+' '+r.status); e.status = r.status; e.headers = r.headers; return e; };
// Stable URL (no ?t= buster) so an ETag can key it; condJson revalidates on every read and replays the
// cached bytes only when GitHub answers 304, so liveness is unchanged and an unchanged poll is free.
const _curl = path => `${_API}/repos/${_OWNER}/${_REPO}/contents/${_PREFIX}${path}`;
async function getJson(t, path){ return condJson(_curl(path), { headers:_hdr(t), token:t, fetchImpl:_gfetch }); }
async function putJson(t, path, obj, sha, msg, autoRetry=true){ condInvalidate(_curl(path)); const content=btoa(unescape(encodeURIComponent(JSON.stringify(obj,null,2)))); const put=s=>_gfetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${_PREFIX}${path}`,{method:'PUT',headers:_hdr(t),body:JSON.stringify({message:msg,content,sha:s||undefined})}); let r=await put(sha); if(r.status===409&&autoRetry){ try{ const cur=await getJson(t,path); r=await put(cur.sha); }catch(e){} } if(!r.ok) throw _ghErr(r,'put failed:'); condInvalidate(_curl(path)); return (await r.json()).content.sha; }
// binary file I/O (PNG markups) — self-contained, mirrors the JSON helpers above
async function _getSha(t, path){ try{ const r=await _gfetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${_PREFIX}${path}?t=${Date.now()}`,{headers:_hdr(t),cache:'no-store'}); if(!r.ok) return null; return (await r.json()).sha; }catch(e){ return null; } }
async function putFile(t, path, base64, msg){ condInvalidate(_curl(path)); const put=s=>_gfetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${_PREFIX}${path}`,{method:'PUT',headers:_hdr(t),body:JSON.stringify({message:msg,content:base64,sha:s||undefined})}); const r=await put(await _getSha(t,path)); if(!r.ok) throw _ghErr(r,'put file failed:'); return (await r.json()).content.sha; }
async function getDataUrl(t, path, mime='image/png'){ const r=await _gfetch(`${_API}/repos/${_OWNER}/${_REPO}/contents/${_PREFIX}${path}?t=${Date.now()}`,{headers:_hdr(t),cache:'no-store'}); if(!r.ok) throw _ghErr(r); const d=await r.json(); return `data:${mime};base64,`+(d.content||'').replace(/\s/g,''); }
// Request thrift (Model-A scale fix): rendered reading-view HTML (content/<id>.html) is immutable until
// the author re-renders, yet it's the most-refetched file — single-chapter open, then whole-doc re-reads
// EVERY unit again. A short-TTL in-memory cache de-dupes those bursts so a solo reviewer refreshing
// whole-doc doesn't burn the shared 5000/hr budget. Keyed by data-repo path (cachebust `?t=` stripped).
const _rawCache = new TTLCache(60000);   // 60s: long enough to collapse a refresh burst, short enough to see a fresh render
async function _rawText(t, path){
  const cached = _rawCache.get(path); if (cached !== undefined) return cached;
  // past the TTL we still ASK GitHub (so a re-render is picked up), but conditionally: unchanged = free
  const g = await condRaw(_curl(path), { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, token:t, fetchImpl:_gfetch });
  if (!g.ok) throw _ghErr({ status:g.status });
  _rawCache.set(path, g.text); return g.text;
}
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
let DATA_REPO = '';        // populated from footnote.config.json at boot
let CHAPTERS = [];         // the adopter's chapter manifest (config.chapters), populated at boot
let HAS_OUTLINE = false;   // whether the data repo ships an outline.json with chapters — gates the home outline card (journals have none)
// whole-document ("read the whole paper") view: WHOLE active; _reviews holds every RELEASED unit's review
// (per-chapter files stay separate); comments resolve within their own #wd-<id> segment and route back to
// the owning chapter's advisor/<id>/<ch>.json. Live sync off in this view (v1).
let WHOLE = false;
const _reviews = {};       // chapterId -> this reviewer's review for that chapter
let _wholeUnits = [];      // released units currently assembled
const chapterIdOfNode = node => { const el = node && (node.nodeType===1?node:node.parentElement); const seg = el && el.closest && el.closest('.wd-chapter'); return seg ? stripSegmentId(seg.id) : null; };
let DOC = '', DOCC = '', UNIT = '', UNITC = '';   // document nouns for copy (config.doc), populated at boot
const chMeta = id => CHAPTERS.find(c => c.id === id) || (id === '__outline__' ? { n:'·', title:'Proposed outline' } : id === '__whole__' ? { n:'·', title:'Whole document' } : { n:'?', title:id });
const TAGS = ['suggestion','wording','figure','question','clarity','citation'];
const shortTitle = t => { const s = t.split(':')[0].trim(); return s.length <= 34 ? s : s.slice(0,34).replace(/\s\S*$/,'') + '…'; };
const escapeHtml = s => (s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
// platform-adaptive modifier label (handlers accept ⌘ or Ctrl; this is just the on-screen text)
const IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const fmtDate = ts => { if(!ts) return ''; const d=new Date(ts); if(isNaN(d)) return ''; return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };

const read = document.getElementById('read');
let current = null, review = null, released = [], responsesReleased = false;
const _store = makeSafeStore();   // Safari Private / storage-blocked degrades to in-memory instead of throwing
const tok = () => readReviewerKey(_store);   // reviewer key from its own slot (falls back to legacy ghpat)
// Honest, dismissible notice when the browser blocks storage — never a blank page (Lane E F4).
function storageWarn(){
  if (typeof document === 'undefined' || document.getElementById('storewarn')) return;
  const b = document.createElement('div'); b.id = 'storewarn';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fbecea;color:#8a2a22;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 34px 8px 14px;text-align:center;border-bottom:1px solid #e7b7b0';
  b.textContent = 'Your browser is blocking storage (Private Browsing?). You can review now, but this device may not remember your access — reopen the emailed link if you come back.';
  const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Dismiss');
  x.style.cssText = 'position:absolute;right:8px;top:4px;border:0;background:none;color:#8a2a22;font-size:18px;line-height:1;cursor:pointer';
  x.onclick = () => b.remove(); b.append(x);
  document.body.prepend(b);
}
let _CFG = null;   // the effective instance config (set at boot) — powers the "what am I reviewing?" header
// In-page access-key entry (replaces native prompt()): paste-friendly, visible focus, validated inline,
// mobile-friendly. opts: { current, allowClear }. Resolves the trimmed key on Save (or '' when cleared),
// or null on Cancel. Uses validateKey so a whole pasted invite URL is reduced to just the key.
function keyModal({ current = '', allowClear = false, title = 'Enter your access key' } = {}){
  return new Promise(resolve => {
    document.getElementById('keymodal')?.remove();
    const back = document.createElement('div'); back.id = 'keymodal';
    back.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;padding:18px';
    back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" style="background:var(--bg);border:.5px solid var(--border-2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(430px,94vw);padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:4px">${escapeHtml(title)}</div>
      <div style="font-size:12.5px;color:var(--text-3);line-height:1.55;margin-bottom:14px">Paste the access key from your invitation email. It's stored only in this browser.</div>
      <input id="km-in" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ghp_…" value="${escapeHtml(current || '')}"
        style="width:100%;box-sizing:border-box;padding:11px 12px;border:.5px solid var(--border-2);border-radius:9px;font:inherit;font-size:14px;background:var(--bg);color:var(--text);outline:none">
      <div id="km-err" style="min-height:16px;font-size:12px;color:var(--danger,#c0392b);margin:7px 2px 0"></div>
      <div id="km-warn" style="font-size:12px;color:#8a5a00;line-height:1.5;margin:0 2px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px">
        ${allowClear ? `<button class="btn" id="km-clear" style="margin-right:auto;color:var(--text-3)">Remove key</button>` : ''}
        <button class="btn" id="km-cancel">Cancel</button>
        <button class="btn btn-primary" id="km-save">Save key</button></div></div>`;
    document.body.appendChild(back);
    const inp = back.querySelector('#km-in'), err = back.querySelector('#km-err'), warn = back.querySelector('#km-warn');
    const showWarn = () => { if (warn) warn.textContent = reviewerKeyWarning(inp.value); };
    showWarn();
    const done = v => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const save = () => { const r = validateKey(inp.value); if (!r.ok){ err.textContent = r.error; inp.style.borderColor = 'var(--danger,#c0392b)'; inp.focus(); return; } done(r.value); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); done(null); } };
    back.querySelector('#km-save').onclick = save;
    back.querySelector('#km-cancel').onclick = () => done(null);
    back.querySelector('#km-clear')?.addEventListener('click', () => done(''));
    inp.addEventListener('input', () => { err.textContent = ''; inp.style.borderColor = 'var(--accent)'; showWarn(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); save(); } });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}
// Store a chosen key (or clear it) and re-boot. Central handler behind every "enter/change key" control,
// so the whole portal shares one humane, validated entry path. v===null → cancelled (no change).
function applyKeyChoice(v){
  if (v === null) return;
  if (v){ if (!writeReviewerKey(_store, v)) storageWarn(); keyBad = false; }
  else { clearReviewerKey(_store); }
  boot();
}
let keyBad = false, revoked = false;
const is401 = e => /\b401\b/.test((e && e.message) || '');
function showKeyExpired(){
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">${DOCC} review · ${escapeHtml(ADVISOR.name)}</strong>`;
  read.innerHTML = `<div class="empty"><i class="ti ti-key-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Your access key has expired</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px;max-width:430px">Access keys are time-limited for security. Please request a fresh key, then enter it below to pick up where you left off — your comments are saved.</div>
    <button class="btn btn-primary" id="newkey">Enter a new key</button></div>`;
  read.querySelector('#newkey').onclick = async () => { applyKeyChoice(await keyModal({ title: 'Enter a new access key' })); };
}
function showRevoked(){
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">${DOCC} review</strong>`;
  read.innerHTML = `<div class="empty" style="max-width:460px;margin:12vh auto;text-align:center"><i class="ti ti-lock-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">This review link is no longer active</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-3)">Access for this reviewer has been removed by the author. If you think this is a mistake, please contact them for a new invitation.</div></div>`;
}
// CRITICAL guard: boot() loads config/chapters/release over the network; any throw (offline, captive
// wifi, a CDN/Pages hiccup, a malformed response) used to leave the reviewer on a permanent BLANK page
// with no error and no retry — the worst first impression on "I clicked the email link on my phone".
// This renders an honest, retryable screen instead. Config-independent (boot may fail before config loads).
function showBootError(err){
  try { console.error('Footnote boot failed:', err); } catch(e){}
  try { const n = document.getElementById('nav'); if (n) n.style.display = 'none'; } catch(e){}
  try { const c = document.getElementById('comments'); if (c) c.style.display = 'none'; } catch(e){}
  try { const tb = document.getElementById('topbar'); if (tb) tb.innerHTML = `<strong style="font-size:16px;font-weight:600">Review</strong>`; } catch(e){}
  const host = (typeof read !== 'undefined' && read) || document.getElementById('read') || document.body;
  host.innerHTML = `<div class="empty" style="max-width:460px;margin:12vh auto;text-align:center"><i class="ti ti-cloud-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Couldn’t load this review</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-3)">We couldn’t reach the document — usually a network blip or a captive-wifi login screen. Check your connection, then try again.</div>
    <button id="bootretry" style="margin-top:14px;background:var(--accent,#2c64c4);color:#fff;border:0;border-radius:8px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer">Try again</button></div>`;
  try { const b = document.getElementById('bootretry'); if (b) b.onclick = () => location.reload(); } catch(e){}
}
// F7 — the invite link is missing its project (&p=). The data repo is a workspace holding several
// projects under subfolders, but this link didn't say which one, so it points at the empty repo root.
// Tell the reviewer the truth (the link is broken) with a concrete next step, not a silent "nothing shared".
function showLinkBroken(){
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">${DOCC} review</strong>`;
  read.innerHTML = `<div class="empty" style="max-width:460px;margin:12vh auto;text-align:center"><i class="ti ti-link-off" style="font-size:26px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">This invite link is missing its project</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-3)">Your link opened the right workspace but didn't say which document to review, so there's nothing to show. Please ask the author to resend your invitation — the new link will take you straight to it.</div></div>`;
}
// One tree read to tell "broken invite" (workspace has projects) apart from "genuinely fresh repo" (empty).
// Cheap and only runs on the no-&p=, no-root-chapters cold path — never on the happy path.
async function _repoTreePaths(t){
  try {
    const r = await _gfetch(`${_API}/repos/${_OWNER}/${_REPO}/git/trees/main?recursive=1&t=${Date.now()}`, { headers:_hdr(t), cache:'no-store' });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.tree||[]).filter(x => x.type==='blob').map(x => x.path);
  } catch(e){ return []; }
}
const reviewPath = ch => `advisor/${effId()}/${ch}.json`;
const localKey = ch => `adv:${effId()}:${ch}`;
const loadLocal = ch => JSON.parse(localStorage.getItem(localKey(ch)) || 'null') || newReview(ch, '');
const save = () => localStorage.setItem(localKey(current), JSON.stringify(review));
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
initAccent();   // apply the reviewer's own accent (ac-<id> class; the palette CSS handles light/dark)

// ---------- sync (this reviewer's own comment file only) ----------
let reviewSha = null, syncTimer = null;
// Rate-limit backoff (F2): the shared reviewer key draws on ONE 5000/hr GitHub budget for the whole
// committee, so a 403/429 must NOT surface as a generic "not saved" error — pause the poll until the
// limit resets and show an honest "reconnecting" banner. When it clears, we resume and hide the banner.
let _rlUntil = 0;   // ms epoch; while now < _rlUntil we are rate-limited
const _isRateLimited = () => Date.now() < _rlUntil;
function _enterRateLimit(headers){ _rlUntil = Date.now() + Math.max(20000, retryAfterMs(headers)); renderRateBanner(); }
function _clearRateLimit(){ if (_rlUntil){ _rlUntil = 0; renderRateBanner(); } }
function renderRateBanner(){
  let el = document.getElementById('ratebanner');
  if (!_isRateLimited()){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'ratebanner';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff6e5;color:#8a5a12;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:9px 14px;text-align:center;border-top:1px solid #f0d9a8';
    document.body.appendChild(el); }
  el.innerHTML = '<i class="ti ti-cloud-pause"></i> GitHub is busy (usage limit) — reconnecting automatically. Your comments are saved and will sync when it clears.';
}
async function syncDown(){ const t = tok(); if (!t || _isRateLimited()) return;
  try { const { json, sha } = await getJson(t, reviewPath(current)); reviewSha = sha; _clearRateLimit();
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
  catch(e){ const c = classifyGitHubError(e); if (c.rateLimited) _enterRateLimit(c.headers); /* else: first time / offline */ } }
// Live polling: re-pull the author's replies/resolutions on a cadence + when the tab refocuses.
// Guard: skip the poll while the reviewer is mid-write (a comment popover is open, or a textarea in the
// comment area has focus) so a re-render never yanks their cursor. Data is already merge-safe in syncDown.
// Self-scheduling loop (not a fixed interval) so we can THROTTLE: the base cadence is 20s, but it backs
// off toward 60s while the reviewer is idle (no changes seen), and while rate-limited it waits for the
// reset — this is the Model-A scale fix that keeps the shared key viable for a committee.
let livePollTimer = null, _pollBase = 20000, _idlePolls = 0, _liveOn = false;
function isAdvisorBusy(){
  if (typeof pending !== 'undefined' && pending) return true;
  const a = document.activeElement;
  return !!(a && a.tagName === 'TEXTAREA');
}
function _nextPollDelay(){
  if (_isRateLimited()) return Math.max(5000, _rlUntil - Date.now());   // wait out the limit, re-check near reset
  // shared policy with the author portal: idle ramp 20s → 30s → 45s → 60s, widened further while the
  // owner's hourly budget (which every reviewer draws on) is running low
  return livePollDelay({ idlePolls: _idlePolls, base: _pollBase, factor: budgetFactor(budgetLevel(budgetSnapshot())) });
}
async function livePoll(){
  if (!tok() || document.hidden || isAdvisorBusy()){ _idlePolls++; return; }
  const before = JSON.stringify(review.comments || []);
  await syncDown();
  if (JSON.stringify(review.comments || []) === before) _idlePolls++; else _idlePolls = 0;   // reset cadence on any change
}
function _scheduleLivePoll(){ if (!_liveOn) return; clearTimeout(livePollTimer); livePollTimer = setTimeout(async () => { try { await livePoll(); } catch(e){} _scheduleLivePoll(); }, _nextPollDelay()); }
function startLiveSync(){ stopLiveSync(); _liveOn = true; _idlePolls = 0; _scheduleLivePoll(); }
function stopLiveSync(){ _liveOn = false; if (livePollTimer){ clearTimeout(livePollTimer); livePollTimer = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden){ _idlePolls = 0; livePoll(); } });
// a local mutation isn't safe until confirmed on GitHub — flag it, persist, and schedule a push
// the "unsaved" banner is driven purely by sync OUTCOME — syncUp clears it on a confirmed PUT
// and raises it on a real failure, and the 30s heartbeat surfaces genuinely-stuck chapters.
// markDirty never shows it, so a normal (even slow) save never flashes a warning.
function markDirty(){ review.pending = true; review.last_active = new Date().toISOString(); save(); syncUpSoon(); }
function syncUpSoon(){ if (!tok()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncUp(), 1200); }
// read-modify-merge push: returns true only when GitHub confirms (2xx). Never clobbers owner edits.
async function syncUp(){ const t = tok(); if (!t || _isRateLimited()) return false;   // rate-limited: leave it pending, retryPending re-pushes when it clears
  const path = reviewPath(current), label = effId();
  for (let attempt = 0; attempt < 5; attempt++){
    let remote = null, sha = reviewSha;
    try { const g = await getJson(t, path); remote = g.json; sha = g.sha; }
    catch(e){ if (is401(e)){ keyBad = true; renderBanner(); return false; }
      const c = classifyGitHubError(e); if (c.rateLimited){ _enterRateLimit(c.headers); return false; }   // data stays pending; no error banner
      /* non-401 (404 / empty / corrupt remote): don't reuse a stale sha — refetch the real one so the PUT can overwrite */
      sha = await _getSha(t, path); }
    const merged = mergeReviews(remote, review);
    try { reviewSha = await putJson(t, path, merged, sha, `review(${label}): ${current}`, false);
      merged.pending = false; review = merged; save(); renderBanner(); return true; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r => setTimeout(r, 250*(attempt+1))); continue; }
      const c = classifyGitHubError(e); if (c.rateLimited){ _enterRateLimit(c.headers); return false; }   // leave pending, don't cry "not saved"
      renderBanner(); return false; }
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
  el.innerHTML = `<i class="ti ti-cloud-up"></i><span>${n} ${UNIT}${n>1?'s have':' has'} comments not yet saved to the server; keep this browser open.</span><button id="syncretry">Retry now</button>`;
  el.querySelector('#syncretry').onclick = () => { el.querySelector('#syncretry').textContent = 'Retrying…'; retryPending(); };
}

// ---------- release gate + content ----------
async function loadRelease(){
  const t = tok();
  if (location.hostname==='localhost'||location.hostname==='127.0.0.1'){ try { const r=await fetch('./release.json'); if(r.ok){ apply(await r.json()); return; } } catch(e){} }
  if (!t){ released = []; return; }
  try { const r = await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}release.json?t=${Date.now()}`,{ headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (r.status === 401){ keyBad = true; return; }
    if (r.ok) apply(await r.json()); } catch(e){ released = []; }
  function apply(j){ if (j && typeof j === 'object' && !(RELEASE_ID in j)){ revoked = true; return; }   // no gate entry → this reviewer was removed
    const raw = (j?.[RELEASE_ID]?.released) || [];
    const ov = (j?.[RELEASE_ID]?.appendix_override) || {};
    // Appendices are released with their home chapter (unless pinned show/hide). Fall back to the raw list
    // if the manifest isn't loaded yet, so chapters are never lost.
    released = CHAPTERS.length ? visibleUnitIds(CHAPTERS, raw, ov) : raw;
    responsesReleased = !!(j?.[RELEASE_ID]?.responses_released); }
}
function doRefresh(){ try{ sessionStorage.setItem('_resume', current||''); }catch(e){} const u = new URL(location.href); u.searchParams.set('_r', Date.now()); location.replace(u.toString()); }   // reload for a fresh deploy, keeping your place
async function loadChapter(ch){
  if (ch === '__outline__'){ WHOLE = false; loadOutline(); return; }   // the outline isn't a real chapter
  if (ch === '__whole__'){ loadWholeDoc(); return; }                    // the whole-document view assembles every released unit
  WHOLE = false;
  current = ch; review = loadLocal(ch);
  read.innerHTML = `<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading ${unitLabel(chMeta(ch), UNIT)}…</div></div>`;
  document.getElementById('nav').style.display=''; document.getElementById('comments').style.display='';
  renderTopbar(); renderComments();
  const dev = location.hostname==='localhost'||location.hostname==='127.0.0.1';
  if (dev){ try { const r=await fetch(`./chapters/${ch}.html`); if(r.ok){ renderDoc(await r.text()); renderChapterAppendices(ch); return; } } catch(e){} }
  const t = tok(); if (!t){ renderConnect(); return; }
  try { renderDoc(await _rawText(t, `content/${ch}.html`)); renderChapterAppendices(ch); }
  catch(e){ if (is401(e)) return showKeyExpired();
    const c = classifyGitHubError(e);
    if (c.status === 404){                       // the rendered HTML isn't in the data repo yet — reading view not built
      read.innerHTML = `<div class="empty"><i class="ti ti-file-code" style="font-size:24px;color:var(--text-3)"></i>
        <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Reading view not built yet</div>
        <div style="font-size:13px;line-height:1.6;max-width:420px;margin:0 auto">The author has released this ${escapeHtml(UNIT)}, but its reading view is still being prepared. Check back shortly — it'll appear here automatically once it's ready.</div></div>`;
      return; }
    if (c.rateLimited){                          // shared-budget exhaustion — don't read like a broken link
      read.innerHTML = `<div class="empty"><i class="ti ti-cloud-off" style="font-size:24px;color:var(--text-3)"></i>
        <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Reconnecting…</div>
        <div style="font-size:13px;line-height:1.6;max-width:420px;margin:0 auto">GitHub is briefly rate-limiting this review. Give it a moment, then reopen this ${escapeHtml(UNIT)}.</div></div>`;
      return; }
    read.innerHTML = `<div class="empty">Couldn't load ${unitLabel(chMeta(ch), UNIT)} (${escapeHtml(e.message)}). Check your access link.</div>`; }
}
function renderConnect(){
  read.innerHTML = `<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Enter your access key</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Paste the access key you were emailed. It's stored only in this browser.</div>
    <button class="btn" id="connect">Add access key</button></div>`;
  document.getElementById('connect').onclick = async () => { applyKeyChoice(await keyModal({})); };
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
// After a chapter is painted, show each appendix HOMED here inline (collapsible, expanded) and a link card
// for appendices this chapter cites but that are homed elsewhere. Only RELEASED appendices appear (release
// coupling puts an appendix into `released` with its home chapter). Rendered like a chapter (math/figures/
// citations/cross-refs). Fetched inside the #doc reading column so widths match.
async function renderChapterAppendices(ch){
  const meta = chMeta(ch);
  if (!meta || meta.kind === 'appendix') return;                 // an appendix opened on its own doesn't recurse
  const view = attachmentsView(CHAPTERS);
  const cites = (view.byChapter[ch] || []).filter(id => released.includes(id));   // reviewer sees only released units
  if (!cites.length) return;
  const dev = location.hostname==='localhost'||location.hostname==='127.0.0.1';
  const t = tok();
  if (!dev && !t) return;
  const fetchAppendix = async (appId) => {
    if (dev){ try { const r = await fetch(`./chapters/${appId}.html`); if (r.ok) return await r.text(); } catch(e){} }
    if (!t) return null;
    try { return await _rawText(t, `content/${appId}.html`); } catch(e){ return null; }
  };
  const homed = cites.filter(appId => view.homeOf[appId] === ch);
  const htmlById = {};
  await Promise.all(homed.map(async appId => { htmlById[appId] = await fetchAppendix(appId); }));
  if (current !== ch) return;                                     // reviewer switched units mid-fetch
  const wrap = document.createElement('div');
  wrap.className = 'appx-attached';
  for (const appId of cites){
    const am = chMeta(appId);
    const label = `${unitLabel(am, UNIT)} · ${escapeHtml(shortTitle(am.title))}`;
    if (view.homeOf[appId] === ch){
      const block = document.createElement('details');
      block.className = 'appx-block'; block.open = true;
      const html = htmlById[appId];
      const body = html != null ? html : `<div class="empty" style="font-size:12px">This appendix’s reading view is still being prepared.</div>`;
      block.innerHTML = `<summary class="appx-sum">${label}</summary><div class="appx-body">${body}</div>`;
      wrap.appendChild(block);
      if (html != null){ const bodyEl = block.querySelector('.appx-body'); fixFootnotes(bodyEl); runKatex(bodyEl); wireFigures(bodyEl); wireCitations(bodyEl); linkCrossRefs(bodyEl); }
    } else {
      const card = document.createElement('button');
      card.className = 'appx-card'; card.dataset.ch = appId;
      card.innerHTML = `<span>${label}</span><span class="appx-arrow">→</span>`;
      card.onclick = () => loadChapter(appId);
      wrap.appendChild(card);
    }
  }
  (read.querySelector('#doc') || read).appendChild(wrap);
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
    pending={ quote: info.label?`${info.label}${info.quote?': '+info.quote:''}`:(info.quote||'Figure'), kind:'figure', figure:info.id, section:headingFor(fig), confirmed:true, rects:[], chapterId: WHOLE?chapterIdOfNode(fig):null }; showPopover(pending,rects,'figure',fig); }); });
  // tables and display equations are commentable too (no drawing — they carry no raster image)
  doc.querySelectorAll('table, .katex-display').forEach(el=>{ if(el.dataset.blkWired) return; if(el.closest('figure')?.dataset.figWired) return; el.dataset.blkWired='1'; el.classList.add('blk-commentable');
    el.addEventListener('click',e=>{ if(window.getSelection().toString().trim()) return; e.stopPropagation(); document.getElementById('pop')?.remove();
      const isTable=el.tagName==='TABLE'; let label='', quote='';
      if(isTable){ const cap=el.querySelector('caption')?.textContent.trim()||el.closest('figure')?.querySelector('figcaption')?.textContent.trim()||''; const m=cap.match(/^\s*Table\s+[\d.]+/i); label=m?m[0].trim():'Table'; quote=cap.slice(0,150)||'Table'; }
      else { const num=(el.querySelector('.tag, .eqn-num')?.textContent||'').replace(/[()]/g,'').trim(); label=num?`Equation (${num})`:'Equation'; quote=(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120)||'Equation'; }
      const rr=read.getBoundingClientRect(), fr=el.getBoundingClientRect(); const rects=[{x:fr.x-rr.x,y:fr.y-rr.y+read.scrollTop,w:fr.width,h:fr.height}];
      pending={ quote: label?`${label}: ${quote}`:quote, kind:'figure', figure:label, section:headingFor(el), confirmed:true, rects:[], chapterId: WHOLE?chapterIdOfNode(el):null }; showPopover(pending,rects,'figure'); }); }); }
// Key by the unit's TAG, not its raw .n: a chapter is unchanged ("3.1"), an appendix keys "A.1" rather than
// colliding with chapter 1's sections. (Inert for appendices until linkCrossRefs matches letter refs.)
function sectionNumberMap(doc){ const n=unitTag(chMeta(current)); const map={}; let h2=0,h3=0; doc.querySelectorAll('h2, h3').forEach(h=>{ if(h.tagName==='H2'){h2++;h3=0;map[`${n}.${h2}`]=h;} else {h3++;map[`${n}.${h2}.${h3}`]=h;} }); return map; }
function figTableMaps(doc){ const fig={},tab={}; doc.querySelectorAll('figure').forEach(f=>{ const m=(f.querySelector(':scope > figcaption')?.textContent||'').match(/^\s*Figure\s+(\d+(?:\.\d+)*)\./); if(m) fig[m[1]]=f; });
  doc.querySelectorAll('table caption, figcaption').forEach(c=>{ const m=c.textContent.match(/^\s*Table\s+(\d+(?:\.\d+)*)\./); if(m) tab[m[1]]=c.closest('figure')||c.closest('table')||c; }); return {fig,tab}; }
function linkCrossRefs(doc){
  // curTag, not raw .n: in an appendix (n=1..5) a digit ref like "Section 1.2" means CHAPTER 1, never this
  // appendix's own section — comparing tags ("A" vs "1") stops that false self-match.
  const secMap=sectionNumberMap(doc), ftMap=figTableMaps(doc), curTag=unitTag(chMeta(current));
  const re=/\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+(\d+(?:\.\d+)*)/gi, reTest=/\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+\d/i;
  const walker=document.createTreeWalker(doc,NodeFilter.SHOW_TEXT,{ acceptNode:t=>{ if(!t.nodeValue.trim()||!reTest.test(t.nodeValue)) return NodeFilter.FILTER_REJECT; const bad=t.parentElement?.closest('a, h1, h2, h3, figcaption, .math, .katex, #footnotes, script, style'); return bad?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT; } });
  const todo=[]; let node; while((node=walker.nextNode())) todo.push(node);
  todo.forEach(text=>{ const frag=document.createDocumentFragment(); let last=0; const s=text.nodeValue; re.lastIndex=0; let m;
    while((m=re.exec(s))){ const kw=m[1], num=m[2], head=num.split('.')[0]; const isFig=/^Fig/i.test(kw), isTab=/^Tab/i.test(kw), isChap=/^Chap/i.test(kw); const self=head===curTag; let handler=null;
      if(isFig||isTab){ if(self){ const t=(isFig?ftMap.fig:ftMap.tab)[num]; if(t) handler=()=>scrollFlash(t); } }
      else if(!isChap){ if(self){ const h=secMap[num]; if(h) handler=()=>scrollFlash(h); } }
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
  if(hs.length && review.secCount!==hs.length){ review.secCount=hs.length; save(); }   // persist section total so the home card can show read-progress
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
      markDirty(); buildNav(); checkMilestones(); };
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
  pending=anchorFromSelection({text,page:null,rects}); pending.section=headingFor(range.startContainer); pending.chapterId = WHOLE ? chapterIdOfNode(range.startContainer) : null; showPopover(pending,rects); }
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
  // Draft-save — a half-written comment survives an accidental refresh: restore any draft for this passage,
  // persist on each keystroke, clear it once the comment is saved or the composer is cancelled.
  const _dkey = commentDraftKey(anchor.chapterId || current, anchor);
  try { const _d = _store.get(_dkey); if (_d){ const o = JSON.parse(_d); if (o && o.body) body.value = o.body; if (o && o.repl) repl.value = o.repl; } } catch (e) {}
  const _saveDraft = () => { try { (body.value || repl.value) ? _store.set(_dkey, JSON.stringify({ body: body.value, repl: repl.value })) : _store.remove(_dkey); } catch (e) {} };
  body.addEventListener('input', _saveDraft); repl.addEventListener('input', _saveDraft);
  const _clearDraft = () => { try { _store.remove(_dkey); } catch (e) {} };
  const setMode=m=>{ mode=m; pop.querySelectorAll('#pmodes button').forEach(b=>b.classList.toggle('on',b.dataset.m===m)); const nr=m==='replace'||m==='insert'; repl.style.display=nr?'block':'none';
    repl.placeholder=m==='replace'?'Exact replacement text (verbatim)…':'Exact text to insert after the selection (verbatim)…'; body.placeholder=m==='note'?`Leave a comment…  (⌥1–6 to tag · ${MOD}↵ to save)`:'Optional note for this edit…';
    saveBtn.textContent=m==='note'?'Comment':m==='delete'?'Suggest deletion':m==='insert'?'Suggest insertion':'Suggest replacement'; saveBtn.className='btn '+(m==='delete'?'btn-danger':m==='note'?'btn-primary':'btn-suggest');
    pop.querySelector('#psnip').style.textDecoration=m==='delete'?'line-through':'none'; (nr?repl:body).focus(); };
  pop.querySelectorAll('#pmodes button').forEach(b=>b.onclick=()=>setMode(b.dataset.m)); body.focus();
  pop.querySelector('#ccancel').onclick=()=>{ _clearDraft(); pop.remove(); window.getSelection().removeAllRanges(); };
  pop.querySelector('#figdraw')?.addEventListener('click',()=>{ pop.remove(); openFigureMarkup(figEl,anchor); });
  pop._commit=()=>saveBtn.click(); pop._pickTag=i=>{ const b=tr.children[i]; if(b) b.click(); };
  saveBtn.onclick=()=>{ let edit=null;
    if(mode==='replace') edit={op:'replace',find:anchor.quote,replacement:repl.value};
    else if(mode==='insert') edit={op:'insert',find:anchor.quote,position:'after',replacement:repl.value};
    else if(mode==='delete') edit={op:'delete',find:anchor.quote,replacement:''};
    if(edit&&mode!=='delete'&&!repl.value.trim()){ flash('Enter the '+(mode==='insert'?'text to insert':'replacement text')+'.'); return; }
    const fields={ anchor:pending, kind:edit?'suggestion':pending.kind, tag:edit?'edit':tag, body:body.value, edit, author:authorId(), status:'submitted' };
    if(WHOLE){ createWholeComment(pending.chapterId, fields); _clearDraft(); pop.remove(); window.getSelection().removeAllRanges(); return; }
    review=addComment(review,fields); _clearDraft();
    markDirty(); renderComments(); buildNav(); paintHighlights(); pop.remove(); window.getSelection().removeAllRanges(); };
}

// ---------- draw-on-figure markup (capture-only: composites figure + strokes → PNG) ----------
const markupCache = {};   // path -> dataURL, so a freshly-drawn markup shows instantly
function openFigureMarkup(fig, anchor){
  if (WHOLE && !anchor.chapterId){ flash(`Couldn't tell which ${UNIT} this figure is in — reopen it and try again.`); return; }   // whole-doc: the markup routes to anchor.chapterId's review
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
      // whole-doc: route the markup to the figure's OWN chapter review; else the current chapter.
      const chId = WHOLE ? anchor.chapterId : null;
      let rev = addComment(chId ? routeWrite(_reviews, chId, id => loadLocal(id)) : review, { anchor, kind:'figure', tag:'figure', body:note, author:authorId() });
      const c = rev.comments[rev.comments.length-1];
      const path = `markups/${c.id}.png`; markupCache[path] = dataUrl;
      rev = updateComment(rev, c.id, { markup:{ path, ts:new Date().toISOString() } });
      const t = tok();
      if (chId){
        rev.pending = true; rev.last_active = new Date().toISOString();
        _reviews[chId] = rev; localStorage.setItem(localKey(chId), JSON.stringify(rev));
        paintWholeHighlights(); buildNavWhole(); renderWholeComments(); ov.remove();
        if (t){ await putFile(t, path, b64, `markup: ${effId()} ${c.id}`); await pushChapterReviewAdv(chId); flash('Markup saved.'); }
        else flash('Markup saved locally — add your access key to upload it.');
      } else {
        review = rev; markDirty(); renderComments(); buildNav(); paintHighlights(); ov.remove();
        if (t){ await putFile(t, path, b64, `markup: ${effId()} ${c.id}`); flash('Markup saved.'); }
        else flash('Markup saved locally — add your access key to upload it.');
      }
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
  if(editingId===c.id){ card.appendChild(editCard(c, (body,tag)=>{ review=updateComment(review,c.id,{body,tag}); editingId=null; markDirty(); renderComments(); buildNav(); paintHighlights(); })); return card; }
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
function editCard(c, onSave){ const w=document.createElement('div');
  w.innerHTML=`<textarea id="ebody" style="width:100%;border:.5px solid var(--accent);border-radius:6px;padding:7px;font:inherit;background:var(--bg);color:var(--text);min-height:54px;outline:none">${escapeHtml(c.body)}</textarea>
    <div id="etags" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-primary" id="esave" style="padding:5px 13px;font-size:12px">Save</button><button class="btn" id="ecancel" style="padding:5px 13px;font-size:12px">Cancel</button></div>`;
  let etag=c.tag; const tr=w.querySelector('#etags');                       // re-tag from the edit card, per-tag colored like the owner
  TAGS.forEach(t=>{ const b=document.createElement('button'); b.textContent=t; b.style.cssText='font-size:11.5px;padding:3px 11px;border-radius:20px;border:.5px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer';
    const pick=()=>{ etag=t; [...tr.children].forEach(x=>{x.style.background='transparent';x.style.color='var(--text-2)';x.style.borderColor='var(--border)';}); b.style.background=`var(--${t}-bg)`; b.style.color=`var(--${t})`; b.style.borderColor='transparent'; };
    b.onclick=pick; tr.appendChild(b); if(t===c.tag) pick(); });
  w.querySelector('#ecancel').onclick=()=>{ editingId=null; (WHOLE?renderWholeComments:renderComments)(); };
  w.querySelector('#esave').onclick=()=>{ onSave(w.querySelector('#ebody').value, etag); }; return w; }
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
function activateComment(id){ activeId=id; if(WHOLE) renderWholeComments(); else renderComments(); document.querySelector(`#comments .ccard[data-id="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}); }
// paintCommentsIn scopes all matching to `root`; in whole-doc `root` is one #wd-<id> segment so an
// identical phrase in another chapter can never be highlighted by this chapter's comment.
function paintCommentsIn(root, comments){
  root.querySelectorAll('mark.cmark').forEach(m=>{ const p=m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
  root.querySelectorAll('figure[data-cid]').forEach(f=>{ f.classList.remove('cmark-fig'); delete f.dataset.cid; });
  root.querySelectorAll('.cmark-el').forEach(e=>{ e.classList.remove('cmark-el'); delete e.dataset.cid; e.onclick=null; });   // block-level fallback marks
  const blocks=[...root.querySelectorAll('p, li, figcaption')].map(el=>({el,txt:el.textContent.replace(/\s+/g,' ')}));
  const figs=[...root.querySelectorAll('figure')].map(el=>({el,txt:el.textContent.replace(/\s+/g,' ')}));
  // Only live comments light an anchor: a resolved/archived comment folds into the collapsed Resolved
  // group, so keeping its highlight (or flagging it as an orphan) would be noise. Same predicate the cards use.
  const live=(comments||[]).filter(c=>!_isArchived(c));
  live.forEach(c=>{ if(c.kind==='figure'){ const q=(c.anchor.quote||'').replace(/^[^:]*:\s*/,'').replace(/\s+/g,' ').trim().slice(0,30); const fig=(figs.find(f=>f.txt.includes(q)) || figs.find(f=>f.el.querySelector('img')?.src.endsWith(c.anchor.figure||' ')))?.el; if(fig){ fig.classList.add('cmark-fig'); fig.dataset.cid=c.id; fig.style.setProperty('--mk',`var(--${c.tag})`); } return; }
    const q=(c.anchor.quote||'').replace(/\s+/g,' ').trim(); if(q.length<4) return; const needle=q.slice(0,50); const el=blocks.find(b=>b.txt.includes(needle.slice(0,40)))?.el; if(!el) return; if(!wrapInNode(el,needle,c)){ el.classList.add('cmark-el'); el.dataset.cid=c.id; el.style.setProperty('--mk',`var(--${c.tag})`); el.onclick=()=>activateComment(c.id); } });
  // F6: a text comment whose quote no longer appears (author edited/removed the passage) can't paint and
  // would silently vanish. Return those so the caller can surface them instead of dropping them.
  const isPresent=q=>blocks.some(b=>b.txt.includes(q.slice(0,40)));
  return orphanComments(live, isPresent); }
function paintHighlights(){ const doc=document.getElementById('doc'); if(!doc) return; if(WHOLE){ paintWholeHighlights(); return; } renderOrphanNotice(paintCommentsIn(doc, review.comments)); }
function paintWholeHighlights(){ const doc=document.getElementById('doc'); if(!doc) return; let orphans=[];
  _wholeUnits.forEach(u=>{ const seg=document.getElementById('wd-'+u.id); if(!seg) return; orphans=orphans.concat(paintCommentsIn(seg, (_reviews[u.id]&&_reviews[u.id].comments)||[])); });
  renderOrphanNotice(orphans); }
// F6: honest, dismissible notice listing comments that lost their anchor after an author edit — never
// drop them silently. Clicking one still opens it in the rail (the comment/thread text is intact).
function renderOrphanNotice(orphans){
  let el=document.getElementById('orphan-notice');
  if(!orphans||!orphans.length){ if(el) el.remove(); return; }
  if(!el){ el=document.createElement('div'); el.id='orphan-notice';
    el.style.cssText='margin:10px 0;padding:10px 12px;border:1px solid #e7d3a8;background:#fdf6e3;border-radius:8px;font:12.5px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#7a5b12';
    const cm=document.getElementById('comments'); if(cm) cm.prepend(el); else return; }
  const rows=orphans.map(c=>`<button class="orphan-jump" data-id="${c.id}" style="display:block;width:100%;text-align:left;border:0;background:none;cursor:pointer;color:#7a5b12;padding:3px 0;font:inherit"><i class="ti ti-unlink"></i> ${escapeHtml(shortTitle((c.anchor&&c.anchor.quote)||c.body||'comment'))}</button>`).join('');
  el.innerHTML=`<div style="font-weight:600;margin-bottom:4px"><i class="ti ti-alert-triangle"></i> ${orphans.length} comment${orphans.length>1?'s':''} lost ${orphans.length>1?'their':'its'} place</div><div style="margin-bottom:6px">The passage ${orphans.length>1?'these refer':'this refers'} to changed since ${orphans.length>1?'they were':'it was'} written, so ${orphans.length>1?'they can':'it can'}'t be highlighted in the text. ${orphans.length>1?'They\'re':'It\'s'} still saved:</div>${rows}`;
  el.querySelectorAll('.orphan-jump').forEach(b=>b.onclick=()=>activateComment(b.dataset.id));
}
function wrapInNode(el,needle,c){ const tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let node, probe=needle.slice(0,30);
  while((node=tw.nextNode())){ const idx=node.nodeValue.indexOf(probe); if(idx>=0){ const r=document.createRange(); r.setStart(node,idx); r.setEnd(node,Math.min(node.nodeValue.length,idx+needle.length));
    const mk=document.createElement('mark'); mk.className='cmark'; mk.dataset.id=c.id; mk.dataset.tag=c.tag; if(c.edit) mk.dataset.sugg=c.edit.op; try{ r.surroundContents(mk); mk.onclick=e=>{ e.stopPropagation(); activateComment(c.id); }; return true; }catch(e){ return false; } } } return false; }

// ================= whole-document ("read the whole paper") view =================
// Assemble every RELEASED unit into one #doc, each wrapped in a #wd-<id> segment. This reviewer's comments
// are held per chapter in _reviews and resolved within their own segment; new comments route back to the
// owning chapter's advisor/<id>/<ch>.json. Live sync off in this view (v1); the durable outbox still ships.
// Whole-doc only: each unit's HTML carries its own citeproc #refs block (separate pandoc passes). Pull
// every unit's .csl-entry out, drop the per-unit blocks (also kills duplicate ids), dedupe by ref key,
// and append one consolidated References section at the end of #doc. No-op when nothing cites.
function consolidateWholeRefs(doc){
  if(!doc) return;
  const entries=[];
  doc.querySelectorAll('.wd-chapter').forEach(seg=>{
    seg.querySelectorAll('#refs, .references').forEach(block=>{
      block.querySelectorAll('.csl-entry').forEach(el=>entries.push({ key:el.id, html:el.outerHTML }));
      block.remove();
    });
  });
  const html=buildRefsSection(entries);
  if(html) doc.insertAdjacentHTML('beforeend', html);
}
async function loadWholeDoc(){
  WHOLE=true; current='__whole__'; review=loadLocal('__whole__');
  document.getElementById('nav').style.display=''; document.getElementById('comments').style.display='';
  stopLiveSync();
  renderTopbar();
  _wholeUnits=orderedUnits(CHAPTERS, released);   // released units only, in manifest order
  if(!_wholeUnits.length){
    read.innerHTML=`<div class="empty"><i class="ti ti-book" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Nothing released yet</div>
      <div style="font-size:13px;line-height:1.6;max-width:420px;margin:0 auto">Once ${escapeHtml(UNIT)}s are released to you, the whole ${escapeHtml(DOC)} shows here as one continuous read.</div></div>`;
    document.getElementById('nav').innerHTML=''; document.getElementById('comments').innerHTML=''; return;
  }
  const t=tok(); const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  read.innerHTML=`<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Assembling the whole ${escapeHtml(DOC)}…</div><div class="wd-progress" style="margin-top:6px;font-size:12px;color:var(--text-3)">0 of ${_wholeUnits.length} ${_wholeUnits.length===1?escapeHtml(UNIT):escapeHtml(UNIT)+'s'}</div></div>`;
  // Fetch every released unit's rendered HTML CONCURRENTLY (was sequential). Order preserved by mapping
  // back over _wholeUnits, not by fetch-completion order.
  const fetchFrag=async(u)=>{
    try{
      if(dev){ const r=await fetch(`./chapters/${u.id}.html`); if(r.ok) return await r.text(); }
      if(t){ return await _rawText(t, `content/${u.id}.html`); }
    }catch(e){}
    return null;
  };
  // Countable work (N units) — show it landing instead of an indeterminate spinner.
  let _got=0;
  const _tick=()=>{ const el=read.querySelector('.wd-progress'); if(el) el.textContent=`${_got} of ${_wholeUnits.length} ${_wholeUnits.length===1?UNIT:UNIT+'s'}`; };
  const frags=await Promise.all(_wholeUnits.map(u=>fetchFrag(u).then(r=>{ _got++; _tick(); return r; })));
  const parts=_wholeUnits.map((u,i)=>{
    const frag=frags[i]!=null?frags[i]:`<div class="empty" style="padding:22px"><i class="ti ti-file-code" style="font-size:20px;color:var(--text-3)"></i><div style="font-size:13px;margin-top:8px">Reading view not built yet for this ${escapeHtml(UNIT)}.</div></div>`;
    return wrapUnit(u.id, `${unitLabelWithTitle(u, UNIT)}`, frag);
  });
  read.innerHTML=`<article id="doc">${parts.join('\n')}</article>`;
  const doc=document.getElementById('doc');
  consolidateWholeRefs(doc);   // pull each unit's own reference list into ONE at the very end
  fixFootnotes(doc); runKatex(doc); wireFigures(doc); wireCitations(doc); linkCrossRefs(doc);
  await loadAllReviews(_wholeUnits);
  buildNavWhole(); paintWholeHighlights(); renderWholeComments();
  if(review.cursor?.sec) document.getElementById(review.cursor.sec)?.scrollIntoView();
}
// Load this reviewer's own review for every assembled unit (local reconciled with remote) into _reviews.
async function loadAllReviews(units){
  const t=tok(); const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  // Load every unit's review CONCURRENTLY (was N sequential round-trips). Per-item try/catch.
  await Promise.all(units.map(async(u)=>{
    let rev=loadLocal(u.id);
    try{
      if(dev){ const r=await fetch(`./advisor/${effId()}/${u.id}.json`); if(r.ok) rev=mergeReviews(await r.json(), rev); }
      else if(t){ const g=await getJson(t, reviewPath(u.id)); if(g.json) rev=mergeReviews(g.json, rev); }
    }catch(e){}
    _reviews[u.id]=rev;
  }));
}
function buildNavWhole(){
  const nav=document.getElementById('nav');
  nav.innerHTML=`<div class="lbl">${escapeHtml((DOC||'document').toUpperCase())}<span style="margin-left:auto">${_wholeUnits.length}</span></div>`;
  _wholeUnits.forEach(u=>{
    const cnt=((_reviews[u.id]&&_reviews[u.id].comments)||[]).length;
    const a=document.createElement('a'); a.dataset.seg='wd-'+u.id;
    a.innerHTML=`<span class="nav-t" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(u.n+' · '+shortTitle(u.title))}</span>${cnt?`<span class="count">${cnt}</span>`:''}`;
    a.querySelector('.nav-t').onclick=()=>document.getElementById('wd-'+u.id)?.scrollIntoView({behavior:'smooth',block:'start'});
    nav.appendChild(a);
    const seg=document.getElementById('wd-'+u.id);
    [...(seg?seg.querySelectorAll('h2, h3'):[])].forEach((h,i)=>{ if(!h.id) h.id='wd-'+u.id+'-sec-'+i;
      const s=document.createElement('a'); s.className=h.tagName==='H3'?'sub':''; s.dataset.sec=h.id;
      s.innerHTML=`<span class="nav-t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:14px;color:var(--text-2)">${escapeHtml(h.textContent)}</span>`;
      s.querySelector('.nav-t').onclick=()=>h.scrollIntoView({behavior:'smooth',block:'start'}); nav.appendChild(s); });
  });
}
function renderWholeComments(){
  const pane=document.getElementById('comments');
  const flat=flattenReviews(_reviews, _wholeUnits).filter(x=>!_isArchived(x.comment));
  const open=flat.filter(x=>x.comment.status==='open').length;
  pane.innerHTML=`<div class="lbl">MY COMMENTS<span style="margin-left:auto">${flat.length} active${open?` · ${open} open`:''}</span></div>`;
  if(!flat.length){ pane.innerHTML+=`<div style="font-size:12.5px;color:var(--text-3);padding:8px 2px">Select text in any ${escapeHtml(UNIT)} to leave a comment. Open a single ${escapeHtml(UNIT)} to reply or manage.</div>`; return; }
  flat.forEach(({chapterId, comment})=>pane.appendChild(buildWholeCard(chapterId, comment)));
}
function buildWholeCard(chapterId, c){
  const m=chMeta(chapterId);
  const card=document.createElement('div'); card.className='ccard'; card.dataset.id=c.id;
  if(editingId===c.id){ card.appendChild(editCard(c, (body,tag)=>{ _wholeCommitEdit(chapterId, updateComment(_reviews[chapterId], c.id, {body,tag})); editingId=null; })); return card; }
  const resolved=c.status==='resolved'; card.style.cursor='pointer';
  card.innerHTML=`<div class="row">
      <span class="chip" style="background:var(--bg-3);color:var(--text-2)">${escapeHtml(unitLabel(m, UNIT))}</span>
      <span class="chip" style="background:var(--${c.tag}-bg);color:var(--${c.tag})">${c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:11px;vertical-align:-1px;margin-right:2px"></i>':''}${escapeHtml(c.tag)}</span>
      <span class="cactions" style="margin-left:auto;display:none;gap:1px">
        <button class="icbtn cact" data-act="resolve" title="${resolved?'Reopen':'Resolve'}" style="width:25px;height:25px;font-size:14px"><i class="ti ti-${resolved?'rotate-clockwise':'check'}"></i></button>
        <button class="icbtn cact" data-act="edit" title="Edit" style="width:25px;height:25px;font-size:14px"><i class="ti ti-pencil"></i></button>
        <button class="icbtn cact" data-act="del" title="Delete" style="width:25px;height:25px;font-size:14px"><i class="ti ti-trash"></i></button></span></div>
    <div class="snip">"${escapeHtml((c.anchor.quote||'').slice(0,52))}"</div>
    ${c.body?`<div class="body" style="${resolved?'opacity:.5;text-decoration:line-through':''}">${escapeHtml(c.body)}</div>`:''}${resolHtml(c)}${threadHtml(c)}`;
  card.onmouseenter=()=>{ const a=card.querySelector('.cactions'); if(a) a.style.display='flex'; };
  card.onmouseleave=()=>{ const a=card.querySelector('.cactions'); if(a) a.style.display='none'; };
  card.querySelectorAll('.cact').forEach(b=>b.onclick=e=>{ e.stopPropagation(); wholeCommentAction(chapterId, c.id, b.dataset.act); });
  card.onclick=()=>{ const seg=document.getElementById('wd-'+chapterId);
    const mark=seg&&seg.querySelector(`.cmark[data-id="${c.id}"], .cmark-el[data-cid="${c.id}"], figure[data-cid="${c.id}"]`);
    (mark||seg)?.scrollIntoView({behavior:'smooth',block:'center'});
    if(mark){ mark.classList.add('flash'); setTimeout(()=>mark.classList.remove('flash'),1500); } };
  return card;
}
// Whole-doc edit/resolve/delete: mutate ONLY the owning chapter's review (in _reviews), persist to its
// file, and re-render the whole view. Mirrors createWholeComment's persist+sync so the per-chapter
// advisor/<id>/<ch>.json stays the single source of truth (the global `review` is not the whole-doc store).
function _wholeCommitEdit(chapterId, nrev){
  nrev.pending=true; nrev.last_active=new Date().toISOString();
  _reviews[chapterId]=nrev; localStorage.setItem(localKey(chapterId), JSON.stringify(nrev));
  paintWholeHighlights(); buildNavWhole(); renderWholeComments();
  const t=tok(); if(t) pushChapterReviewAdv(chapterId).catch(()=>{});
}
function wholeCommentAction(chapterId, id, act){
  const rev=_reviews[chapterId]; if(!rev) return;
  const c=rev.comments.find(x=>x.id===id); if(!c) return;
  if(act==='edit'){ editingId=id; renderWholeComments(); return; }
  if(act==='del'){ if(!confirm('Delete this comment?')) return; _wholeCommitEdit(chapterId, deleteComment(rev,id)); return; }
  if(act==='resolve'){ const reopening=c.status==='resolved'; _wholeCommitEdit(chapterId, updateComment(rev,id,{status:reopening?'submitted':'resolved', reopened:reopening})); }
}
// Create a comment in the whole-doc view: mutate ONLY the owning chapter's review + persist to its file.
function createWholeComment(chapterId, fields){
  if(!chapterId){ flash(`Couldn't tell which ${UNIT} that selection is in — try again.`); return; }
  const rev=routeWrite(_reviews, chapterId, id=>loadLocal(id));
  _reviews[chapterId]=addComment(rev, fields);
  _reviews[chapterId].pending=true; _reviews[chapterId].last_active=new Date().toISOString();
  localStorage.setItem(localKey(chapterId), JSON.stringify(_reviews[chapterId]));   // outbox picks this up too
  paintWholeHighlights(); buildNavWhole(); renderWholeComments();
  pushChapterReviewAdv(chapterId);
}
// Persist one chapter's review to advisor/<id>/<ch>.json in isolation (mirrors syncUp; never touches the
// global current/review/reviewSha). The durable outbox retries it if this immediate push fails.
async function pushChapterReviewAdv(ch){
  const t=tok(); if(!t) return;
  const path=reviewPath(ch);
  for(let attempt=0; attempt<5; attempt++){
    let remote=null, sha=null;
    try{ const g=await getJson(t,path); remote=g.json; sha=g.sha; }catch(e){ if(is401(e)){ keyBad=true; renderBanner(); return; } sha=await _getSha(t,path); }
    const merged=mergeReviews(remote, _reviews[ch]);
    try{ await putJson(t,path,merged,sha,`review(${effId()}): ${ch}`,false); merged.pending=false; _reviews[ch]=merged; localStorage.setItem(localKey(ch), JSON.stringify(merged)); return; }
    catch(e){ if(/\b409\b/.test(e.message)&&attempt<4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } return; }
  }
}
// ---------- top bar / home / search ----------
function renderTopbar(){ const m=chMeta(current);
  document.getElementById('topbar').innerHTML=`
    ${allDocsLink()}${reviewerPill()}
    <button class="icbtn" id="btn-home" title="All ${UNIT}s"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel"><i class="ti ti-book-2"></i><span>${current==='__whole__' ? 'Whole '+escapeHtml(DOC) : `${unitLabel(m, UNIT)} · ${shortTitle(m.title)}`}</span><i class="ti ti-chevron-down" style="font-size:15px;color:var(--text-3)"></i></button>
    <div class="search"><i class="ti ti-search"></i><input id="search" placeholder="Search ${UNIT}"></div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      <button class="icbtn" id="btn-help" title="How reviewing works"><i class="ti ti-help-circle"></i></button>
      <button class="icbtn" id="btn-export" title="Download this ${UNIT} (Word · Markdown)"><i class="ti ti-file-export"></i></button>
      ${settingsBtn()}
    </div>`;
  document.getElementById('btn-home').onclick=enterHome;
  document.getElementById('chsel').onclick=openChapterMenu;
  wireSettingsBtn();
  document.getElementById('btn-help').onclick=()=>window.open('tutorials/walkthrough.html','_blank','noopener');
  document.getElementById('btn-export').onclick=()=>exportDialog(current);
  const si=document.getElementById('search'); si.addEventListener('keydown',e=>{ if(e.key==='Enter') runSearch(si.value); if(e.key==='Escape'){ si.value=''; clearSearch(); } });
}
function openChapterMenu(){ const old=document.getElementById('chmenu'); if(old){ old.remove(); return; } const menu=document.createElement('div'); menu.id='chmenu';
  menu.style.cssText='position:absolute;top:50px;left:16px;z-index:40;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 34px rgba(0,0,0,.16);padding:6px;min-width:330px';
  const list=CHAPTERS.filter(c=>released.includes(c.id));
  const wholeRow=list.length?`<div data-ch="__whole__" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500${current==='__whole__'?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px"><i class="ti ti-book"></i></span>Whole ${escapeHtml(DOC)}</div><div style="height:1px;background:var(--border);margin:5px 8px"></div>`:'';
  menu.innerHTML=wholeRow+(list.map(c=>`<div data-ch="${c.id}" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px${c.id===current?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px">${unitTag(c)}</span>${shortTitle(c.title)}</div>`).join('')||`<div style="padding:10px;color:var(--text-3);font-size:12.5px">No chapters released yet.</div>`);
  menu.querySelectorAll('[data-ch]').forEach(d=>{ d.onclick=()=>{ menu.remove(); loadChapter(d.dataset.ch); }; });
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',function h(e){ if(!menu.contains(e.target)&&e.target.id!=='chsel'){ menu.remove(); document.removeEventListener('click',h); } }),0);
}
// Reviewer email preferences — stored in advisor/<id>/prefs.json (written with the reviewer's own key,
// read by the notify CI). Unchecking both = zero emails. Defaults ON to preserve current behavior.
async function openNotifyPrefs(){
  const t = tok(); if(!t){ alert('Enter your access key first.'); return; }
  document.getElementById('np-pop')?.remove();
  let email = {}; try { const r = await getJson(t, `advisor/${effId()}/prefs.json`); email = (r.json && r.json.email) || {}; } catch(e){}
  const rel = email.released !== false, resp = email.responses !== false;
  const pop = document.createElement('div'); pop.id='np-pop';
  pop.style.cssText='position:absolute;top:52px;right:14px;z-index:60;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.18);padding:14px;min-width:266px';
  pop.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:3px">Email me when…</div>
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:11px">Uncheck both for zero emails.</div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:9px;cursor:pointer"><input type="checkbox" id="np-rel" ${rel?'checked':''}> new ${escapeHtml(UNIT)}s are released to me</label>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:13px;cursor:pointer"><input type="checkbox" id="np-resp" ${resp?'checked':''}> the author responds to my comments</label>
    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><span id="np-s" style="font-size:11px;color:var(--text-3);margin-right:auto"></span><button class="btn" id="np-x2" style="padding:5px 11px;font-size:12px">Cancel</button><button class="btn btn-primary" id="np-ok" style="padding:5px 11px;font-size:12px">Save</button></div>`;
  document.body.appendChild(pop);
  pop.querySelector('#np-x2').onclick=()=>pop.remove();
  pop.querySelector('#np-ok').onclick=async()=>{
    const s = pop.querySelector('#np-s'); s.textContent='Saving…';
    try {
      const cur = await getJson(t, `advisor/${effId()}/prefs.json`).catch(()=>({json:null,sha:null}));
      const obj = (cur.json && typeof cur.json==='object') ? cur.json : {};
      obj.email = { released: pop.querySelector('#np-rel').checked, responses: pop.querySelector('#np-resp').checked };
      await putJson(t, `advisor/${effId()}/prefs.json`, obj, cur.sha, `prefs(${effId()}): email settings`);
      s.textContent='Saved ✓'; setTimeout(()=>pop.remove(), 800);
    } catch(e){ s.textContent='Failed: '+e.message; }
  };
  setTimeout(()=>document.addEventListener('click', function h(e){ if(!pop.contains(e.target) && e.target.id!=='btn-notify' && !e.target.closest?.('#btn-notify')){ pop.remove(); document.removeEventListener('click', h); } }), 0);
}
// "What am I reviewing?" — a compact header on the reviewer home: doc title, author, who you're
// reviewing as, how many units are shared, and the deadline if the author set one. Pure data comes
// from reviewingHeader(); this only renders it.
function reviewHeaderHtml(releasedCount){
  const h = reviewingHeader(_CFG || { doc:{ noun:DOC, unitNoun:UNIT, title:'', authorName:'' }, deadline:(_CFG&&_CFG.deadline)||null }, displayName(), releasedCount);
  const meta = [];
  if (h.author) meta.push(`<span><i class="ti ti-user" style="font-size:13px;vertical-align:-2px;color:var(--text-3)"></i> ${escapeHtml(h.author)}</span>`);
  meta.push(`<span><i class="ti ti-eye" style="font-size:13px;vertical-align:-2px;color:var(--text-3)"></i> reviewing as ${escapeHtml(h.reviewingAs || ADVISOR.name)}</span>`);
  meta.push(`<span><i class="ti ti-files" style="font-size:13px;vertical-align:-2px;color:var(--text-3)"></i> ${h.sharedCount} ${escapeHtml(h.unitNoun)}${h.sharedCount===1?'':'s'} shared</span>`);
  if (h.deadline) meta.push(`<span><i class="ti ti-clock" style="font-size:13px;vertical-align:-2px;color:var(--text-3)"></i> ${escapeHtml(h.deadline.label)} in ${h.deadline.days} day${h.deadline.days===1?'':'s'}</span>`);
  return `<div style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:16px 18px;margin-bottom:22px;background:var(--bg-2,var(--bg))">
      <div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:5px">YOU'RE REVIEWING</div>
      <div style="font-size:18px;font-weight:600;line-height:1.3;margin-bottom:9px">${escapeHtml(h.title)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px 16px;font-size:12.5px;color:var(--text-2)">${meta.join('')}</div></div>`;
}
function enterHome(){
  stopLiveSync();
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='none';
  document.getElementById('topbar').innerHTML=`<span style="display:inline-flex;align-items:center;gap:9px">${allDocsLink()}${brandMark('var(--accent)')}<strong style="font-size:16px;font-weight:600">Footnote</strong>${reviewerPill()}<span style="font-size:13px;color:var(--text-2)">· ${escapeHtml(ADVISOR.name)}</span></span>
     ${settingsBtn('margin-left:auto')}`;
  wireSettingsBtn();
  const askKey=openKeyDialog;
  // first-run: no access key yet — prompt for it before anything else
  if(!tok()){
    read.innerHTML=`<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Welcome, ${escapeHtml(ADVISOR.name)}</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Enter the access key you were emailed to open the ${UNIT}s shared with you for review. It's stored only in this browser.</div>
      <button class="btn btn-primary" id="connect">Enter access key</button></div>`;
    read.querySelector('#connect').onclick=askKey; return;
  }
  const list=CHAPTERS.filter(c=>released.includes(c.id));
  // Mirror the author's home: chapter cards only in the main grid; appendices live in their own
  // collapsible section below, each noting the chapter it's attached to.
  const chOnly=list.filter(c=>c.kind!=='appendix');
  const appUnits=list.filter(c=>c.kind==='appendix');
  const cards=chOnly.map(c=>{ const r=JSON.parse(localStorage.getItem(localKey(c.id))||'null'); const n=r?.comments?.length||0;
    const p=readProgress(r); const pct=p.done?100:Math.round(p.frac*100); const bar=p.done?'var(--success)':'var(--accent)';
    const progress=p.secN?`<div style="height:5px;border-radius:4px;background:var(--bg-3);overflow:hidden;margin-bottom:8px"><div style="width:${pct}%;height:100%;background:${bar}"></div></div>`:'';
    const status=p.secN?(p.done?`<span style="color:var(--success)">reviewed</span>`:`${p.doneN}/${p.secN} read`):'open to review';
    return `<div class="chcard" data-ch="${c.id}" style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 15px;cursor:pointer">
      <div style="font-size:11.5px;color:var(--text-3)">${unitLabel(c, UNIT)}</div>
      <div style="font-size:14px;font-weight:500;line-height:1.35;margin:3px 0 11px;min-height:38px">${shortTitle(c.title)}</div>
      ${progress}
      <div style="font-size:11px;color:var(--text-2);display:flex"><span>${status}</span>${n?`<span style="margin-left:auto">${n} comment${n>1?'s':''}</span>`:''}</div></div>`; }).join('');
  const appOpen=localStorage.getItem('home:appendicesOpen')!=='0';
  const appCard=a=>{ const r=JSON.parse(localStorage.getItem(localKey(a.id))||'null'); const n=r?.comments?.length||0;
    const homeMeta=a.home?chMeta(a.home):null;
    const sub=homeMeta?`attached to ${unitLabel(homeMeta, UNIT)}`:'open to review';
    return `<div class="chcard" data-ch="${a.id}" style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 15px;cursor:pointer;background:var(--accent-bg)">
      <div style="font-size:11.5px;color:var(--accent)">${unitLabel(a, UNIT)}</div>
      <div style="font-size:14px;font-weight:500;line-height:1.35;margin:3px 0 11px;min-height:38px">${shortTitle(a.title)}</div>
      <div style="font-size:11px;color:var(--text-2);display:flex"><span>${escapeHtml(sub)}</span>${n?`<span style="margin-left:auto">${n} comment${n>1?'s':''}</span>`:''}</div></div>`; };
  const appendixSection=appUnits.length?`<div id="appx-home" style="margin-top:26px">
      <div class="appx-toggle" style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:13px;cursor:pointer;user-select:none"><span class="appx-caret">${appOpen?'▾':'▸'}</span> APPENDICES <span style="color:var(--text-3)">· ${appUnits.length}</span></div>
      <div class="appx-home-grid" style="display:${appOpen?'grid':'none'};grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px">${appUnits.map(appCard).join('')}</div>
    </div>`:'';
  const oc=JSON.parse(localStorage.getItem(localKey('__outline__'))||'null'); const ocn=oc?.comments?.length||0;
  read.innerHTML=`<div style="max-width:900px;margin:0 auto;padding:28px 24px 90px">
      ${reviewHeaderHtml(list.length)}
      <div style="font-size:13px;color:var(--text-2);margin-bottom:20px">Welcome, ${escapeHtml(displayName())}. The ${UNIT}s released for your review are below. Open one to read it and leave comments or suggested edits; each one is shared with the author as soon as you add it.</div>
      ${list.length?`<button data-ch="__whole__" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:16px;background:none;cursor:pointer;font:inherit;color:var(--text)">
        <i class="ti ti-book" style="font-size:20px;color:var(--accent)"></i>
        <div style="min-width:0"><div style="font-size:14px;font-weight:500">Read the whole ${escapeHtml(DOC)}</div>
        <div style="font-size:11.5px;color:var(--text-2)">Every released ${escapeHtml(UNIT)} as one continuous read — comment anywhere</div></div>
        <span style="margin-left:auto;color:var(--text-2)"><i class="ti ti-chevron-right" style="vertical-align:-2px"></i></span></button>`:''}
      ${HAS_OUTLINE ? `<button id="outline-card" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:.5px solid var(--accent);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;background:var(--accent-bg);cursor:pointer;font:inherit;color:var(--text)">
        <i class="ti ti-list-tree" style="font-size:22px;color:var(--accent)"></i>
        <div style="min-width:0"><div style="font-size:14px;font-weight:500">Proposed ${DOC} outline</div>
        <div style="font-size:11.5px;color:var(--text-2)">See the planned structure and comment on it, available before ${UNIT}s are released.</div></div>
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-2);white-space:nowrap">${ocn?ocn+' comment'+(ocn>1?'s':''):'open to review'} <i class="ti ti-chevron-right" style="vertical-align:-2px"></i></span></button>` : ''}
      ${responsesReleased ? `<button id="responses-card" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:.5px solid var(--success);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;background:var(--success-bg);cursor:pointer;font:inherit;color:var(--text)">
        <i class="ti ti-message-check" style="font-size:22px;color:var(--success)"></i>
        <div style="min-width:0"><div style="font-size:14px;font-weight:500">Responses to your comments</div>
        <div style="font-size:11.5px;color:var(--text-2)">See how the author addressed each comment you submitted.</div></div>
        <span style="margin-left:auto;color:var(--text-2)"><i class="ti ti-chevron-right" style="vertical-align:-2px"></i></span></button>` : ''}
      <div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:13px">${UNIT.toUpperCase()}S FOR REVIEW</div>
      ${list.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px">${cards}</div>`:`<div class="empty" style="margin:6vh auto"><i class="ti ti-mail-fast" style="font-size:26px;color:var(--text-3)"></i>
        <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Nothing has been shared with you yet</div>
        <div style="font-size:13px;line-height:1.6;max-width:420px;margin:0 auto">You'll be emailed the moment the author releases a ${escapeHtml(UNIT)} to you. In the meantime you can comment on the proposed outline above.</div></div>`}${appendixSection}<div id="adv-downloads"></div></div>`;
  read.querySelectorAll('[data-ch]').forEach(el=>el.onclick=()=>loadChapter(el.dataset.ch));
  read.querySelectorAll('#appx-home .appx-toggle').forEach(tg=>tg.onclick=()=>{
    const grid=tg.parentElement.querySelector('.appx-home-grid');
    const open=grid.style.display==='none';
    grid.style.display=open?'grid':'none';
    tg.querySelector('.appx-caret').textContent=open?'▾':'▸';
    localStorage.setItem('home:appendicesOpen', open?'1':'0');
  });
  document.getElementById('outline-card')?.addEventListener('click', loadOutline);   // absent when the doc has no outline (e.g. a journal article)
  document.getElementById('responses-card')?.addEventListener('click', loadResponses);
  renderAdvisorDownloads();
}
// ---------- responses to your comments (read-only; gated by the owner's release toggle) ----------
async function loadResponses(){
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='none';
  document.getElementById('topbar').innerHTML=`<button class="icbtn" id="resp-back" title="All ${UNIT}s"><i class="ti ti-layout-grid"></i></button>
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
      else if(t){ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}advisor/${effId()}/${ch}.json?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.status===401) return showKeyExpired(); if(r.ok) json=await r.json(); }
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
  const head=g=>g.ch==='__outline__'?'Proposed outline':`${unitLabel(chMeta(g.ch), UNIT)} · ${escapeHtml(shortTitle(chMeta(g.ch).title))}`;
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
      else if(t){ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}content/${ch}.html?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.ok) html=await r.text(); }
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
// Boot probe: does this data repo ship a real outline (outline.json with chapters)? Journals typically
// have none, so the home "Proposed outline" card must not appear for them. Returns false on any error/404.
async function _outlineExists(){
  const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  try{
    let data=null;
    if(dev){ const r=await fetch('./outline.json'); if(r.ok) data=await r.json(); }
    if(!data){ const t=tok(); if(!t) return false; const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}outline.json?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(!r.ok) return false; data=await r.json(); }
    const nodes = data && (data.chapters||data.nodes||data.sections);
    return !!(Array.isArray(nodes) && nodes.length);
  }catch(e){ return false; }
}
// The document title shown in the reviewer header must come from the DATA REPO, not the app's instance
// config (which is generic → "Untitled document"). Workspace: projects.json[<pid>].doc.title. Legacy:
// outline.json.title. Returns '' when nothing is set, so the caller keeps the config fallback.
async function _docTitleFromRepo(){
  const t=tok(); if(!t) return '';
  const raw = { headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'}, cache:'no-store' };
  // Precedence: owner MANUAL override → live LaTeX \title (source of truth) → auto-captured doc.title → outline.
  let storedTitle='';
  if(_PREFIX){   // consolidated workspace — the per-project title lives in projects.json at the repo root
    try{ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/projects.json?t=${Date.now()}`, raw);
      if(r.ok){ const j=await r.json(); const ps=Array.isArray(j)?j:(j.projects||[]); const pid=_PREFIX.replace(/\/$/,'');
        const p=ps.find(x=>x&&x.id===pid); const doc=p&&p.doc;
        if(doc&&doc.title&&doc.title.trim()){ storedTitle=doc.title.trim(); if(doc.titleManual) return storedTitle; } } }catch(e){}
  }
  // authoritative source of truth: the LaTeX \title in the uploaded source (source/main.tex), always current
  try{ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}source/main.tex?t=${Date.now()}`, raw);
    if(r.ok){ const tt=parseLatexTitle(await r.text()); if(tt && tt.trim()) return tt.trim(); } }catch(e){}
  if(storedTitle) return storedTitle;   // auto-captured at import, when the live source isn't readable
  try{ const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1'; let data=null;
    if(dev){ const r=await fetch('./outline.json'); if(r.ok) data=await r.json(); }
    if(!data){ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}outline.json?t=${Date.now()}`, raw); if(r.ok) data=await r.json(); }
    if(data && data.title && data.title.trim()) return data.title.trim();
  }catch(e){}
  return '';
}
async function loadOutline(){
  current='__outline__'; review=loadLocal('__outline__');
  document.getElementById('nav').style.display='none'; document.getElementById('comments').style.display='';
  renderOutlineTopbar();
  read.innerHTML=`<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading outline…</div></div>`;
  let data=null; const dev=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  try{
    if(dev){ const r=await fetch('./outline.json'); if(r.ok) data=await r.json(); }
    if(!data){ const t=tok(); if(t){ const r=await _gfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}outline.json?t=${Date.now()}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/vnd.github.raw'},cache:'no-store'}); if(r.status===401) return showKeyExpired(); if(r.ok) data=await r.json(); } }
  }catch(e){}
  if(!data){ read.innerHTML=`<div class="empty">Couldn't load the outline. Check your access key.</div>`; return; }
  renderOutline(data); renderComments(); syncDown();
  if (tok() && !tourSeen('tour-advisor-outline-v1')){ markTourSeen('tour-advisor-outline-v1'); setTimeout(() => { try { launchAdvisorOutlineTour(); } catch {} }, 900); }
}
function renderOutlineTopbar(){
  document.getElementById('topbar').innerHTML=`
    <button class="icbtn" id="btn-home" title="All ${UNIT}s"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel" style="cursor:default"><i class="ti ti-list-tree"></i><span>Proposed outline</span></button>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      ${settingsBtn()}</div>`;
  document.getElementById('btn-home').onclick=enterHome;
  wireSettingsBtn();
}
function renderOutline(data){
  const cnt=(label,sec)=>review.comments.filter(c=>c.anchor?.quote===label && c.anchor?.section===sec && !_isArchived(c)).length;   // ACTIVE only — a resolved comment must not light the node badge
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
const _EXP_FMT = { docx:'Word', md:'Markdown' };   // pdf removed — export is docx/md only
const _expOpen = new Set();
function exportDialog(scope){
  document.getElementById('expdlg')?.remove();
  const m = chMeta(scope);
  const title = scope==='__outline__' ? 'the proposed outline' : `${unitLabel(m, UNIT)} · ${shortTitle(m.title)}`;
  const back=document.createElement('div'); back.id='expdlg';
  back.style.cssText='position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center';
  back.innerHTML=`<div style="background:var(--bg);border:.5px solid var(--border-2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(440px,92vw);padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:3px">Download ${escapeHtml(title)}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Built in the cloud with your comments included. It appears under Downloads on the home screen when ready, usually within a few minutes.</div>
      <div style="font-size:11px;letter-spacing:.05em;color:var(--text-3);margin-bottom:6px">FORMATS</div>
      <label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" class="exp-fmt" value="docx" checked> Word (.docx), with your comments</label>
      <label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" class="exp-fmt" value="md" checked> Markdown</label>
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
  const items=list.map(id=>{ const m=chMeta(id); return `<div data-ch="${id}" class="exppick-it" style="padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px"><span style="color:var(--text-3);min-width:18px;display:inline-block">${unitTag(m)}</span> ${shortTitle(m.title)}</div>`; }).join('')||`<div style="padding:10px;color:var(--text-3);font-size:12.5px">No chapters released yet.</div>`;
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
      <button class="btn" id="adv-export-btn" style="margin-left:auto;padding:5px 11px;font-size:12px"><i class="ti ti-file-export"></i>Export a ${UNIT}…</button></div>`;
  if(!jobs.length){
    box.innerHTML=header+`<div style="font-size:12.5px;color:var(--text-3);line-height:1.6">No downloads yet. Use <strong>Export a ${UNIT}…</strong> above (or the export icon inside any ${UNIT}) to download it as Word or Markdown with your comments.</div>`;
    box.querySelector('#adv-export-btn').onclick=e=>exportPick(e.currentTarget); return;
  }
  const groups={}; for(const j of jobs){ (groups[j.chapter] ||= []).push(j); }
  box.innerHTML=header+Object.keys(groups).map(scope=>{
    const list=groups[scope]; const m=chMeta(scope);
    const name=scope==='__outline__'?'Proposed outline':`${unitLabel(m, UNIT)} · ${shortTitle(m.title)}`;
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
  try{ const url=`https://api.github.com/repos/${DATA_REPO}/contents/${_PREFIX}${path}?t=${Date.now()}`;
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
// ── Reviewer Home: the reviewer's remembered documents (client-side, cross-author). ──────────────
// Every successful document open is recorded here; a bare advisor.html (or "← All documents") lists them.
const RVH_SPINES = ['#2c64c4','#b5643c','#4a7c59','#7a4b73','#c08a2d','#2f7d80','#93313e'];
function _rawRecents(){ try { const v = JSON.parse(_store.get(recentsKey()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function recordRecent(entry){ try { _store.set(recentsKey(), JSON.stringify(recentsAdd(_rawRecents(), entry))); } catch(e){} }
// ---------- settings dropdown: theme, accent, notifications and the access key in one tucked-away menu ----------
function settingsBtn(extra=''){ return `<button class="icbtn" id="btn-settings" title="Settings"${extra?` style="${extra}"`:''}><i class="ti ti-settings"></i></button>`; }
function toggleAdvTheme(){ document.documentElement.classList.toggle('dark'); localStorage.setItem('theme', document.documentElement.classList.contains('dark')?'dark':'light'); }
async function openKeyDialog(){ applyKeyChoice(await keyModal({ current:tok()||'', allowClear:true, title:'Your access key' })); }
function openSettingsMenu(){
  const old=document.getElementById('rev-settings'); if(old){ old.remove(); return; }
  const btn=document.getElementById('btn-settings'); if(!btn) return;
  const r=btn.getBoundingClientRect();
  const m=document.createElement('div'); m.id='rev-settings';
  m.style.cssText=`position:fixed;top:${Math.round(r.bottom+8)}px;right:${Math.max(12,Math.round(window.innerWidth-r.right))}px;z-index:9000;background:var(--bg);border:.5px solid var(--border-2);border-radius:11px;box-shadow:0 14px 36px rgba(0,0,0,.17);padding:12px 14px;min-width:264px`;
  const row='display:flex;align-items:center;gap:9px;width:100%;background:none;border:0;padding:7px 8px;border-radius:7px;cursor:pointer;font:inherit;font-size:13px;color:var(--text);text-align:left';
  const hdr='font-size:10px;letter-spacing:.07em;color:var(--text-3);font-weight:600;margin:2px 0 7px';
  const dark=document.documentElement.classList.contains('dark');
  m.innerHTML=`<div style="${hdr}">APPEARANCE</div>
    <button id="rs-theme" style="${row}"><i class="ti ti-${dark?'sun':'moon'}" style="width:16px"></i>${dark?'Light mode':'Dark mode'}</button>
    <div style="font-size:12px;color:var(--text-3);margin:11px 0 8px 1px">Accent color <span style="color:var(--text-3);opacity:.8">(Multicolor drifts every 30 min)</span></div>
    <div id="rs-accent">${swatchesHtml(storedAccent(localStorage))}</div>
    <div style="border-top:.5px solid var(--border);margin:13px 0 9px"></div>
    <button id="rs-notify" style="${row}"><i class="ti ti-bell" style="width:16px"></i>Email notifications</button>
    <button id="rs-key" style="${row}"><i class="ti ti-key" style="width:16px"></i>Access key</button>`;
  document.body.appendChild(m);
  m.querySelectorAll('button').forEach(b=>{ b.onmouseenter=()=>b.style.background='var(--bg-3,rgba(127,127,127,.10))'; b.onmouseleave=()=>b.style.background='none'; });
  const paintSwatches=()=>{
    const box=m.querySelector('#rs-accent'); box.innerHTML=swatchesHtml(storedAccent(localStorage));
    box.querySelectorAll('.ac-swatch').forEach(s=>s.onclick=()=>{ chooseAccent(s.dataset.accent,document,localStorage); paintSwatches(); });
  };
  paintSwatches();
  m.querySelector('#rs-theme').onclick=()=>{ toggleAdvTheme(); m.remove(); openSettingsMenu(); };
  m.querySelector('#rs-notify').onclick=()=>{ m.remove(); openNotifyPrefs(); };
  m.querySelector('#rs-key').onclick=()=>{ m.remove(); openKeyDialog(); };
  setTimeout(()=>document.addEventListener('click',function h(e){
    if(!m.contains(e.target) && !btn.contains(e.target)){ m.remove(); document.removeEventListener('click',h); }
  }),0);
}
function wireSettingsBtn(){ const b=document.getElementById('btn-settings'); if(b) b.onclick=e=>{ e.stopPropagation(); openSettingsMenu(); }; }
// Completion celebration: a rainbow sweep when the reviewer finishes reading a chapter. Snapshot-
// compared so it fires on completion, never on load. Comment resolution is the author's job, so the
// resolved-predicate is always false here and only the read milestone can fire.
let _msSnap = null, _msCh = null;
function checkMilestones(){
  try {
    const now = chapterMilestones(review, () => false);
    if (_msCh !== current){ _msCh = current; _msSnap = now; return; }
    const fired = newMilestones(_msSnap, now);
    _msSnap = now;
    if (fired.read) celebrate(document, localStorage);
  } catch(e){}
}
function reviewerPill(){ return `<span style="font-family:var(--mono,'IBM Plex Mono',monospace);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);border-radius:20px;padding:2px 8px;white-space:nowrap">Reviewer</span>`; }
function allDocsLink(){ return `<a href="advisor.html" title="All documents shared with you" style="font-size:13px;color:var(--text-2);text-decoration:none;padding:4px 10px;border:1px solid var(--border);border-radius:8px;white-space:nowrap">← All documents</a>`; }
function _relDays(ts){ if(!ts) return ''; const d=Math.floor((Date.now()-ts)/86400000); return d<=0?'today':d===1?'yesterday':d<7?`${d} days ago`:d<14?'last week':`${Math.floor(d/7)} weeks ago`; }
const RVH_STYLE = `<style id="rvh-style">
  .rvh{--a:var(--accent);--str:#4a7c59;--ink:#211f1a;--faint:#a49e90;--ln:#e4dfd2;--serif:"Fraunces",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace;
    max-width:900px;margin:0 auto;padding:30px 24px 80px;color:var(--ink)}
  .rvh-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--a)}
  .rvh-h1{font-family:var(--serif);font-weight:600;font-size:30px;letter-spacing:-.02em;margin:3px 0 26px}
  .rvh-shelf{display:flex;flex-wrap:wrap;align-items:flex-end;gap:26px 22px;padding:6px 4px 0}
  .rvh-board{height:12px;margin:0 -4px 2px;border-radius:0 0 6px 6px;background:linear-gradient(#e7e0d0,#d8cfba);box-shadow:inset 0 2px 0 rgba(255,255,255,.5),0 10px 22px -12px rgba(40,34,20,.4)}
  .rvh-book{position:relative;display:flex;flex-direction:column;width:176px;min-height:230px;padding:20px 20px 18px 26px;text-decoration:none;color:inherit;text-align:left;cursor:pointer;
    background:linear-gradient(160deg,#fffefb 0%,#faf7ef 100%);border:1px solid var(--ln);border-left:none;border-radius:3px 12px 12px 3px;
    box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 14px 26px -16px rgba(40,34,20,.5),0 3px 6px -4px rgba(40,34,20,.3);transition:transform .18s cubic-bezier(.2,.7,.2,1),box-shadow .2s}
  .rvh-book:hover{transform:translateY(-8px) rotate(-.4deg);box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 26px 40px -18px rgba(40,34,20,.55)}
  .rvh-spine{position:absolute;left:0;top:0;bottom:0;width:11px;border-radius:3px 0 0 3px;background:linear-gradient(90deg,color-mix(in srgb,var(--sp) 78%,#000) 0%,var(--sp) 55%,color-mix(in srgb,var(--sp) 70%,#fff) 100%);box-shadow:1px 0 0 rgba(0,0,0,.12),inset -2px 0 3px rgba(0,0,0,.18)}
  .rvh-by{font-family:var(--mono);font-size:11px;color:var(--str);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rvh-title{font-family:var(--serif);font-weight:500;font-size:19px;line-height:1.15;color:var(--ink);margin-top:10px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .rvh-badge{align-self:flex-start;font-family:var(--mono);font-size:10.5px;font-weight:600;color:#fff;background:var(--a);border-radius:20px;padding:1px 8px;margin-top:8px}
  .rvh-meta{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:auto;padding-top:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rvh-empty{max-width:460px;margin:11vh auto;text-align:center;color:var(--faint)}
  .rvh-empty svg{width:40px;height:40px}
</style>`;
function _homeTopbar(name){
  document.getElementById('topbar').innerHTML =
    `<span style="display:inline-flex;align-items:center;gap:9px">${brandMark('var(--accent)')}<strong style="font-size:16px;font-weight:600">Footnote</strong>${reviewerPill()}</span>`
    + (name ? `<span style="margin-left:auto;font-size:13px;color:var(--text-2)">Reviewing as <b style="font-weight:600">${escapeHtml(name)}</b></span>` : '');
}
// The author's display name for "shared by": their GitHub profile name (public /users/<login>), cached
// per browser, defaulting to the login. Reviewers can't read the author's AUTHOR_NAME (an Actions var).
// Author display name = GitHub profile name (inherited) → the author's typed name (release.json
// author_name) → the login. Two per-browser caches hold the raw profile name and the typed name.
function _cacheObj(key){ try { const v = JSON.parse(_store.get(key) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch { return {}; } }
function _authorDisplay(owner){ return pickAuthorName(_cacheObj('footnote:authorprofile')[owner], _cacheObj('footnote:authortyped')[owner], owner); }
function _refreshBy(list){ list.forEach((e, i) => { if (!e.owner) return; const el = read.querySelector(`.rvh-book[data-i="${i}"] .rvh-by`); if (el) el.textContent = _authorDisplay(e.owner); }); }
async function _resolveAuthorNames(list){
  const cache = _cacheObj('footnote:authorprofile');
  const owners = [...new Set(list.map(e => e.owner).filter(Boolean))].filter(o => !(o in cache));
  if (owners.length){
    await Promise.all(owners.map(async login => {
      try {
        const r = await _gfetch(`${_API}/users/${encodeURIComponent(login)}`, { cache:'no-store' });   // public, unauth (a fine-grained reviewer PAT can't hit /users)
        cache[login] = r.ok ? ((await r.json()).name || '').trim() : '';                                // store the RAW profile name ('' if none) so 'typed' can fill in
      } catch(e){}
    }));
    try { _store.set('footnote:authorprofile', JSON.stringify(cache)); } catch(e){}
  }
  _refreshBy(list);
}
async function _paintHomeBadges(list){
  const typed = _cacheObj('footnote:authortyped'); let typedChanged = false;
  await Promise.all(list.map(async (e, i) => {
    try {
      const [owner, repo] = (e.data || '').split('/'); if (!owner || !repo || !e.k) return;
      const prefix = e.p ? `${e.p}/` : '';
      const r = await _gfetch(`${_API}/repos/${owner}/${repo}/contents/${prefix}release.json?t=${Date.now()}`, { headers:_hdr(e.k), cache:'no-store' });
      if (!r.ok) return;
      const d = await r.json(); if (typeof d.content !== 'string') return;
      const j = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, '')))));
      const an = (j && typeof j.author_name === 'string') ? j.author_name.trim() : '';   // the author's typed name, if they saved one
      if (an && typed[owner] !== an){ typed[owner] = an; typedChanged = true; }
      const rel = (j?.[e.a]?.released) || (j?.['general']?.released) || [];
      const n = newCount(e, rel);
      if (n > 0){ const b = read.querySelector(`.rvh-book[data-i="${i}"] .rvh-badge`); if (b){ b.textContent = `${n} new`; b.style.display=''; } }
    } catch(err){}
  }));
  if (typedChanged){ try { _store.set('footnote:authortyped', JSON.stringify(typed)); } catch(e){} _refreshBy(list); }
}
function renderReviewerHome(){
  const list = recentsList(_rawRecents());
  _homeTopbar(list[0]?.n || '');
  const nav = document.getElementById('nav'), cm = document.getElementById('comments');
  if (nav) nav.style.display = 'none'; if (cm) cm.style.display = 'none';
  const head = `<span class="rvh-eyebrow">Shared with you</span><h1 class="rvh-h1">Documents to review</h1>`;
  if (!list.length){
    read.innerHTML = `${RVH_STYLE}<div class="rvh">${head}<div class="rvh-empty">${brandMark('var(--accent)')}
      <div style="font-size:16px;font-weight:500;margin:12px 0 6px;color:var(--ink)">No documents yet</div>
      <div style="font-size:13px;line-height:1.6">Open the invite link from your email and the document appears here. After that, this is your home for every document shared with you.</div></div></div>`;
    return;
  }
  const books = list.map((e, i) => `<a class="rvh-book" style="--sp:${RVH_SPINES[i % RVH_SPINES.length]}" data-i="${i}">
      <span class="rvh-spine"></span>
      <span class="rvh-by">${escapeHtml(_authorDisplay(e.owner))}</span>
      <span class="rvh-title">${escapeHtml(e.title || e.p || 'Untitled document')}</span>
      <span class="rvh-badge" style="display:none"></span>
      <span class="rvh-meta">opened ${_relDays(e.ts)}</span></a>`).join('');
  read.innerHTML = `${RVH_STYLE}<div class="rvh">${head}<div class="rvh-shelf">${books}</div><div class="rvh-board"></div></div>`;
  read.querySelectorAll('.rvh-book').forEach(el => { el.onclick = () => { location.href = linkFor(list[+el.dataset.i]); }; });
  _paintHomeBadges(list);
  _resolveAuthorNames(list);
}
async function boot(){
  // Magic link: the invite email's URL carries the access key as ?k=<key>. Store it (it wins over any stale
  // key so a fresh invite always works), then scrub it from the address bar so the token isn't left in
  // history or shared by copying the URL. Reviewers just click — no token to paste.
  const _mk = keyFromSearch(location.search);
  if (_mk) {
    if (!writeReviewerKey(_store, _mk)) storageWarn();   // never throws — a blocked browser degrades, it doesn't blank
    try { history.replaceState(null, '', location.pathname + searchWithoutKey(location.search) + location.hash); } catch (e) {}
    keyBad = false;
  }
  // Reviewer Home: a BARE entry (no document target in the URL) shows the reviewer's remembered documents
  // instead of loading a doc. Existing invite links all carry &p= (workspace) or &data= (legacy) and skip
  // this, so their behavior is unchanged; Home is reached only via a bookmark or the "← All documents" link.
  const _q = new URLSearchParams(location.search);
  if (!_q.get('p') && !_q.get('data')){ renderReviewerHome(); return; }
  // Load the instance config FIRST. Advisors are invited PER-PROJECT: their link carries the project's data
  // repo as ?data=owner/repo (they have no hub access). Resolve it, push it into the shared config cache so
  // loadChapters/loadRelease/getJson all read the right project's data repo.
  const _cfg = await loadConfig();
  // &p=<id> means a consolidated-workspace project: prefix every data path with <id>/ so this reviewer reads
  // the right subfolder of the shared workspace repo (loadChapters/getJson/content all honor dataPrefix).
  const _pid = new URLSearchParams(location.search).get('p') || '';
  _PREFIX = _pid ? `${_pid}/` : '';
  const _eff = { ..._cfg, dataRepo: dataRepoFromParams(location.search, _cfg.dataRepo), dataPrefix: _PREFIX };
  _CFG = _eff;   // remembered for the "what am I reviewing?" header
  setConfig(_eff);
  ({ owner:_OWNER, repo:_REPO } = dataRepoParts(_eff));
  DATA_REPO = _eff.dataRepo;
  DOC = _eff.doc.noun; UNIT = _eff.doc.unitNoun; DOCC = DOC.charAt(0).toUpperCase() + DOC.slice(1); UNITC = UNIT.charAt(0).toUpperCase() + UNIT.slice(1);
  CHAPTERS = await loadChapters(tok());   // parsed manifest from the (project's) data repo, not shipped in config
  // F7: a workspace invite that lost its &p= reads the empty repo root. Before falling through to the
  // misleading "nothing shared" state, probe the tree once — if the repo IS a workspace with projects,
  // the link is broken, so say so. Only on the cold no-&p=, no-root-chapters path (never the happy one).
  if (tok() && !_pid && !CHAPTERS.length && workspaceInviteBroken(_pid, CHAPTERS, await _repoTreePaths(tok()))){ showLinkBroken(); return; }
  keyBad = false; revoked = false; await loadRelease(); if (revoked){ showRevoked(); return; } if (keyBad && tok()){ showKeyExpired(); return; }
  HAS_OUTLINE = await _outlineExists();   // gate the home outline card — hidden when the doc ships no outline (journals)
  const _docTitle = await _docTitleFromRepo();   // real title from the data repo (config title is generic → "Untitled")
  if (_docTitle){ _CFG = { ..._CFG, doc:{ ..._CFG.doc, title:_docTitle } }; setConfig(_CFG); }
  // Remember this document so it appears on the reviewer's Home (client-side, per browser, cross-author).
  if (tok() && ADVISOR.id && ADVISOR.id !== '?') recordRecent({ a: ADVISOR.id, n: ADVISOR.name, data: DATA_REPO, p: _pid, k: tok(), owner: (DATA_REPO || '').split('/')[0], title: (_CFG.doc && _CFG.doc.title) || '', seenReleased: released, ts: Date.now() });
  if (SHARED && tok() && !reviewerName()){ showNameEntry(); return; }
  const _r = sessionStorage.getItem('_resume'); if (_r){ sessionStorage.removeItem('_resume'); loadChapter(_r); } else enterHome();   // a refresh returns you to where you were (loadChapter routes __outline__ to the outline)
  startOutbox(); retryPending(); renderBanner();
  ensureTourButton();
  // Only auto-run once the reviewer is actually in (has an access key) — never over the login screen.
  // Mark seen at launch (not just on finish) so a hard refresh doesn't re-show it to a returning reviewer.
  // A brand-new reviewer gets the concise 3-step first-run guide; "Show me" opens the full interactive tour.
  if (tok() && !tourSeen('guide-advisor-v1')){ markTourSeen('guide-advisor-v1'); markTourSeen('tour-advisor-v1'); setTimeout(() => { try { launchFirstRunGuide(); } catch {} }, 1000); } }
// Floating replay button (always available); appended once.
function ensureTourButton(){
  if (document.getElementById('adv-tour-btn')) return;
  const b = document.createElement('button');
  b.id = 'adv-tour-btn'; b.title = 'How to review'; b.className = 'icbtn';
  b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:40;width:36px;height:36px;border-radius:50%;background:var(--bg);border:.5px solid var(--border-2);box-shadow:0 4px 14px rgba(0,0,0,.14)';
  b.innerHTML = '<i class="ti ti-help-circle"></i>';
  // Open the click-through "how to leave comments" guide (static step modal), NOT the animated spotlight
  // tour on demo content. The guide still offers "Show me" for anyone who wants the interactive walkthrough.
  b.onclick = () => launchFirstRunGuide();
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
  document.getElementById('topbar').innerHTML = `<strong style="font-size:16px;font-weight:600">${DOCC} review</strong>`;
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

// Stale-bundle nudge: if the live page now references a NEWER advisor.js than the one we're running, the
// browser is on a cached old build (the exact "it's broken for me but not you" trap). Offer a refresh, and
// stamp the build sha on <html data-build> for diagnosis. Never nags unless both shas are known and differ.
const _BUILD = parseVersion(import.meta.url);
try { if (_BUILD) document.documentElement.dataset.build = _BUILD; } catch (e) {}
async function checkVersion(){
  if (!_BUILD) return;
  try {
    const r = await fetch(location.pathname + '?_ck=' + Date.now(), { cache: 'no-store' });
    if (!r || !r.ok) return;
    if (isStale(_BUILD, latestFromHtml(await r.text(), 'advisor.js')) && !document.getElementById('updbar')){
      const b = document.createElement('div'); b.id = 'updbar';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9998;background:var(--accent);color:#fff;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:9px 14px;text-align:center';
      b.innerHTML = 'A newer version of Footnote is available. <button id="updref" style="margin-left:8px;background:#fff;color:var(--accent);border:0;border-radius:6px;padding:3px 11px;font:inherit;font-weight:600;cursor:pointer">Refresh</button>';
      document.body.appendChild(b);
      const rb = document.getElementById('updref'); if (rb) rb.onclick = () => location.reload();
    }
  } catch (e) {}
}
setTimeout(checkVersion, 6000);        // once shortly after load
setInterval(checkVersion, 900000);     // and every 15 min — a long-open reviewer gets nudged after a deploy
boot().catch(showBootError);           // never leave the reviewer on a blank page when a network blip breaks boot

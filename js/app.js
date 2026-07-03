import { newReview, addComment, updateComment, deleteComment, setDecision, partitionByDecision, queueApproved } from './model.js?v=b9529aa';
import { anchorFromSelection } from './anchor.js?v=b9529aa';
import { reviewPath, mergeReview, getJson, putJson, ghTree, putFile, getDataUrl, deleteFile } from './gh.js?v=b9529aa';
import { PROVIDERS, detectProvider, genKey, getPublicKey, putSecret, setVariable, dispatchInvite, latestRun, prefillFromGitHub, isScopeError } from './ghsecrets.js?v=b9529aa';
import { sealToBase64 } from './vendor/seal.js?v=b9529aa';
import { isConfigured as ghAppConfigured, startDeviceLogin, pollForToken } from './ghauth.js?v=b9529aa';
import { startTour, tourSeen, markTourSeen } from './tour.js?v=b9529aa';

// Guided owner tour — points only at elements that are reliably present on the home view, so nothing
// is mis-highlighted. The engine skips any step whose element is absent.
const OWNER_TOUR = [
  { sel:'#btn-token', title:'Add your access token', body:'The reviewer reads your private data with a GitHub token that stays only in this browser. Paste a fine-grained token with Contents read/write on your data repo here first.' },
  { sel:'.chcard', title:'Your chapters', body:'Each card opens a chapter to read and to work through your advisors\' comments. The bar shows how far along you are.' },
  { sel:'#inbox-panel', title:'Needs you', body:'Your triage center. Across every chapter it gathers comments waiting on you, edits staged to approve, and finished jobs. Click any count to jump straight there.' },
  { sel:'#btn-releases', title:'Invite advisors and release chapters', body:'Add advisors, connect email so invites send on their own, and choose which chapters each advisor can see.' },
  { sel:'#btn-outline', title:'Share your outline early', body:'Post your planned structure so advisors can comment on it before the full chapters are ready.' },
  { sel:'#btn-export', title:'Show advisors how you responded', body:'Generate a printable summary of how you addressed each advisor\'s comments. This is a response summary, not a document export.' },
  { sel:'#dl-export-all', title:'Export the document', body:'Download the whole dissertation, or any single chapter, as Word, PDF, or Markdown with comments and tracked changes included.' },
  { sel:'#btn-tour', title:'Replay anytime', body:'Reopen this tour or turn auto-show off from here. Open any chapter, then use the More menu for the reviewing walkthrough.' },
];
// Small menu on the home "?" button: replay the tour, or toggle auto-show for first-time users.
function openTourMenu(){
  document.getElementById('tourmenu')?.remove();
  const btn = document.getElementById('btn-tour'); if (!btn) return;
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div'); m.id = 'tourmenu';
  m.style.cssText = `position:absolute;top:${r.bottom+6}px;right:${Math.max(8, window.innerWidth-r.right)}px;z-index:46;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.16);padding:6px;min-width:230px`;
  const off = tourSeen('tour-owner-v1');
  m.innerHTML = `<div class="mmi" data-a="run"><i class="ti ti-help-circle"></i>Take the setup tour</div>
    <div class="mmi" data-a="chapter"><i class="ti ti-book-2"></i>Reviewing a chapter (demo)</div>
    <div class="mmi" data-a="toggle"><i class="ti ti-${off?'eye-off':'eye-check'}"></i>Auto-show for new users: ${off?'off':'on'}</div>`;
  document.body.appendChild(m);
  m.querySelectorAll('.mmi').forEach(el => { el.onmouseenter = () => el.style.background='var(--bg-3)'; el.onmouseleave = () => el.style.background='transparent';
    el.onclick = () => { m.remove();
      if (el.dataset.a === 'run') launchOwnerTour();
      else if (el.dataset.a === 'chapter') launchOwnerChapterTour();
      else if (tourSeen('tour-owner-v1')){ localStorage.removeItem('tour-owner-v1'); flash('Auto-tour on — it\'ll show on next load.'); }
      else { markTourSeen('tour-owner-v1'); flash('Auto-tour turned off.'); } }; });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!m.contains(e.target) && e.target.id!=='btn-tour' && !e.target.closest?.('#btn-tour')){ m.remove(); document.removeEventListener('click', h); } }), 0);
}
function launchOwnerTour(){ startTour(OWNER_TOUR, { storageKey:'tour-owner-v1' }); }
// The tour's demo chapter is a fully STATIC, dead mock — NOT the live tool. It borrows the real
// builders (buildAdvCard / buildCommentCard) only to capture exact markup, then injects that as
// inert HTML strings: none of the real .onclick wiring comes along, so Queue for merge, Resolution,
// Send to Claude and Approve do nothing. `demoMode` silences the text-selection composer, and the
// topbar Send button is unwired. Nothing here is live or saved; teardown just re-renders the real
// view. This mirrors the advisor demo's static fake page instead of muzzling live components.
let demoMode = false;
function loadDemoChapterOwner(){
  const rd = document.getElementById('read'); if (!rd) return () => {};
  const cmt = document.getElementById('comments');
  const prevReading = !!document.querySelector('#doc'), prevCurrent = current;
  if (!CHAPTERS.some(c => c.id === current)) current = CHAPTERS[0].id;   // valid chapter name for the topbar
  demoMode = true;
  document.getElementById('nav').style.display = ''; cmt.style.display = '';
  renderTopbar();   // chapter topbar so #btn-more exists for the tour to point at
  const bs = document.getElementById('btn-send'); if (bs) bs.onclick = null;   // topbar Send to Claude: dead in the demo
  const fig = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="520" height="200"><rect width="520" height="200" fill="#e9e7e1"/><text x="260" y="106" font-family="sans-serif" font-size="16" fill="#8f8d84" text-anchor="middle">Sample figure</text></svg>');
  // Sample data used ONLY to generate exact card markup — never written to the live globals.
  const demoAdv = { id:'demo-adv', _advisor:'demo', read:false, kind:'text', tag:'wording', status:'submitted',
    anchor:{ quote:'radio-frequency heating enables rapid, volumetric energy delivery' }, body:'Consider defining this for a general reader.', created_ts:new Date().toISOString() };
  const demoSug = { id:'demo-sug', kind:'suggestion', tag:'wording', status:'staged', decision:'approve',
    anchor:{ quote:'quis nostrud exercitation ullamco laboris' }, body:'Tighten this phrasing for a general reader.',
    staged_edit:{ before:'quis nostrud exercitation ullamco laboris', after:'clearer, simpler wording' }, created_ts:new Date().toISOString() };
  const advCard = buildAdvCard(demoAdv).outerHTML;      // exact markup; the .onclick wiring does not survive as a string
  const sugCard = buildCommentCard(demoSug).outerHTML;
  // Static reading view: the advisor tour's lorem page, with the advisor comment highlighted and one
  // staged edit shown inline as tracked changes. All baked in; none of it is live.
  rd.innerHTML = `<div id="approvebar" class="approvebar"><i class="ti ti-git-pull-request"></i><span><b>1</b> staged change — <b>1</b> approved · 0 rejected · 0 to decide. shown inline as <span class="tc-legend"><del>old</del> <ins>new</ins></span>.</span><button class="btn" id="preview-btn" style="margin-left:auto"><i class="ti ti-eye"></i>Preview rendered</button><button class="btn btn-primary" id="merge-approved">Queue 1 for merge</button></div>
    <article id="doc">
      <h1>Sample chapter (tour preview)</h1>
      <p id="tour-demo-select">This preview chapter shows how reviewing works. Lorem ipsum dolor sit amet, consectetur adipiscing elit; <mark class="cmark" data-aid="demo-adv">radio-frequency heating enables rapid, volumetric energy delivery</mark> through a dielectric medium. Select any words here to attach a comment.</p>
      <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Ut enim ad minim veniam, <del class="tc-stage">quis nostrud exercitation ullamco laboris</del><ins class="tc-stage"> clearer, simpler wording</ins> nisi.</p>
      <figure><img alt="Sample figure" src="${fig}"><figcaption>Figure 3.1. A sample figure. Click it to comment on the figure itself.</figcaption></figure>
      <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
      <table><caption>Table 3.1. Sample results.</caption><thead><tr><th>Case</th><th>Value</th></tr></thead>
        <tbody><tr><td>Baseline</td><td>12.4</td></tr><tr><td>Compensated</td><td>4.1</td></tr></tbody></table>
      <p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam.</p></article>`;
  cmt.innerHTML = `<div class="lbl">COMMENTS<span style="margin-left:auto">1 · 0 open</span></div>
    ${sugCard}
    <div class="lbl adv-lbl"><i class="ti ti-users" style="margin-right:5px"></i>FROM ADVISORS<span style="margin-left:auto">1</span></div>
    ${advCard}`;
  return () => { demoMode = false;   // nothing live was touched — just re-render the real view
    if (prevReading && CHAPTERS.some(c => c.id === prevCurrent)){ current = prevCurrent; enterChapter(prevCurrent); }
    else { current = prevCurrent; enterHome(); } };
}
const OWNER_CHAPTER_TOUR = [
  { sel:'#doc h1', title:'Inside a chapter', body:'The reading view. We loaded a sample chapter with a sample advisor comment and a staged edit so you can see the workflow. Nothing here is saved.' },
  { sel:'.ccard.adv', title:'Advisors\' comments land here', body:'Every comment your advisors leave shows here, pinned to the exact spot. Its buttons carry the full action set: Jump to it, Reply so they see your answer, add a Private note only you see, Suggest an edit, record a Resolution, or Send it to Claude.' },
  { sel:'.ccard.adv .a-rec', title:'Record how you handled it', body:'Resolution lets you pick Addressed, Kept as written, or Noted, add an optional note, and Save to advisor. They see the outcome in their Responses view.' },
  { sel:'.ccard.adv .a-send', title:'Or hand it to Claude', body:'Once you have read a comment, send it to Claude to draft the edit. You still approve the result before anything lands.' },
  { sel:'#doc ins.tc-stage', title:'Proposed edits show inline', body:'A staged edit shows as tracked changes right in the text, the old wording struck through and the new wording in place.' },
  { sel:'#approvebar', title:'Approve and merge', body:'The bar tallies what is approved, rejected, or still to decide. Preview the rendered result, then Queue the approved edits for merge.' },
  { sel:'#tour-demo-select', title:'Comment yourself too', body:'Select any text to leave your own note or propose exact replacement wording, the same way your advisors do.', pin:'bl' },
  { sel:'#doc figure', title:'Comment on a figure', body:'Click a figure to comment on it, and you can draw a box or circle to point at the exact spot.', pin:'bl' },
  { sel:'#doc table', title:'Everything is reviewable', body:'Tables and equations take comments too, not just paragraphs. Your advisors can weigh in on all of them the same way.' },
  { sel:'#btn-more', title:'That is the loop', body:'Read, resolve, approve, merge. Reopen this walkthrough anytime from the More menu.' },
];
function launchOwnerChapterTour(){ const restore = loadDemoChapterOwner(); startTour(OWNER_CHAPTER_TOUR, { storageKey:'tour-owner-chapter-v1', onDone: restore }); }
// Mark seen the moment it auto-launches (not just on finish) so a hard refresh never re-triggers it
// for a returning user. The ⋯ menu lets them replay it or turn auto-show back on.
if (!tourSeen('tour-owner-v1')){ markTourSeen('tour-owner-v1'); setTimeout(() => { try { launchOwnerTour(); } catch {} }, 1400); }

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
const TAGS = ['claim','wording','figure','citation','question'];
// platform-adaptive modifier label (handlers accept ⌘ or Ctrl; this is just the on-screen text)
const IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

const read = document.getElementById('read');
let current = 'ch_modeling';
let review = loadLocalReview(current);

function loadLocalReview(ch){ return JSON.parse(localStorage.getItem('review:'+ch) || 'null') || newReview(ch, ''); }
const save = () => localStorage.setItem('review:'+current, JSON.stringify(review));
const tok = () => localStorage.getItem('ghpat');

// ---------- GitHub review sync (private data repo) ----------
let reviewSha = null, syncTimer = null, scrollSaveT = null;
// Reconcile local against remote WITHOUT downgrading: a comment the executor moved to a terminal
// state on the server (merged/answered/declined/resolved) always wins over a stale local non-terminal
// status, so a lagging tab can never overwrite a completed merge. Local wins for everything else
// (the owner's in-progress decisions), and remote-only comments are pulled in.
// Only 'merged'/'declined' are truly FINAL (the edit is in main / discarded). 'answered' and
// 'resolved' are re-openable (a reply re-queues, the owner can reopen), so they must NOT block
// adopting the server's newer status — that was leaving re-queued/staged comments stuck.
const FINAL_STATES = new Set(['merged', 'declined']);
function reconcileReview(local, remote, preferRemote){
  if (!remote) return local;
  const deleted = new Set([ ...((local&&local.deleted)||[]), ...((remote.deleted)||[]) ]);  // tombstones: a deleted comment is never resurrected by a sync
  const byId = Object.fromEntries((remote.comments||[]).map(c => [c.id, c]));
  const adopt = (lc, rc) => ({ ...lc, status:rc.status, claude:rc.claude, staged_edit:rc.staged_edit, resolution:rc.resolution, anchor:rc.anchor });
  const comments = (local.comments||[]).filter(lc => !deleted.has(lc.id)).map(lc => {
    const rc = byId[lc.id]; if (!rc) return lc;
    if (FINAL_STATES.has(rc.status) && !FINAL_STATES.has(lc.status)) return adopt(lc, rc);   // server finalized it (e.g. merged) — adopt, never downgrade
    if (FINAL_STATES.has(lc.status) && !FINAL_STATES.has(rc.status)) return lc;              // local finalized — keep; a working remote can't undo a merge
    if (preferRemote) return adopt(lc, rc);                                                  // syncDown: server is the source of truth for every working state
    return lc;                                                                               // syncUp: keep the owner's local intent (approve/unqueue/reply)
  });
  for (const rc of remote.comments||[]) if (!deleted.has(rc.id) && !comments.find(c => c.id === rc.id)) comments.push(rc);
  return { ...local, comments, ...(deleted.size ? { deleted:[...deleted] } : {}) };
}
async function syncDown(){
  const t = tok(); if (!t) return;
  try { const { json, sha } = await getJson(t, reviewPath(current)); reviewSha = sha;
    if (json){ review = reconcileReview(review, json, true); save(); renderComments(); if (document.getElementById('doc')){ buildNav(); paintHighlights(); refreshStaged(); } } }
  catch(e){ /* offline / first time */ }
}
function syncUpSoon(){ if (!tok()) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncUp, 1200); }
async function syncUp(){
  const t = tok(); if (!t) return;
  for (let attempt = 0; attempt < 5; attempt++){
    try {
      const { json, sha } = await getJson(t, reviewPath(current));
      review = reconcileReview(review, json, false);     // syncUp: keep local intent for working states; never downgrade a remote terminal (no merge clobber)
      save();
      reviewSha = await putJson(t, reviewPath(current), review, sha || reviewSha, 'review: '+current, false);
      renderComments(); if (document.getElementById('doc')) refreshStaged();
      return;
    } catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r => setTimeout(r, 250*(attempt+1))); continue; } return; /* offline: retried on next change */ }
  }
}

// ---------- top bar ----------
function renderTopbar(){
  const m = chMeta(current);
  document.getElementById('topbar').innerHTML = `
    <button class="icbtn" id="btn-home" title="All chapters"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel"><i class="ti ti-book-2"></i><span>Chapter ${m.n} · ${shortTitle(m.title)}</span><i class="ti ti-chevron-down" style="font-size:15px;color:var(--text-3)"></i></button>
    <div class="search"><i class="ti ti-search"></i><input id="search" placeholder="Search chapter · ${MOD}\\ for all"></div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      <button class="icbtn" id="btn-focus" title="Focus mode (f)"><i class="ti ti-arrows-diagonal-minimize-2"></i></button>
      <button class="icbtn" id="btn-history" title="History"><i class="ti ti-history"></i></button>
      <button class="icbtn" id="btn-theme" title="Theme"><i class="ti ti-moon"></i></button>
      <button class="btn btn-primary" id="btn-send"><i class="ti ti-send"></i>Send to Claude</button>
      <button class="icbtn" id="btn-more" title="More"><i class="ti ti-dots"></i></button>
    </div>`;
  document.getElementById('btn-home').onclick = enterHome;
  document.getElementById('chsel').onclick = openChapterMenu;
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-send').onclick = openSendMenu;
  document.getElementById('btn-history').onclick = showHistory;
  document.getElementById('btn-focus').onclick = toggleFocus;
  document.getElementById('btn-more').onclick = openMoreMenu;
  const si = document.getElementById('search');
  si.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(si.value); if (e.key === 'Escape'){ si.value=''; clearSearch(); } });
}
const shortTitle = t => { const s = t.split(':')[0].trim(); return s.length <= 34 ? s : s.slice(0,34).replace(/\s\S*$/,'') + '…'; };

function openChapterMenu(){
  const old = document.getElementById('chmenu'); if (old){ old.remove(); return; }
  const menu = document.createElement('div'); menu.id = 'chmenu';
  menu.style.cssText = 'position:absolute;top:50px;left:16px;z-index:40;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 34px rgba(0,0,0,.16);padding:6px;min-width:330px';
  menu.innerHTML = CHAPTERS.map(c => `<div data-ch="${c.id}" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px${c.id===current?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px">${c.n}</span>${shortTitle(c.title)}</div>`).join('');
  menu.querySelectorAll('[data-ch]').forEach(d => { d.onmouseenter = () => { if (d.dataset.ch!==current) d.style.background='var(--bg-3)'; };
    d.onmouseleave = () => { if (d.dataset.ch!==current) d.style.background='transparent'; };
    d.onclick = () => { menu.remove(); selectChapter(d.dataset.ch); }; });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='chsel'){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
function doRefresh(){ try{ sessionStorage.setItem('_resume', current||''); }catch(e){} const u = new URL(location.href); u.searchParams.set('_r', Date.now()); location.replace(u.toString()); }   // reload for a fresh deploy, keeping your place
function enterChapter(ch){ if (ch === '__outline__'){ localStorage.setItem('lastChapter', ch); loadOwnerOutline(); return; }   // the outline isn't a real chapter — don't try to fetch it
  current = ch; review = loadLocalReview(ch); localStorage.setItem('lastChapter', ch);
  document.getElementById('nav').style.display = ''; document.getElementById('comments').style.display = '';
  renderTopbar(); renderComments(); loadChapter(ch); }
const selectChapter = enterChapter;
function toggleTheme(){ document.documentElement.classList.toggle('dark'); localStorage.setItem('theme', document.documentElement.classList.contains('dark')?'dark':'light'); }
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');

// ---------- content (GitHub-pulled; localhost dev-fallback for UI work only) ----------
async function loadChapter(ch){
  previewing = false;
  read.innerHTML = `<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Loading chapter ${chMeta(ch).n}…</div></div>`;
  const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (dev){ try { const r = await fetch(`./chapters/${ch}.html`); if (r.ok){ renderDoc(await r.text()); return; } } catch(e){} }
  const t = tok();
  if (!t){ renderConnect(); return; }
  try {
    const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/content/${ch}.html`,
      { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' } });
    if (!r.ok) throw new Error('HTTP '+r.status);
    renderDoc(await r.text());
  } catch(e){
    if (/\b401\b/.test(e.message)){ read.innerHTML = `<div class="empty"><i class="ti ti-key-off" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Your access token expired</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:14px">Fine-grained tokens are time-limited. Generate a new one (Contents: read on the data repo) and re-enter it.</div>
      <button class="btn btn-primary" id="connect">Enter a new token</button></div>`;
      document.getElementById('connect').onclick = () => { const v = prompt('New fine-grained PAT:'); if (v){ localStorage.setItem('ghpat', v.trim()); loadChapter(current); } };
      return; }
    read.innerHTML = `<div class="empty">Couldn't pull chapter ${chMeta(ch).n} from your private repo (${e.message}). Check the access token in <b>⋯ → Settings</b>.</div>`; }
}
function renderConnect(){
  read.innerHTML = `<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Connect your dissertation</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Chapters are pulled privately from your <code>${DATA_REPO}</code> repo. Paste a fine-grained token (Contents: read) — stored only in this browser.</div>
    <button class="btn" id="connect">Add access token</button></div>`;
  document.getElementById('connect').onclick = () => { const v = prompt('Fine-grained PAT (Contents read on the data repo):'); if (v){ localStorage.setItem('ghpat', v.trim()); loadChapter(current); } };
}

function renderDoc(fragment){
  read.innerHTML = `<article id="doc">${fragment}</article>`;
  const doc = document.getElementById('doc');
  fixFootnotes(doc);
  runKatex(doc);
  wireFigures(doc);
  wireCitations(doc);
  linkCrossRefs(doc);
  buildNav();
  paintHighlights();
  refreshStaged();
  restoreCursor();
  syncDown();
  loadAdvisorComments(current);
  startOwnerLiveSync();
  if (!previewing) loadSrcmapPencils(current);
}
// ---------- in-context direct editor (prose -> confirm LaTeX diff -> stage) ----------
const _srcmap = {};   // ch -> { normHead: source_text }
const _normHead = s => (s||'').replace(/\s+/g,' ').trim().slice(0,80).toLowerCase();
async function loadSrcmapPencils(ch){
  try {
    if (!_srcmap[ch]){
      const dev = location.hostname==='localhost' || location.hostname==='127.0.0.1';
      let json = null;
      if (dev){ const r = await fetch(`./content/${ch}.srcmap.json`); if (r.ok) json = await r.json(); }
      else { const t = tok(); if (!t) return; const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/content/${ch}.srcmap.json?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' }); if (r.ok) json = await r.json(); }
      _srcmap[ch] = {}; for (const e of (json?.paragraphs||[])) _srcmap[ch][_normHead(e.head)] = e.source_text;
    }
    const map = _srcmap[ch]; if (!map || !Object.keys(map).length) return;
    document.querySelectorAll('#doc p').forEach(p => {
      if (p.closest('figure, #footnotes, .references, #refs')) return;
      const txt = p.textContent || ''; if (txt.trim().length < 24) return;
      const src = map[_normHead(txt)]; if (!src || p.querySelector('.pen-btn')) return;
      p.classList.add('editable-p');
      const btn = document.createElement('button'); btn.className = 'pen-btn'; btn.title = 'Edit this paragraph';
      btn.innerHTML = '<i class="ti ti-pencil"></i>';
      btn.onclick = e => { e.stopPropagation(); startDirectEdit(p, src); };
      p.appendChild(btn);
    });
  } catch(e){ /* editor is optional; never block reading */ }
}
function startDirectEdit(p, source){
  if (document.querySelector('.pedit')) return;
  const proseBefore = (p.textContent||'').replace(/\s+/g,' ').trim();
  const box = document.createElement('div'); box.className = 'pedit';
  box.innerHTML = `<textarea class="pedit-ta"></textarea>
    <div class="pedit-acts"><button class="btn btn-primary pedit-next">Review change →</button><button class="btn pedit-cancel">Cancel</button>
      <span style="font-size:11.5px;color:var(--text-3);margin-left:4px">Edit the prose; you'll confirm the LaTeX before it stages.</span></div>`;
  p.style.display = 'none'; p.after(box);
  const ta = box.querySelector('.pedit-ta'); ta.value = proseBefore; ta.style.height = Math.max(70, ta.scrollHeight)+'px'; ta.focus();
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight+'px'; };
  const close = () => { box.remove(); p.style.display = ''; };
  box.querySelector('.pedit-cancel').onclick = close;
  box.querySelector('.pedit-next').onclick = () => { const after = ta.value.replace(/\s+/g,' ').trim();
    if (after === proseBefore){ close(); return; } confirmDirectEdit(p, source, proseBefore, after, close); };
}
// word-level common prefix/suffix -> single changed span; transpose onto the LaTeX source if uniquely locatable
function transposeToSource(before, after, source){
  const a = before.split(/\s+/), b = after.split(/\s+/);
  let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length-pre && suf < b.length-pre && a[a.length-1-suf] === b[b.length-1-suf]) suf++;
  const oldMid = a.slice(pre, a.length-suf).join(' '), newMid = b.slice(pre, b.length-suf).join(' ');
  if (oldMid && source.split(oldMid).length === 2) return { replacement: source.replace(oldMid, newMid), auto:true };
  return { replacement: source, auto:false };   // couldn't safely map — owner edits the source directly
}
function confirmDirectEdit(p, source, before, after, closeEditor){
  const { replacement, auto } = transposeToSource(before, after, source);
  const back = document.createElement('div'); back.className = 'pconfirm-back';
  back.innerHTML = `<div class="pconfirm">
      <div style="font-size:15px;font-weight:600;margin-bottom:3px">Confirm the LaTeX change</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">${auto ? 'Your prose edit was mapped to the source below — confirm or adjust it.' : "Couldn't auto-map your edit to the LaTeX (it touches markup or math) — make the change in the source below."}</div>
      <div class="pc-lbl">Your prose change</div>
      <div class="pc-prose"><div class="pc-before">${escapeHtml(before)}</div><div class="pc-after">${escapeHtml(after)}</div></div>
      <div class="pc-lbl" style="margin-top:12px">LaTeX source — original</div>
      <pre class="pc-src pc-orig">${escapeHtml(source)}</pre>
      <div class="pc-lbl" style="margin-top:10px">LaTeX source — new (editable)</div>
      <textarea class="pc-new">${escapeHtml(replacement)}</textarea>
      <div class="pc-acts"><button class="btn btn-primary pc-stage">Stage this edit</button><button class="btn pc-cancel">Cancel</button>
        <span class="pc-stat" style="font-size:11.5px;color:var(--text-3)"></span></div></div>`;
  document.body.appendChild(back);
  back.onclick = e => { if (e.target === back) back.remove(); };
  back.querySelector('.pc-cancel').onclick = () => back.remove();
  back.querySelector('.pc-stage').onclick = async () => {
    const newSource = back.querySelector('.pc-new').value;
    if (newSource === source){ back.querySelector('.pc-stat').textContent = 'No source change.'; return; }
    back.querySelector('.pc-stat').textContent = 'Staging…';
    try { await stageDirectEdit(current, source, newSource, before, after);
      back.remove(); closeEditor();
      p.classList.add('p-staged'); p.style.display = ''; flash('Staged — preview, then Approve & merge.'); }
    catch(e){ back.querySelector('.pc-stat').textContent = 'Failed: ' + e.message; }
  };
}
async function stageDirectEdit(ch, source, newSource, before, after){
  const t = tok(); if (!t) throw new Error('add your access token first');
  // record as a first-class staged edit in the owner review, then queue a deterministic apply-direct job
  review = addComment(review, { anchor:{ quote: before.slice(0,90), section:'' }, kind:'direct', tag:'edit',
    body:'Direct edit', edit:{ op:'replace', find:source, replacement:newSource } });
  const nc = review.comments[review.comments.length-1];
  nc.prose_before = before; nc.prose_after = after;
  review = updateComment(review, nc.id, { status:'queued' });
  save(); await syncUp();
  const { json, sha } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(json) ? json : [];
  jobs.push({ id:'j_'+Date.now().toString(36), type:'apply-direct', chapter:ch, comment_ids:[nc.id], status:'queued', requested_ts:new Date().toISOString() });
  await putJson(t, 'jobs.json', jobs, sha, `direct: stage edit on ${ch}`);
  renderComments(); refreshStaged();
}
// ---------- advisor comments surfaced in the owner reviewer ----------
const ADVISOR_IDS = ['CJS','CCS'];
const ADVISOR_NAME = { CJS:'Saldaña', CCS:'Seepersad' };
// label a comment's source: named advisor → their name; a shared lab reviewer (general-<slug>) → the name they entered
const whoLabel = c => ADVISOR_NAME[c._advisor] || (/^general-/.test(c._advisor||'') ? (c.author || 'Lab reviewer') : c._advisor);
// an advisor's follow-up replies (when they felt a response was incomplete) + a re-opened flag
const fupHtml = c => (c.followups||[]).map(f => `<div class="rel-fup"><i class="ti ti-corner-down-right" style="font-size:13px"></i> ${escapeHtml(f.text)} <span style="color:var(--text-3);font-size:11px">· ${(f.ts||'').slice(0,10)}</span></div>`).join('');
const threadHtml = c => (c.thread||[]).map(m => `<div class="rel-fup" style="border-left-color:${m.author==='author'?'var(--accent)':'var(--success)'}"><b>${m.author==='author'?'You':'Reviewer'}</b> <span style="color:var(--text-3);font-size:11px">· ${fmtDate(m.ts)}</span><div>${escapeHtml(m.text)}</div></div>`).join('');
let advisorComments = [];
async function loadAdvisorComments(ch){
  advisorComments = []; const dev = location.hostname==='localhost' || location.hostname==='127.0.0.1';
  let ids = ADVISOR_IDS;
  if (!dev){ const t = tok(); if (t){ try { const paths = await ghTree(t); const re = new RegExp(`^advisor/([^/]+)/${ch}\\.json$`);
    ids = [...new Set(paths.map(p => { const m = p.match(re); return m && m[1]; }).filter(Boolean))]; } catch(e){} } }
  for (const a of ids){
    try {
      let json = null;
      if (dev){ const r = await fetch(`./advisor/${a}/${ch}.json`); if (r.ok) json = await r.json(); }
      else { const t = tok(); if (!t) continue; json = (await getJson(t, `advisor/${a}/${ch}.json`)).json; }
      (json?.comments||[]).forEach(c => { if (c.status!=='open') advisorComments.push({ ...c, _advisor:a }); });   // hide only unsubmitted drafts (status 'open'); keep 'resolved' so it folds into the Resolved group, not vanishes
    } catch(e){}
  }
  if (!dev){ const t = tok(); if (t){ try { advNotesState = await loadAdvisorNotes(t); } catch(e){ advNotesState = { notes:{}, sha:null }; } } }
  if (current === ch){ renderComments(); paintHighlights(); }
}
// Live polling for the owner: refresh advisor comments on a cadence + on tab refocus, without
// disrupting the author. Guard: skip while a textarea in the comment/reply area has focus, and
// preserve the comment-rail scroll across a refresh. New comment cards get a one-shot flash.
let ownerPollTimer = null;
function ownerBusy(){ const a = document.activeElement; return !!(a && (a.tagName === 'TEXTAREA' || a.isContentEditable)); }
function seenCommentIds(){ return new Set([...document.querySelectorAll('#comments [data-aid]')].map(e => e.dataset.aid)); }
async function ownerLivePoll(){
  // Only auto-refresh the reading view's comment rail (the "I had to reload to see comments" pain).
  // The release panel is NOT auto-rebuilt — its full re-render would collapse expanded groups and
  // clobber the notify-email field mid-edit; that stays manual (deferred follow-up).
  if (document.hidden || ownerBusy() || !tok()) return;
  if (typeof current === 'undefined' || !current) return;   // not in a chapter → nothing to poll
  const rail = document.querySelector('#comments, .comment-rail'); const top = rail ? rail.scrollTop : 0;
  const before = seenCommentIds();
  try { await loadAdvisorComments(current); } catch(e){ return; }
  const railNow = document.querySelector('#comments, .comment-rail'); if (railNow) railNow.scrollTop = top;
  document.querySelectorAll('#comments [data-aid]').forEach(el => { if (!before.has(el.dataset.aid)){ el.classList.add('cmt-new'); setTimeout(() => el.classList.remove('cmt-new'), 2200); } });
}
function startOwnerLiveSync(){ stopOwnerLiveSync(); ownerPollTimer = setInterval(ownerLivePoll, 20000); }
function stopOwnerLiveSync(){ if (ownerPollTimer){ clearInterval(ownerPollTimer); ownerPollTimer = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) ownerLivePoll(); });
let advNotesState = { notes:{}, sha:null };   // owner-private notes, shared by the rail + panel
// ---------- clickable cross-references (Figure / Table / Section / Chapter N.M) ----------
const chapterByNum = n => CHAPTERS.find(c => c.n === n);
function sectionNumberMap(doc){
  const n = chMeta(current).n; const map = {}; let h2 = 0, h3 = 0;
  doc.querySelectorAll('h2, h3').forEach(h => { if (h.tagName==='H2'){ h2++; h3 = 0; map[`${n}.${h2}`] = h; } else { h3++; map[`${n}.${h2}.${h3}`] = h; } });
  return map;
}
function figTableMaps(doc){   // read the real number from the numbered caption (robust to pandoc's nested subfigures)
  const fig = {}, tab = {};
  doc.querySelectorAll('figure').forEach(f => {
    const m = (f.querySelector(':scope > figcaption')?.textContent || '').match(/^\s*Figure\s+(\d+(?:\.\d+)*)\./);
    if (m) fig[m[1]] = f;
  });
  doc.querySelectorAll('table caption, figcaption').forEach(c => {
    const m = c.textContent.match(/^\s*Table\s+(\d+(?:\.\d+)*)\./);
    if (m) tab[m[1]] = c.closest('figure') || c.closest('table') || c;
  });
  return { fig, tab };
}
function linkCrossRefs(doc){
  const secMap = sectionNumberMap(doc), ftMap = figTableMaps(doc), curN = chMeta(current).n;
  const re = /\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+(\d+(?:\.\d+)*)/gi;
  const reTest = /\b(Figures?|Fig\.?|Tables?|Sections?|Chapters?)\s+\d/i;   // non-global: stateless .test()
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
    acceptNode: t => { if (!t.nodeValue.trim() || !reTest.test(t.nodeValue)) return NodeFilter.FILTER_REJECT;
      const bad = t.parentElement?.closest('a, h1, h2, h3, figcaption, .math, .katex, #footnotes, script, style');
      return bad ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
  const todo = []; let node; while ((node = walker.nextNode())) todo.push(node);
  todo.forEach(text => {
    const frag = document.createDocumentFragment(); let last = 0; const s = text.nodeValue; re.lastIndex = 0; let m;
    while ((m = re.exec(s))){
      const kindWord = m[1], num = m[2], lead = parseInt(num, 10);
      const isFig = /^Fig/i.test(kindWord), isTab = /^Tab/i.test(kindWord), isChap = /^Chap/i.test(kindWord);
      let handler = null;
      if (isFig || isTab){
        if (lead === curN){ const t = (isFig ? ftMap.fig : ftMap.tab)[num]; if (t) handler = () => scrollFlash(t); }
        else { const ch = chapterByNum(lead); if (ch) handler = () => enterChapter(ch.id); } }
      else if (isChap){ const ch = chapterByNum(lead); if (ch && ch.id !== current) handler = () => enterChapter(ch.id); }
      else { // Section
        if (lead === curN){ const h = secMap[num]; if (h) handler = () => scrollFlash(h); }
        else { const ch = chapterByNum(lead); if (ch) handler = () => enterChapter(ch.id); } }
      if (last < m.index) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (handler){ const a = document.createElement('a'); a.className = 'xref'; a.textContent = m[0]; a.href = 'javascript:void 0';
        a.onclick = e => { e.preventDefault(); e.stopPropagation(); handler(); }; frag.appendChild(a); }
      else frag.appendChild(document.createTextNode(m[0]));
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    text.parentNode.replaceChild(frag, text);
  });
}
function scrollFlash(el){ el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
// ---------- figure commenting ----------
function figureLabel(fig){
  const cap = fig.querySelector('figcaption')?.textContent.trim() || '';
  const m = cap.match(/^(Figure|Fig\.?|Table)\s*[\d.]+/i);
  return { quote: cap.slice(0, 150), label: (m ? m[0] : '') , id: fig.querySelector('img')?.getAttribute('src')?.slice(-40) || '' };
}
function wireFigures(doc){
  doc.querySelectorAll('figure, img').forEach(el => {
    const fig = el.tagName === 'FIGURE' ? el : (el.closest('figure') || el);
    if (fig.dataset.figWired) return; fig.dataset.figWired = '1'; fig.classList.add('fig-commentable');
    fig.addEventListener('click', e => {
      if (window.getSelection().toString().trim()) return;     // a text drag, not a figure click
      e.stopPropagation(); document.getElementById('pop')?.remove();
      const info = figureLabel(fig);
      const rr = read.getBoundingClientRect(), fr = fig.getBoundingClientRect();
      const rects = [{ x:fr.x-rr.x, y:fr.y-rr.y+read.scrollTop, w:fr.width, h:fr.height }];
      pending = { quote: info.label ? `${info.label}${info.quote?': '+info.quote:''}` : (info.quote || 'Figure'),
                  kind:'figure', figure:info.id, section: headingFor(fig), confirmed:true, rects:[] };
      showPopover(pending, rects, 'figure', fig);
    });
  });
  // tables and display equations are commentable too (no drawing — they carry no raster image)
  doc.querySelectorAll('table, .katex-display').forEach(el => {
    if (el.dataset.blkWired) return;
    if (el.closest('figure')?.dataset.figWired) return;   // already handled by its figure
    el.dataset.blkWired = '1'; el.classList.add('blk-commentable');
    el.addEventListener('click', e => {
      if (window.getSelection().toString().trim()) return;
      e.stopPropagation(); document.getElementById('pop')?.remove();
      const isTable = el.tagName === 'TABLE';
      let label = '', quote = '';
      if (isTable){
        const cap = el.querySelector('caption')?.textContent.trim() || el.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
        const m = cap.match(/^\s*Table\s+[\d.]+/i); label = m ? m[0].trim() : 'Table'; quote = cap.slice(0,150) || 'Table';
      } else {
        const num = (el.querySelector('.tag, .eqn-num')?.textContent || '').replace(/[()]/g,'').trim();
        label = num ? `Equation (${num})` : 'Equation'; quote = (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120) || 'Equation';
      }
      const rr = read.getBoundingClientRect(), fr = el.getBoundingClientRect();
      const rects = [{ x:fr.x-rr.x, y:fr.y-rr.y+read.scrollTop, w:fr.width, h:fr.height }];
      pending = { quote: label ? `${label}: ${quote}` : quote, kind:'figure', figure:label, section: headingFor(el), confirmed:true, rects:[] };
      showPopover(pending, rects, isTable ? 'figure' : 'claim');   // no figEl → no Draw button
    });
  });
}
// siunitx unit/prefix macros KaTeX doesn't know — expand to upright text so e.g. 119\,n\henry → 119 nH.
// Names that collide with real KaTeX macros (\bar accent, \square symbol) are deliberately excluded.
const SIUNITX = {
  henry:'H', farad:'F', ohm:'\\Omega', siemens:'S', volt:'V', watt:'W', ampere:'A', kelvin:'K',
  hertz:'Hz', joule:'J', newton:'N', pascal:'Pa', metre:'m', meter:'m', gram:'g',
  mole:'mol', tesla:'T', weber:'Wb', coulomb:'C', radian:'rad', steradian:'sr', lumen:'lm',
  candela:'cd', becquerel:'Bq', sievert:'Sv', katal:'kat', decibel:'dB',
  inch:'in', poise:'P',   // project-declared custom siunitx units (\bar deliberately omitted — collides with KaTeX \bar accent)
  percent:'\\%', degree:'^\\circ', arcminute:"'", arcsecond:"''",
  nano:'n', micro:'\\mu', milli:'m', pico:'p', femto:'f', kilo:'k', mega:'M', giga:'G',
  centi:'c', deci:'d', deca:'da', hecto:'h', atto:'a',
};
function expandUnits(tex){
  return tex.replace(/\\degreeCelsius\b/g, '{}^\\circ\\mathrm{C}')
            .replace(/\\([a-zA-Z]+)\b/g, (m, name) => {
              if (!(name in SIUNITX)) return m;
              const v = SIUNITX[name];
              return /^[A-Za-z]+$/.test(v) ? `\\mathrm{${v}}` : v;   // bare letters → upright; \Omega, \mu, ^\circ, % used as-is
            });
}
function runKatex(el){
  if (!window.katex){ setTimeout(() => runKatex(el), 100); return; }
  el.querySelectorAll('span.math').forEach(s => {
    const tex = expandUnits(s.textContent.replace(/\\label\{[^}]*\}/g, ''));   // \label → red error; siunitx units → upright text
    try { window.katex.render(tex, s, { displayMode:s.classList.contains('display'), throwOnError:false }); } catch(e){}
  });
}
// pandoc dumps every footnote in one section at the very end. Rather than reorder the nested
// section-divs (fragile), surface each note inline: clicking the superscript pops the note text
// right where it's referenced. The endnote list stays at the bottom under a "Notes" heading.
function fixFootnotes(doc){
  const fn = doc.querySelector('#footnotes');
  if (fn && !fn.querySelector('h2.fn-h')){ const h = document.createElement('h2'); h.className = 'fn-h'; h.textContent = 'Notes'; fn.insertBefore(h, fn.firstChild); }
  doc.querySelectorAll('a.footnote-ref').forEach(a => {
    a.onclick = e => { e.preventDefault(); e.stopPropagation();
      document.getElementById('fn-tip')?.remove();
      const li = doc.querySelector(a.getAttribute('href')); if (!li) return;
      const html = li.cloneNode(true); html.querySelectorAll('a.footnote-back').forEach(b => b.remove());
      const tip = document.createElement('div'); tip.id = 'fn-tip'; tip.className = 'fn-tip';
      tip.innerHTML = `<div class="fn-tip-h">Note ${a.textContent.replace(/[^0-9]/g,'')}</div>`;
      tip.append(...html.childNodes);   // already KaTeX-rendered by the doc pass — don't re-render (would double the math)
      read.appendChild(tip);
      const rr = read.getBoundingClientRect(), ar = a.getBoundingClientRect();
      tip.style.top = (ar.bottom - rr.top + read.scrollTop + 6) + 'px';
      tip.style.left = Math.min(ar.left - rr.left, read.clientWidth - 360) + 'px';
      const close = ev => { if (!tip.contains(ev.target)){ tip.remove(); document.removeEventListener('mousedown', close); } };
      setTimeout(() => document.addEventListener('mousedown', close), 0);
    };
  });
  doc.querySelectorAll('a.footnote-back').forEach(a => {
    a.onclick = e => { e.preventDefault(); const t = doc.querySelector(a.getAttribute('href')); if (t){ t.scrollIntoView({ behavior:'smooth', block:'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1500); } };
  });
}
// in-text citation numbers → hover shows the reference(s) in a floating card; click jumps to the bibliography
let citeHideT = null;
function hideCiteTip(){ document.getElementById('cite-tip')?.remove(); }
function wireCitations(doc){
  doc.querySelectorAll('.citation').forEach(cit => {
    if (cit.dataset.citeWired) return; cit.dataset.citeWired = '1'; cit.classList.add('cite-link');
    const keys = (cit.dataset.cites || '').split(/\s+/).filter(Boolean);
    cit.addEventListener('mouseenter', () => showCiteTip(cit, keys, doc));
    cit.addEventListener('mouseleave', () => { citeHideT = setTimeout(hideCiteTip, 220); });
    cit.addEventListener('click', e => { e.preventDefault(); e.stopPropagation();
      const ref = keys[0] && document.getElementById('ref-' + keys[0]);
      if (ref){ ref.scrollIntoView({ behavior:'smooth', block:'center' }); ref.classList.add('flash'); setTimeout(() => ref.classList.remove('flash'), 1500); } });
  });
}
function showCiteTip(cit, keys, doc){
  clearTimeout(citeHideT); hideCiteTip();
  const entries = keys.map(k => document.getElementById('ref-' + k)).filter(Boolean);
  if (!entries.length) return;
  const tip = document.createElement('div'); tip.id = 'cite-tip'; tip.className = 'cite-tip';
  tip.innerHTML = entries.map(e => `<div class="cite-entry">${e.innerHTML}</div>`).join('');
  read.appendChild(tip);
  const rr = read.getBoundingClientRect(), ar = cit.getBoundingClientRect();
  tip.style.top = (ar.bottom - rr.top + read.scrollTop + 6) + 'px';
  tip.style.left = Math.max(8, Math.min(ar.left - rr.left, read.clientWidth - 400)) + 'px';
  tip.addEventListener('mouseenter', () => clearTimeout(citeHideT));
  tip.addEventListener('mouseleave', () => { citeHideT = setTimeout(hideCiteTip, 220); });
}

// ---------- left section navigator ----------
function buildNav(){
  const nav = document.getElementById('nav');
  const hs = [...document.querySelectorAll('#doc h2, #doc h3')];
  review.read = review.read || {};
  review.secCount = hs.length;
  const doneN = hs.filter((h,i) => review.read[h.id || ('sec-'+i)]).length;
  nav.innerHTML = `<div class="lbl">SECTIONS<span style="margin-left:auto">${doneN}/${hs.length}</span></div>`;
  hs.forEach((h, i) => {
    if (!h.id) h.id = 'sec-' + i;
    const sub = h.tagName === 'H3';
    const cnt = review.comments.filter(c => !RESOLVED_STATES.has(c.status) && (c.anchor.section||'') === h.textContent.trim()).length;   // active comments only
    const done = !!review.read[h.id];
    const a = document.createElement('a'); a.className = sub ? 'sub' : ''; a.dataset.sec = h.id;
    a.innerHTML = `<button class="chk${done?' on':''}" title="Mark section read"><i class="ti ti-${done?'circle-check-filled':'circle'}"></i></button>
      <span class="nav-t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap${done?';color:var(--text-3)':''}">${h.textContent}</span>${cnt?`<span class="count">${cnt}</span>`:''}`;
    a.querySelector('.nav-t').onclick = () => h.scrollIntoView({ behavior:'smooth', block:'start' });
    a.querySelector('.chk').onclick = e => { e.stopPropagation();
      if (review.read[h.id]) delete review.read[h.id]; else review.read[h.id] = true;
      save(); syncUpSoon(); buildNav(); };
    nav.appendChild(a);
  });
  read.onscroll = () => { let cur = null; hs.forEach(h => { if (h.getBoundingClientRect().top < 140) cur = h.id; });
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.sec === cur));
    review.cursor = { sec: cur };   // scroll only tracks position for resume — it never marks sections read
    clearTimeout(scrollSaveT); scrollSaveT = setTimeout(() => save(), 900); };
  read.onscroll();
}

// ---------- select-to-comment ----------
let pending = null;
function selToPopover(){
  if (document.getElementById('pop')) return;
  const sel = window.getSelection(); const text = sel.toString();
  if (!text.trim() || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.startContainer.parentElement?.closest('#doc')) return;
  const rr = read.getBoundingClientRect();
  const rects = [...range.getClientRects()].map(r => ({ x:r.x-rr.x, y:r.y-rr.y+read.scrollTop, w:r.width, h:r.height }));
  pending = anchorFromSelection({ text, page:null, rects });
  pending.section = headingFor(range.startContainer);
  showPopover(pending, rects);
}
read.addEventListener('mouseup', selToPopover);
read.addEventListener('touchend', () => setTimeout(selToPopover, 10));   // touch selection on mobile
function headingFor(node){
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el && el.id !== 'doc'){ let p = el.previousElementSibling;
    while (p){ if (/^H[1-3]$/.test(p.tagName)) return p.textContent.trim(); p = p.previousElementSibling; } el = el.parentElement; }
  return '';
}
function showPopover(anchor, rects, defaultTag='claim', figEl=null){
  if (demoMode) return;   // the tour's demo chapter is a dead preview: never open the live composer
  document.getElementById('pop')?.remove();
  const top = Math.max(...rects.map(r => r.y + r.h)) + 10;
  const isFig = anchor.kind === 'figure';
  const pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'popover';
  pop.style.top = top + 'px'; pop.style.left = '50%'; pop.style.transform = 'translateX(-50%)';
  const modes = isFig ? '' : `<div class="pmodes" id="pmodes">
      <button data-m="note" class="on">Comment</button><button data-m="replace">Replace</button><button data-m="insert">Insert after</button><button data-m="delete">Delete</button></div>`;
  pop.innerHTML = `
    <div class="head"><i class="ti ti-${isFig?'photo':'link'}" style="margin-right:5px"></i>Commenting on ${isFig?'figure':''}
      <span class="loc"><i class="ti ti-circle-check-filled"></i>${anchor.section ? '§ '+anchor.section.slice(0,38) : (isFig?'this figure':'this passage')}</span></div>
    <div class="snip" id="psnip">"${escapeHtml(anchor.quote.slice(0,150))}"</div>
    ${modes}
    ${isFig && figEl ? `<button class="btn figdraw-btn" id="figdraw"><i class="ti ti-pencil"></i>Draw on the figure</button>` : ''}
    <textarea id="crepl" class="crepl" style="display:none"></textarea>
    <div class="tags" id="tags"></div>
    <textarea id="cbody" placeholder="Leave a comment…  (1–5 to tag · ${MOD}↵ to save)"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary" id="csave">Comment</button><button class="btn" id="ccancel">Cancel</button></div>`;
  read.appendChild(pop);
  let tag = defaultTag, mode = 'note'; const tr = pop.querySelector('#tags');
  TAGS.forEach(t => { const b = document.createElement('button'); b.textContent = t; b.dataset.tag = t;
    const pick = () => { tag = t;
      [...tr.children].forEach(x => { x.className = ''; x.style.background = 'transparent'; x.style.color = 'var(--text-2)'; x.style.borderColor = 'var(--border)'; });
      b.className = 'on'; b.style.background = `var(--${t}-bg)`; b.style.color = `var(--${t})`; b.style.borderColor = 'transparent'; };
    b.onclick = pick; tr.appendChild(b); if (t === defaultTag) pick(); });
  const repl = pop.querySelector('#crepl'), body = pop.querySelector('#cbody'), saveBtn = pop.querySelector('#csave');
  const setMode = m => { mode = m; pop.querySelectorAll('#pmodes button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    const needsRepl = m === 'replace' || m === 'insert';
    repl.style.display = needsRepl ? 'block' : 'none';
    repl.placeholder = m === 'replace' ? 'Exact replacement text (verbatim)…' : 'Exact text to insert after the selection (verbatim)…';
    body.placeholder = m === 'note' ? `Leave a comment…  (1–5 to tag · ${MOD}↵ to save)` : 'Optional note for this edit…';
    saveBtn.textContent = m === 'note' ? 'Comment' : m === 'delete' ? 'Suggest deletion' : m === 'insert' ? 'Suggest insertion' : 'Suggest replacement';
    saveBtn.className = 'btn ' + (m === 'delete' ? 'btn-danger' : m === 'note' ? 'btn-primary' : 'btn-suggest');
    pop.querySelector('#psnip').style.textDecoration = m === 'delete' ? 'line-through' : 'none';
    if (needsRepl) repl.focus(); else body.focus(); };
  pop.querySelectorAll('#pmodes button').forEach(b => b.onclick = () => setMode(b.dataset.m));
  body.focus();
  const close = () => { pop.remove(); window.getSelection().removeAllRanges(); };
  const commit = () => {
    let edit = null;
    if (mode === 'replace') edit = { op:'replace', find:anchor.quote, replacement:repl.value };
    else if (mode === 'insert') edit = { op:'insert', find:anchor.quote, position:'after', replacement:repl.value };
    else if (mode === 'delete') edit = { op:'delete', find:anchor.quote, replacement:'' };
    if (edit && mode !== 'delete' && !repl.value.trim()){ flash('Enter the '+(mode==='insert'?'text to insert':'replacement text')+'.'); return; }
    review = addComment(review, { anchor:pending, kind:edit?'suggestion':pending.kind, tag:edit?'edit':tag, body:body.value, edit });
    save(); syncUpSoon(); renderComments(); buildNav(); paintHighlights(); pop.remove(); window.getSelection().removeAllRanges(); };
  pop.querySelector('#ccancel').onclick = close;
  saveBtn.onclick = commit;
  pop.querySelector('#figdraw')?.addEventListener('click', () => { pop.remove(); openFigureMarkup(figEl, anchor); });
  pop._commit = commit; pop._pickTag = i => { const b = tr.children[i]; if (b) b.click(); };
  pop._setMode = setMode;
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
      review = addComment(review, { anchor, kind:'figure', tag:'figure', body:note });
      const c = review.comments[review.comments.length-1];
      const path = `markups/${c.id}.png`; markupCache[path] = dataUrl;
      review = updateComment(review, c.id, { markup:{ path, ts:new Date().toISOString() } });
      save(); renderComments(); buildNav(); paintHighlights(); ov.remove();
      const t = tok();
      if (t){ await putFile(t, path, b64, `markup: figure comment ${c.id}`); await syncUp(); flash('Markup saved.'); }
      else flash('Markup saved locally — connect to upload it.');
    } catch(e){ flash('Markup upload failed: '+e.message); }
  };
}
function loadMarkupThumb(el, path){
  if (markupCache[path]){ el.querySelector('img').src = markupCache[path]; return; }
  const t = tok(); if (!t) return;
  getDataUrl(t, path).then(u => { markupCache[path] = u; const img = el.querySelector('img'); if (img) img.src = u; }).catch(() => {});
}

// ---------- comments rail ----------
let editingId = null, activeCommentId = null, resolvedOpen = false;
let cFilter = { status:'all', tag:'all', sort:'doc' };
const STATUS_ORDER = ['all','open','queued','staged','approved','answered','merged','declined','resolved'];
const RESOLVED_STATES = new Set(['merged','answered','declined','resolved']);   // terminal — fold into "Resolved (N)"
function docOrderIndex(){           // map comment id -> vertical position of its anchor in the doc
  const map = {}; const order = [...document.querySelectorAll('#doc p, #doc li, #doc figure, #doc figcaption, #doc h2, #doc h3')];
  review.comments.forEach(c => { const q = (c.anchor.quote||'').replace(/\s+/g,' ').trim().slice(0,30);
    const i = order.findIndex(el => el.textContent.replace(/\s+/g,' ').includes(q)); map[c.id] = i < 0 ? 1e6 : i; });
  return map;
}
function filteredComments(){
  let cs = review.comments.filter(c =>
    (cFilter.status === 'all' || c.status === cFilter.status) &&
    (cFilter.tag === 'all' || c.tag === cFilter.tag));
  const cts = c => String(c.created_ts ?? '');   // coerce: a numeric created_ts must never crash the sort (localeCompare is String-only)
  if (cFilter.sort === 'new') cs = [...cs].sort((a,b) => cts(b).localeCompare(cts(a)));
  else { const ord = docOrderIndex(); cs = [...cs].sort((a,b) => (ord[a.id]-ord[b.id]) || cts(a).localeCompare(cts(b))); }
  return cs;
}
function renderComments(){
  const pane = document.getElementById('comments');
  const open = review.comments.filter(c => c.status === 'open').length;
  pane.innerHTML = `<div class="lbl">COMMENTS<span style="margin-left:auto">${review.comments.length} · ${open} open</span></div>`;
  if (!review.comments.length){ pane.innerHTML += `<div style="font-size:12.5px;color:var(--text-3);padding:8px 2px">Select text or click a figure to leave a comment.</div>`; renderAdvisorSection(pane); return; }
  // filter / sort toolbar
  const bar = document.createElement('div'); bar.className = 'cbar';
  const present = new Set(review.comments.map(c => c.status));
  bar.innerHTML = `<select class="csel" id="fstatus">${STATUS_ORDER.filter(s => s==='all'||present.has(s)).map(s => `<option value="${s}"${cFilter.status===s?' selected':''}>${s==='all'?'all status':s}</option>`).join('')}</select>
    <select class="csel" id="ftag"><option value="all"${cFilter.tag==='all'?' selected':''}>all tags</option>${[...TAGS,'edit'].map(t => `<option value="${t}"${cFilter.tag===t?' selected':''}>${t}</option>`).join('')}</select>
    <button class="csort" id="fsort" title="Sort">${cFilter.sort==='doc'?'↓ document':'↓ newest'}</button>`;
  pane.appendChild(bar);
  bar.querySelector('#fstatus').onchange = e => { cFilter.status = e.target.value; renderComments(); };
  bar.querySelector('#ftag').onchange = e => { cFilter.tag = e.target.value; renderComments(); };
  bar.querySelector('#fsort').onclick = () => { cFilter.sort = cFilter.sort==='doc'?'new':'doc'; renderComments(); };
  const list = filteredComments();
  if (!list.length){ pane.appendChild(Object.assign(document.createElement('div'), { className:'cempty', textContent:'No comments match this filter.' })); return; }
  const fold = cFilter.status === 'all';                       // only fold when not explicitly filtering by status
  const queued    = fold ? list.filter(c => c.status === 'approved') : [];
  const active    = fold ? list.filter(c => !RESOLVED_STATES.has(c.status) && c.status !== 'approved') : list;
  const resolved  = fold ? list.filter(c => RESOLVED_STATES.has(c.status)) : [];
  active.forEach(c => pane.appendChild(buildCommentCard(c)));
  if (queued.length){
    const grp = document.createElement('div'); grp.className = 'cqd-grp';
    const head = document.createElement('div'); head.className = 'cqd-head';
    head.innerHTML = `<i class="ti ti-clock-check"></i><span>Queued for merge</span><span class="rcount">${queued.length}</span>`;
    grp.appendChild(head);
    queued.forEach(c => grp.appendChild(buildCommentCard(c)));
    pane.appendChild(grp);
  }
  if (resolved.length){
    const grp = document.createElement('div'); grp.className = 'resolved-grp';
    const head = document.createElement('button'); head.className = 'resolved-head';
    head.innerHTML = `<i class="ti ti-chevron-${resolvedOpen?'down':'right'}"></i><span>Resolved</span><span class="rcount">${resolved.length}</span>`;
    const body = document.createElement('div'); body.className = 'resolved-body'; body.style.display = resolvedOpen?'block':'none';
    resolved.forEach(c => body.appendChild(buildCommentCard(c)));
    head.onclick = () => { resolvedOpen = !resolvedOpen; body.style.display = resolvedOpen?'block':'none'; head.querySelector('i').className = `ti ti-chevron-${resolvedOpen?'down':'right'}`; };
    grp.appendChild(head); grp.appendChild(body); pane.appendChild(grp);
  }
  renderAdvisorSection(pane);
}
function buildCommentCard(c){
    const card = document.createElement('div'); card.className = 'ccard'; card.dataset.id = c.id;
    if (RESOLVED_STATES.has(c.status)) card.classList.add('is-resolved');
    if (editingId === c.id){ card.style.cursor = 'default'; card.appendChild(editCard(c)); return card; }
    const st = c.status;
    const stColor = st==='staged'?'var(--info)':st==='merged'?'var(--success)':st==='queued'?'var(--warn)':st==='answered'?'var(--success)':st==='resolved'?'var(--text-3)':'var(--text-2)';
    const stBg = st==='staged'?'var(--info-bg)':st==='merged'?'var(--success-bg)':st==='queued'?'var(--warn-bg)':st==='answered'?'var(--success-bg)':'transparent';
    card.innerHTML = `<div class="row">
        <span class="chip" style="background:var(--${c.tag}-bg);color:var(--${c.tag})">${c.kind==='figure'?'<i class="ti ti-photo" style="font-size:11px;vertical-align:-1px;margin-right:2px"></i>':c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:11px;vertical-align:-1px;margin-right:2px"></i>':''}${c.tag}</span>
        <span class="cactions" style="margin-left:auto;display:none;gap:1px">
          <button class="icbtn cact" data-act="resolve" title="${st==='resolved'?'Reopen':'Resolve'}" style="width:25px;height:25px;font-size:14px"><i class="ti ti-${st==='resolved'?'rotate-clockwise':'check'}"></i></button>
          <button class="icbtn cact" data-act="edit" title="Edit" style="width:25px;height:25px;font-size:14px"><i class="ti ti-pencil"></i></button>
          <button class="icbtn cact" data-act="del" title="Delete" style="width:25px;height:25px;font-size:14px"><i class="ti ti-trash"></i></button></span>
        <span class="status" style="background:${stBg};color:${stColor};${st==='open'?'display:none':''}">${st}</span></div>
      <div class="snip">"${escapeHtml((c.anchor.quote||'').slice(0,52))}"${c.created_ts?`<span class="cmeta"> · ${fmtDate(c.created_ts)}</span>`:''}</div>
      <div class="body" style="${st==='resolved'?'opacity:.5;text-decoration:line-through':''}">${escapeHtml(c.body)}</div>
      ${c.markup ? `<div class="cmarkup" data-path="${escapeHtml(c.markup.path)}" title="Your markup"><img alt="figure markup"></div>` : ''}
      ${suggHtml(c)}
      ${c.status === 'staged' ? `<div class="cdec" data-id="${c.id}">
        <button class="btn cdec-b ${c.decision==='approve'?'on-approve':''}" data-d="approve"><i class="ti ti-check"></i>Approve</button>
        <button class="btn cdec-b ${c.decision==='reject'?'on-reject':''}" data-d="reject"><i class="ti ti-x"></i>Reject</button>
        <button class="btn cdec-b ${c.decision==='revise'?'on-revise':''}" data-d="revise"><i class="ti ti-pencil"></i>Request changes</button>
      </div>
      <div class="cdec-revform" style="display:none"><textarea class="cdec-revt" rows="2" placeholder="What should change? This re-queues the edit for Claude."></textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-primary cdec-revsend" style="padding:4px 11px;font-size:11.5px">Send to Claude</button><button class="btn cdec-revcancel" style="padding:4px 11px;font-size:11.5px">Cancel</button></div></div>` : ''}
      ${c.status === 'approved' ? `<div class="cdec" data-id="${c.id}"><span class="cqd"><i class="ti ti-clock-check"></i>queued for merge</span><button class="btn cunq" data-id="${c.id}"><i class="ti ti-arrow-back-up"></i>Unqueue</button></div>` : ''}
      ${c.claude?.response ? `<div class="cresp"><div class="cresp-h"><i class="ti ti-robot-face"></i>Claude</div>${escapeHtml(c.claude.response)}</div>` : ''}
      ${c.claude?.branch ? `<div class="branch"><i class="ti ti-git-branch"></i>${escapeHtml(c.claude.branch)}</div>` : ''}
      ${(c.thread||[]).map(m => `<div class="cmsg ${m.author==='you'?'me':'cl'}"><span class="cmsg-h">${m.author==='you'?'You':'Claude'} · ${(m.ts||'').slice(0,10)}</span>${escapeHtml(m.text)}</div>`).join('')}
      ${st!=='resolved' ? `<div class="creply"><button class="creply-open">${(c.thread&&c.thread.length)?'Reply':(c.claude?.response||c.claude?.branch?'Reply / push back':'Add a note')}</button>
        <div class="creply-form" style="display:none"><textarea class="creply-t" rows="2" placeholder="${c.claude?.response||c.claude?.branch?'Reply to Claude / request a change…':'Add a private note…'}"></textarea><button class="btn btn-primary creply-send" style="padding:4px 11px;font-size:11.5px">Send</button></div></div>` : ''}`;
    if (c.id === activeCommentId) card.classList.add('active');
    card.onmouseenter = () => { card.querySelector('.cactions').style.display='flex'; const s=card.querySelector('.status'); if (st!=='open') s.style.visibility='hidden'; document.querySelector(`#doc .cmark[data-id="${c.id}"]`)?.classList.add('cmark-hot'); };
    card.onmouseleave = () => { card.querySelector('.cactions').style.display='none'; const s=card.querySelector('.status'); if (s) s.style.visibility=''; document.querySelector(`#doc .cmark[data-id="${c.id}"]`)?.classList.remove('cmark-hot'); };
    card.querySelector('.snip').onclick = () => jumpTo(c);
    card.querySelector('.body').onclick = () => jumpTo(c);
    if (c.markup) loadMarkupThumb(card.querySelector('.cmarkup'), c.markup.path);
    card.querySelectorAll('.cact').forEach(b => b.onclick = e => { e.stopPropagation(); commentAction(c.id, b.dataset.act); });
    card.querySelectorAll('.cdec-b').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const d = b.dataset.d;
      const cur = (review.comments.find(x => x.id === c.id)||{}).decision;
      if (d === 'revise'){                                         // reveal an inline note box (no native prompt)
        const form = card.querySelector('.cdec-revform'); const open = form.style.display !== 'none';
        form.style.display = open ? 'none' : 'block';
        if (!open){ const t = form.querySelector('.cdec-revt'); t.value = cur === 'revise' ? ((review.comments.find(x=>x.id===c.id)||{}).decision_note || '') : ''; t.focus(); }
        return;
      }
      try { await recordDecision(c.id, cur === d ? null : d); } catch(err){ alert('Failed: '+err.message); }   // toggle off if same
    });
    card.querySelector('.cdec-revsend')?.addEventListener('click', async e => { e.stopPropagation();
      const note = card.querySelector('.cdec-revt').value.trim();
      if (!note){ card.querySelector('.cdec-revt').focus(); return; }
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Sending…';
      try { await requestChanges(c.id, note); } catch(err){ b.disabled = false; b.textContent = 'Send to Claude'; alert('Failed: '+err.message); } });
    card.querySelector('.cdec-revcancel')?.addEventListener('click', e => { e.stopPropagation(); card.querySelector('.cdec-revform').style.display = 'none'; });
    card.querySelector('.cunq')?.addEventListener('click', async e => { e.stopPropagation();
      try { await unqueueComment(c.id); } catch(err){ alert('Failed: '+err.message); } });
    const ro = card.querySelector('.creply-open');
    if (ro){ const form = card.querySelector('.creply-form');
      ro.onclick = e => { e.stopPropagation(); form.style.display = form.style.display==='none'?'block':'none'; if (form.style.display==='block') form.querySelector('.creply-t').focus(); };
      card.querySelector('.creply-send').onclick = e => { e.stopPropagation(); const v = form.querySelector('.creply-t').value.trim(); if (v) replyToComment(c.id, v); };
    }
    return card;
}
// owner replies to a comment; a reply to a Claude-handled comment re-queues it for revision
async function replyToComment(id, text){
  const c = review.comments.find(x => x.id === id); if (!c) return;
  const thread = [...(c.thread||[]), { author:'you', text, ts:new Date().toISOString() }];
  const handled = !!(c.claude?.response || c.claude?.branch) || ['staged','approved','answered','merged'].includes(c.status);
  review = updateComment(review, id, { thread, status: handled ? 'queued' : c.status });
  save(); renderComments(); buildNav(); paintHighlights();
  const t = tok(); if (!t){ flash('Reply saved locally.'); return; }
  try {
    await syncUp();
    if (handled){
      const { json, sha } = await getJson(t, 'jobs.json'); const jobs = Array.isArray(json) ? json : [];
      jobs.push({ id:'j_'+Date.now().toString(36), type:'apply-edits', chapter:current, comment_ids:[id], revision:true, status:'queued', requested_ts:new Date().toISOString() });
      await putJson(t, 'jobs.json', jobs, sha, 'review: revision reply '+id);
      flash('Reply sent — Claude will revise this.');
    } else flash('Note added.');
  } catch(e){ flash('Reply saved; sync failed: '+e.message); }
}
let advResolvedOpen = false;
function renderAdvisorSection(pane){
  if (!advisorComments.length) return;
  const active = advisorComments.filter(c => !RESOLVED_STATES.has(c.status));
  const resolved = advisorComments.filter(c => RESOLVED_STATES.has(c.status));
  const lbl = document.createElement('div'); lbl.className = 'lbl adv-lbl';
  lbl.innerHTML = `<i class="ti ti-users" style="margin-right:5px"></i>FROM ADVISORS<span style="margin-left:auto">${active.length}</span>`;
  pane.appendChild(lbl);
  active.forEach(c => pane.appendChild(buildAdvCard(c)));
  if (resolved.length){   // advisor-resolved comments fold into a collapsible group instead of vanishing
    const grp = document.createElement('div'); grp.className = 'resolved-grp';
    const head = document.createElement('button'); head.className = 'resolved-head';
    head.innerHTML = `<i class="ti ti-chevron-${advResolvedOpen?'down':'right'}"></i><span>Resolved by advisor</span><span class="rcount">${resolved.length}</span>`;
    const body = document.createElement('div'); body.className = 'resolved-body'; body.style.display = advResolvedOpen?'block':'none';
    resolved.forEach(c => body.appendChild(buildAdvCard(c)));
    head.onclick = () => { advResolvedOpen = !advResolvedOpen; body.style.display = advResolvedOpen?'block':'none'; head.querySelector('i').className = `ti ti-chevron-${advResolvedOpen?'down':'right'}`; };
    grp.appendChild(head); grp.appendChild(body); pane.appendChild(grp);
  }
}
// build one in-context advisor card with the full action set (rail is the primary action surface)
function buildAdvCard(c){
  const card = document.createElement('div'); card.className = 'ccard adv' + (c.read?' is-read':''); card.dataset.aid = c.id;
  const notes = (advNotesState.notes[c.id]||[]);
  card.innerHTML = `<div class="row">
      <label class="rel-read"><input type="checkbox" class="adv-readbox" ${c.read?'checked':''}>read</label>
      <span class="chip advchip"><i class="ti ti-user" style="font-size:11px;margin-right:3px"></i>${escapeHtml(whoLabel(c))}</span>
      ${c.tag&&c.tag!=='other'?`<span class="chip" style="margin-left:5px">${c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:10px;margin-right:2px"></i>':''}${escapeHtml(c.tag)}</span>`:''}
      ${c.sent?'<span class="status" style="margin-left:auto;background:var(--info-bg);color:var(--info)">sent</span>':c.status==='submitted'?'<span class="status" style="margin-left:auto;background:var(--success-bg);color:var(--success)">submitted</span>':''}</div>
    <div class="snip">"${escapeHtml((c.anchor?.quote||'').slice(0,52))}"${c.created_ts?`<span class="cmeta"> · ${fmtDate(c.created_ts)}</span>`:''}</div>
    <div class="body">${escapeHtml(c.body)}</div>${suggHtml(c)}${resolHtml(c)}${threadHtml(c)}
    ${notes.map(n=>`<div class="rel-note"><i class="ti ti-lock" style="font-size:12px"></i> ${escapeHtml(n.text)} <span style="color:var(--text-3);font-size:11px">· private · ${fmtDate(n.ts)}</span></div>`).join('')}
    <div class="advacts">
      <button class="btn aj"><i class="ti ti-arrow-right"></i>Jump</button>
      <button class="btn a-reply"><i class="ti ti-message"></i>Reply</button>
      <button class="btn a-note"><i class="ti ti-note"></i>Private note</button>
      <button class="btn a-suggest"><i class="ti ti-pencil"></i>Suggest edit</button>
      <button class="btn a-rec"><i class="ti ti-message-check"></i>${c.resolution?'Update':'Resolution'}</button>
      <button class="btn a-send" ${(!c.read||c.sent)?`disabled title="${c.sent?'Already sent':'Mark this read first'}"`:''}><i class="ti ti-send"></i>${c.sent?'Sent':'Send to Claude'}</button></div>
    <div class="rel-pop a-replybox" style="display:none"><textarea rows="2" placeholder="Reply to ${escapeHtml(whoLabel(c))} — they'll see this…"></textarea><div class="rel-popacts"><button class="btn btn-primary a-reply-save">Send reply</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rel-pop a-notebox" style="display:none"><textarea rows="2" placeholder="Private note — only you see this…"></textarea><div class="rel-popacts"><button class="btn btn-primary a-note-save">Save note</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rel-pop a-suggestbox" style="display:none"><div class="sug-passage">Editing this passage:<blockquote>"${escapeHtml(c.anchor?.quote||'')}"</blockquote><button class="btn a-jump2" style="padding:2px 8px;font-size:11px"><i class="ti ti-arrow-right"></i>Read it in context</button></div>
      <select class="a-sug-op">${['replace','insert','delete'].map(o=>`<option value="${o}"${c.edit?.op===o?' selected':(o==='replace'&&!c.edit?' selected':'')}>${o==='replace'?'Replace with':o==='insert'?'Insert after':'Delete'}</option>`).join('')}</select>
      <textarea class="a-sug-find" rows="2" placeholder="Exact text to find (verbatim)…">${escapeHtml(c.edit?.find ?? c.anchor?.quote ?? '')}</textarea>
      <textarea class="a-sug-repl" rows="2" placeholder="Your replacement / insertion text…">${escapeHtml(c.edit?.replacement||'')}</textarea>
      <div class="rel-popacts"><button class="btn btn-primary a-sug-save">Attach edit</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rform" style="display:none">
      <select class="r-state"><option value="addressed"${c.resolution?.state==='addressed'?' selected':''}>Addressed — changed as suggested</option><option value="declined"${c.resolution?.state==='declined'?' selected':''}>Kept as written</option><option value="noted"${c.resolution?.state==='noted'?' selected':''}>Noted</option></select>
      <textarea class="r-note" rows="2" placeholder="How it was handled — the advisor sees this…">${escapeHtml(c.resolution?.note||'')}</textarea>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn btn-primary r-save" style="padding:4px 10px;font-size:11.5px">Save to advisor</button><span class="r-stat" style="font-size:11px;color:var(--text-3)"></span></div></div>`;
  card.onmouseenter = () => document.querySelector(`#doc .cmark[data-aid="${c.id}"]`)?.classList.add('cmark-hot');
  card.onmouseleave = () => document.querySelector(`#doc .cmark[data-aid="${c.id}"]`)?.classList.remove('cmark-hot');
  const swap = () => { const fresh = buildAdvCard(c); card.replaceWith(fresh); };   // in-place re-render, no re-fetch
  const toggle = sel => { const box = card.querySelector(sel); card.querySelectorAll('.rel-pop, .rform').forEach(p => { if (p !== box) p.style.display = 'none'; }); box.style.display = box.style.display==='none'?'block':'none'; if (box.style.display==='block') box.querySelector('textarea')?.focus(); };
  card.querySelectorAll('.a-x').forEach(x => x.onclick = () => card.querySelectorAll('.rel-pop, .rform').forEach(p => p.style.display = 'none'));
  card.querySelector('.snip').onclick = () => jumpToAdvisor(c);
  card.querySelector('.aj').onclick = () => jumpToAdvisor(c);
  card.querySelector('.a-jump2').onclick = () => jumpToAdvisor(c);
  card.querySelector('.adv-readbox').onchange = async e => { const v = e.target.checked; try { await markAdvisorRead(c._advisor, current, c.id, v); c.read = v; swap(); } catch(err){ alert('Failed: ' + err.message); e.target.checked = !v; } };
  card.querySelector('.a-reply').onclick = () => toggle('.a-replybox');
  card.querySelector('.a-note').onclick = () => toggle('.a-notebox');
  card.querySelector('.a-suggest').onclick = () => toggle('.a-suggestbox');
  card.querySelector('.a-rec').onclick = () => toggle('.rform');
  card.querySelector('.a-reply-save').onclick = async () => { const txt = card.querySelector('.a-replybox textarea').value.trim(); if (!txt) return;
    try { await replyToAdvisorComment(c._advisor, current, c.id, txt); c.thread = [...(c.thread||[]), { author:'author', text:txt, ts:new Date().toISOString() }]; c.read = true; swap(); } catch(e){ alert('Failed: ' + e.message); } };
  card.querySelector('.a-note-save').onclick = async () => { const txt = card.querySelector('.a-notebox textarea').value.trim(); if (!txt) return;
    try { await savePrivateNote(advNotesState, c.id, txt); swap(); } catch(e){ alert('Failed: ' + e.message); } };
  card.querySelector('.a-sug-save').onclick = async () => { const op = card.querySelector('.a-sug-op').value, find = card.querySelector('.a-sug-find').value.trim(), replacement = card.querySelector('.a-sug-repl').value.trim();
    if (!find && op !== 'insert'){ alert('Enter the text to find.'); return; }
    try { const edit = { op, find, replacement }; await suggestAdvisorEdit(c._advisor, current, c.id, edit); c.edit = edit; c.read = true; swap(); } catch(e){ alert('Failed: ' + e.message); } };
  card.querySelector('.a-send').onclick = async () => { if (!confirm('Send this comment to Claude to address?')) return;
    const b = card.querySelector('.a-send'); b.disabled = true; b.textContent = 'Sending…';
    try { await sendAdvisorToClaude(c._advisor, current, c); c.sent = true; c.read = true; swap(); } catch(e){ b.textContent = 'Failed: ' + e.message; } };
  card.querySelector('.r-save').onclick = async () => { const stat = card.querySelector('.r-stat'); stat.textContent = 'Saving…';
    const resolution = { state:card.querySelector('.r-state').value, note:card.querySelector('.r-note').value.trim(), ts:new Date().toISOString() };
    try { await recordResolution(c._advisor, current, c.id, resolution); c.resolution = resolution; c.read = true; stat.textContent = 'Saved — visible to the advisor.'; setTimeout(swap, 600); }
    catch(e){ stat.textContent = 'Failed: ' + e.message; } };
  return card;
}
// ---------- robust anchor location (a stored quote rarely byte-matches rendered HTML:
// injected "Figure 3.9." prefixes, KaTeX math, citation brackets, curly quotes/dashes) ----------
function normText(s){
  return (s||'').replace(/ /g,' ').normalize('NFKD')
    .replace(/[‐-―]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
    .replace(/\s+/g,' ').toLowerCase().trim();
}
function keyWords(s){
  return normText(s)
    .replace(/^(figure|fig\.?|table|tab\.?|eq\.?|equation)\s*[\d.]+\s*[:.]?\s*/i,'')   // drop a leading "Figure 3.9.:"
    .replace(/\[[^\]]*\]/g,' ').replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w => w.length>=3);
}
function locateAnchor(c, { allowSection = true } = {}){
  if (current === '__outline__'){   // outline comments live on .ol-node/.ol-cmt buttons, not in #doc
    const q = c.anchor?.quote||'', s = c.anchor?.section||'';
    const btn = [...document.querySelectorAll('.ol-cmt')].find(b => b.dataset.node===q && b.dataset.sec===s);
    if (btn){ btn.closest('.ol-chapter')?.classList.add('open'); return btn.closest('.ol-node, .ol-chead')||btn; }
    return null;
  }
  const sel = `#doc .tc-stage[data-cid="${c.id}"], #doc .cmark[data-id="${c.id}"], #doc .cmark[data-aid="${c.id}"], #doc .cmark-el[data-cid="${c.id}"], #doc figure[data-cid="${c.id}"]`;
  const mark = document.querySelector(sel); if (mark) return mark;        // painted edit/highlight wins
  const quote = c.anchor?.quote || '';
  const cands = [...document.querySelectorAll('#doc p, #doc li, #doc figure, #doc figcaption, #doc h2, #doc h3, #doc td, #doc blockquote')];
  // 1) contiguous normalized substring, progressively shorter
  const nq = normText(quote);
  for (const len of [90, 55, 32, 18]){
    if (nq.length < 8) break;
    const probe = nq.slice(0, Math.min(len, nq.length));
    const hit = cands.find(e => normText(e.textContent).includes(probe));
    if (hit) return hit;
  }
  // 2) keyword overlap (resilient to math/citations/figure numbers)
  const nw = keyWords(quote).slice(0, 12);
  if (nw.length){
    let best = null, bestScore = 0;
    for (const e of cands){ const hay = new Set(keyWords(e.textContent)); let s = 0; for (const w of nw) if (hay.has(w)) s++;
      if (s > bestScore){ bestScore = s; best = e; } }
    if (best && bestScore >= Math.max(3, Math.ceil(nw.length * 0.5))) return best;
  }
  // 3) section heading as a last resort
  if (c.anchor?.section){
    const ns = normText(c.anchor.section);
    const sec = [...document.querySelectorAll('#doc h2, #doc h3')].find(h => normText(h.textContent).includes(ns));
    if (sec) return sec;
  }
  return null;
}
// where to scroll for a comment. Clicking an edit comment paints THAT comment's ~~before~~ after
// at the spot (in both normal and preview mode). In preview we first clear any other comment's
// overlay so only the clicked change is shown over the otherwise-clean rendered text.
function jumpTarget(c){
  if (editPair(c)){
    if (previewing) document.querySelectorAll('#doc ins.tc-stage, #doc del.tc-stage').forEach(n => {
      if (n.tagName === 'DEL'){ const p = n.parentNode; n.replaceWith(...n.childNodes); p.normalize(); } else n.remove();
    });
    const el = paintEditDiff(c); if (el) return el;
  }
  return locateAnchor(c, { allowSection:false }) || locateAnchor(c, { allowSection:true });
}
function jumpToAdvisor(c){
  const el = jumpTarget(c);
  if (el) scrollFlash(el); else flash('Couldn’t find this passage in the chapter — it may have changed since the comment.');
}
// jump after a chapter is still loading: retry until the doc is ready, then prefer the edit-diff
function jumpWhenReady(c, tries = 14){
  const tick = () => {
    if (document.getElementById('doc')){
      const el = jumpTarget(c);
      if (el){ scrollFlash(el); return; }
    }
    if (tries-- > 0) setTimeout(tick, 280); else flash('Couldn’t find this passage in the chapter — it may have changed since the comment.');
  };
  tick();
}
function commentAction(id, act){
  const c = review.comments.find(x => x.id === id); if (!c) return;
  if (act === 'edit'){ editingId = id; renderComments(); return; }
  if (act === 'del'){ if (!confirm('Delete this comment?')) return; review = deleteComment(review, id); }
  else if (act === 'resolve'){ review = updateComment(review, id, { status: c.status==='resolved'?'open':'resolved' }); }
  save(); syncUpSoon(); renderComments(); buildNav(); paintHighlights();
}
function editCard(c){
  const w = document.createElement('div'); let tag = c.tag;
  w.innerHTML = `<div id="etags" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>
    <textarea id="ebody" style="width:100%;border:.5px solid var(--accent);border-radius:6px;padding:7px;font:inherit;background:var(--bg);color:var(--text);min-height:54px;outline:none">${escapeHtml(c.body)}</textarea>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-primary" id="esave" style="padding:5px 13px;font-size:12px">Save</button><button class="btn" id="ecancel" style="padding:5px 13px;font-size:12px">Cancel</button></div>`;
  const tr = w.querySelector('#etags');
  TAGS.forEach(t => { const b = document.createElement('button'); b.textContent = t;
    b.style.cssText = 'font-size:11px;padding:2px 9px;border-radius:20px;border:.5px solid var(--border);color:var(--text-2);background:transparent';
    const pick = () => { tag = t; [...tr.children].forEach(x => { x.style.background='transparent'; x.style.color='var(--text-2)'; x.style.borderColor='var(--border)'; }); b.style.background=`var(--${t}-bg)`; b.style.color=`var(--${t})`; b.style.borderColor='transparent'; };
    b.onclick = pick; tr.appendChild(b); if (t === tag) pick(); });
  w.querySelector('#ecancel').onclick = () => { editingId = null; renderComments(); };
  w.querySelector('#esave').onclick = () => { review = updateComment(review, c.id, { body:w.querySelector('#ebody').value, tag }); editingId = null; save(); syncUpSoon(); renderComments(); buildNav(); paintHighlights(); };
  return w;
}
function jumpTo(c){
  activeCommentId = c.id;
  const el = jumpTarget(c);
  if (el) scrollFlash(el); else flash('Couldn’t find this passage in the chapter — it may have changed since the comment.');
}
function activateComment(id){
  activeCommentId = id; renderComments();
  const card = document.querySelector(`#comments .ccard[data-id="${id}"]`);
  card?.scrollIntoView({ behavior:'smooth', block:'center' });
  card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 1500);
}
// wrap each comment's quoted text in a <mark> so commented passages are visible while reading
function paintHighlights(){
  const doc = document.getElementById('doc'); if (!doc) return;
  doc.querySelectorAll('mark.cmark').forEach(m => { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
  doc.querySelectorAll('.cmark-el').forEach(e => { e.classList.remove('cmark-el'); e.onclick = null; delete e.dataset.cid; });
  doc.querySelectorAll('figure[data-cid]').forEach(f => { f.classList.remove('cmark-fig'); delete f.dataset.cid; });
  const blocks = [...doc.querySelectorAll('p, li, figcaption')];
  review.comments.forEach(c => {
    if (RESOLVED_STATES.has(c.status)) return;   // don't highlight finalized comments (merged/answered/declined/resolved)
    if (c.kind === 'figure'){ markFigure(doc, c); return; }
    const q = (c.anchor.quote||'').replace(/\s+/g,' ').trim(); if (q.length < 4) return;
    const needle = q.slice(0, 50);
    const el = blocks.find(e => e.textContent.replace(/\s+/g,' ').includes(needle.slice(0,40)));
    if (!el) return;
    if (!wrapInNode(el, needle, c)){ el.classList.add('cmark-el'); el.dataset.cid = c.id; el.style.setProperty('--mk', `var(--${c.tag})`); el.onclick = () => activateComment(c.id); }
  });
  // advisor comments — distinct marker, jump to their card
  advisorComments.forEach(c => {
    if (c.kind === 'figure') return;
    const q = (c.anchor?.quote||'').replace(/\s+/g,' ').trim(); if (q.length < 4) return;
    const needle = q.slice(0, 50);
    const el = blocks.find(e => e.textContent.replace(/\s+/g,' ').includes(needle.slice(0,40)));
    if (el) wrapInNode(el, needle, c, true);
  });
}
function wrapInNode(el, needle, c, advisor){
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, probe = needle.slice(0, 30);
  while ((node = tw.nextNode())){
    const idx = node.nodeValue.indexOf(probe);
    if (idx >= 0){
      const r = document.createRange();
      r.setStart(node, idx); r.setEnd(node, Math.min(node.nodeValue.length, idx + needle.length));
      const mk = document.createElement('mark'); mk.className = advisor ? 'cmark cmark-adv' : 'cmark';
      if (advisor) mk.dataset.aid = c.id; else { mk.dataset.id = c.id; mk.dataset.tag = c.tag; if (c.edit) mk.dataset.sugg = c.edit.op; }
      try { r.surroundContents(mk); mk.onclick = e => { e.stopPropagation(); advisor ? jumpToAdvisorCard(c.id) : activateComment(c.id); }; return true; } catch(e){ return false; }
    }
  }
  return false;
}
function jumpToAdvisorCard(aid){
  const card = document.querySelector(`#comments .ccard.adv[data-aid="${aid}"]`);
  card?.scrollIntoView({ behavior:'smooth', block:'center' }); card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 1500);
}
// ---------- staged edits: show the pending change in context (before merge) ----------
function refreshStaged(){ const doc = document.getElementById('doc'); if (!doc) return; renderStagedEdits(doc); showApproveBar(); }
// length-preserving fold (lowercase + unicode dash/quote/nbsp) so collapsed-index mapping stays valid
function lite(s){ return (s||'').replace(/ /g,' ').replace(/[‐-―]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').toLowerCase(); }
// the before/after of a comment's edit, from any of the places one can live
function editPair(c){
  const se = c.staged_edit, e = c.edit, r = c.resolution;
  const before = (se?.before ?? e?.find ?? r?.before ?? '').toString();
  const after  = (se?.after  ?? e?.replacement ?? r?.after ?? '').toString();
  return (before.trim() || after.trim()) ? { before: before.trim().replace(/\s+/g,' '), after: after.trim().replace(/\s+/g,' ') } : null;
}
// find `text` inside one text node of a candidate block (normalized, whitespace-tolerant) → {node,start,end}
function findRange(doc, text){
  if (!text || text.length < 4) return null;
  const probe = lite(text).replace(/\s+/g,' ').trim().slice(0, 40);
  for (const el of doc.querySelectorAll('p, li, figcaption, td, blockquote')){
    if (!lite(el.textContent).replace(/\s+/g,' ').includes(probe)) continue;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = tw.nextNode())){
      const collapsed = lite(node.nodeValue).replace(/\s+/g,' ');
      const i = collapsed.indexOf(probe); if (i < 0) continue;
      const start = mapCollapsedIndex(node.nodeValue, i);
      const fullLen = lite(text).replace(/\s+/g,' ').trim().length;
      const end = Math.min(node.nodeValue.length, mapCollapsedIndex(node.nodeValue, i + fullLen));
      return { node, start, end };
    }
  }
  return null;
}
// remove any previously-painted track-changes nodes for one comment (restore original text)
function clearEditNodes(cid){
  document.querySelectorAll(`#doc ins.tc-stage[data-cid="${cid}"]`).forEach(n => n.remove());
  document.querySelectorAll(`#doc del.tc-stage[data-cid="${cid}"]`).forEach(n => { const p = n.parentNode; n.replaceWith(...n.childNodes); p.normalize(); });
}
// paint ~~before~~ after inline for a comment's edit. Works whether the OLD text is still present
// (anchors on `before`) or already replaced by the NEW text (anchors on `after`). Returns the node to scroll to.
function paintEditDiff(c){
  const doc = document.getElementById('doc'); if (!doc) return null;
  const p = editPair(c); if (!p) return null;
  clearEditNodes(c.id);
  const mkDel = () => { const d = document.createElement('del'); d.className = 'tc-stage'; d.dataset.cid = c.id; return d; };
  const mkIns = (t) => { const n = document.createElement('ins'); n.className = 'tc-stage'; n.dataset.cid = c.id; if (t != null) n.textContent = t; return n; };
  // case A: old text still in the doc → wrap it as del, append the new as ins
  let rng = p.before ? findRange(doc, p.before) : null;
  if (rng){
    try {
      const r = document.createRange(); r.setStart(rng.node, rng.start); r.setEnd(rng.node, rng.end);
      if (p.after && p.after.replace(/\s+/g,' ').startsWith(p.before)){    // pure append
        const ins = mkIns(p.after.slice(p.before.length)); r.collapse(false); r.insertNode(ins); return ins;
      }
      const del = mkDel(); r.surroundContents(del);
      const ins = mkIns(p.after ? ' ' + p.after : ''); del.after(ins); return p.after ? ins : del;
    } catch(e){ /* spans nodes */ }
  }
  // case B: old text gone (edit applied) → find the NEW text, prepend a struck-through `before`
  rng = p.after ? findRange(doc, p.after) : null;
  if (rng){
    try {
      const r = document.createRange(); r.setStart(rng.node, rng.start); r.setEnd(rng.node, rng.end);
      const ins = mkIns(); r.surroundContents(ins);                        // highlight the new text in place
      if (p.before){ const del = mkDel(); del.textContent = p.before + ' '; ins.before(del); }
      return ins;
    } catch(e){ /* spans nodes */ }
  }
  return null;
}
function renderStagedEdits(doc){
  doc.querySelectorAll('ins.tc-stage').forEach(n => n.remove());
  doc.querySelectorAll('del.tc-stage').forEach(n => { const p = n.parentNode; n.replaceWith(...n.childNodes); p.normalize(); });
  if (previewing) return;            // preview already shows the final rendered text — no track-changes overlay
  (review.comments||[]).forEach(c => {
    if (!c.staged_edit || !['staged','approved'].includes(c.status)) return;
    paintEditDiff(c);
  });
}
function mapCollapsedIndex(raw, collapsedIdx){            // index in whitespace-collapsed text → index in raw text
  let ci = 0; for (let ri = 0; ri < raw.length; ri++){ if (ci === collapsedIdx) return ri;
    const isWs = /\s/.test(raw[ri]); if (isWs){ while (ri+1 < raw.length && /\s/.test(raw[ri+1])) ri++; } ci++; }
  return raw.length;
}
function showApproveBar(){
  document.getElementById('approvebar')?.remove();
  const staged = (review.comments||[]).filter(c => ['staged','approved'].includes(c.status));   // any staged change, inline-diff or not
  if (!staged.length) return;
  const p = partitionByDecision(review.comments);
  const counts = `<b>${p.approved.length}</b> approved · ${p.rejected.length} rejected · ${p.undecided.length} to decide${p.revise.length?` · ${p.revise.length} to revise`:''}${p.queued.length?` · <b>${p.queued.length}</b> queued for merge`:''}`;
  const inlineN = staged.filter(c => c.staged_edit).length;
  const note = inlineN === staged.length ? `shown inline as <span class="tc-legend"><del>old</del> <ins>new</ins></span>`
             : inlineN ? `${inlineN} shown inline; figure/structure changes need a preview`
             : `figure or structure changes — preview to see them rendered`;
  const bar = document.createElement('div'); bar.id = 'approvebar'; bar.className = 'approvebar';
  const left = previewing
    ? `<i class="ti ti-eye"></i><span><b>Previewing the rendered staged version</b> — figures and text as they'll look after merge. Nothing is merged yet.</span>`
    : `<i class="ti ti-git-pull-request"></i><span><b>${staged.length}</b> staged change${staged.length>1?'s':''} — ${counts}. ${note}.</span>`;
  const prevBtn = previewing
    ? `<button class="btn btn-primary" id="preview-btn" style="margin-left:auto"><i class="ti ti-arrow-back-up"></i>Exit preview</button>`
    : `<button class="btn" id="preview-btn" style="margin-left:auto"><i class="ti ti-eye"></i>Preview rendered</button>`;
  bar.innerHTML = `${left}${prevBtn}<button class="btn btn-primary" id="merge-approved" ${p.approved.length?'':'disabled'}>Queue ${p.approved.length} for merge</button>`;
  read.prepend(bar);
  bar.querySelector('#merge-approved').onclick = approveChapter;
  bar.querySelector('#preview-btn').onclick = () => togglePreview(current);
}
async function approveChapter(){
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  const p = partitionByDecision(review.comments);
  if (!p.approved.length){ flash('Approve at least one edit first.'); return; }
  if (!confirm(`Queue ${p.approved.length} approved edit(s) for merge in Chapter ${chMeta(current).n}?` +
               (p.rejected.length?`\n${p.rejected.length} rejected edit(s) will be discarded.`:'') +
               (p.revise.length?`\n${p.revise.length} edit(s) will be re-queued for revision.`:''))) return;
  const q = queueApproved(review); const revise = q.revise; review = q.review; save(); renderComments(); refreshStaged();
  try {
  // persist the promotion conflict-safe: re-apply queueApproved on the freshest remote copy
  for (let attempt = 0; attempt < 5; attempt++){
    const { json, sha } = await getJson(t, reviewPath(current)); if (!json) break;
    const promoted = queueApproved(json).review;
    try { await putJson(t, reviewPath(current), promoted, sha, `review: queue ${p.approved.length} for merge in ${current}`, false); break; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } throw e; }
  }
  const { json:jj, sha:js } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(jj) ? jj : [];
  for (const r of revise) jobs.push({ id:'j_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), type:'apply-edits', chapter:current, comment_ids:[r.cid], revision:true, revise_note:r.note, status:'queued', requested_ts:new Date().toISOString() });
  if (!jobs.some(j => j.type==='merge' && j.chapter===current && j.status==='queued'))
    jobs.push({ id:'j_'+Date.now().toString(36), type:'merge', chapter:current, status:'queued', requested_ts:new Date().toISOString() });
  await putJson(t, 'jobs.json', jobs, js, `review: merge trigger for ${current}`);
  flash(`Queued ${p.approved.length} edit(s) for merge. Claude will merge them.`);
  } catch(e){ flash('Queue failed — your decisions are saved on this device; please retry. ' + e.message, 5000); }
}
// load the branch-built rendered version (figures + text) from preview/<ch>.html — without merging
let previewing = false;
async function togglePreview(ch){
  if (previewing){ previewing = false; loadChapter(ch); return; }
  const t = tok(); const dev = location.hostname==='localhost' || location.hostname==='127.0.0.1';
  flash('Loading the rendered staged version…');
  try {
    let html = null;
    if (dev){ const r = await fetch('./preview/'+ch+'.html'); if (r.ok) html = await r.text(); }
    if (!html && t){ const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/preview/${ch}.html?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' }); if (r.ok) html = await r.text(); }
    if (!html){ flash('No preview built yet for this chapter — it builds when changes are staged.'); return; }
    previewing = true; renderDoc(html);
  } catch(e){ flash('Preview failed: '+e.message); }
}
function markFigure(doc, c){
  const figs = [...doc.querySelectorAll('figure')];
  const q = (c.anchor.quote||'').replace(/^[^:]*:\s*/,'').replace(/\s+/g,' ').trim().slice(0,30);
  const fig = figs.find(f => f.textContent.replace(/\s+/g,' ').includes(q)) || figs.find(f => f.querySelector('img')?.src.endsWith(c.anchor.figure||' '));
  if (fig){ fig.classList.add('cmark-fig'); fig.dataset.cid = c.id; fig.style.setProperty('--mk', `var(--${c.tag})`); }
}
const escapeHtml = s => (s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
// ---------- advisor registry + invite helpers ----------
const portalBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const advisorUrl = (id, name) => `${portalBase()}advisor.html?a=${encodeURIComponent(id)}&n=${encodeURIComponent(name||'')}`;
const slugify = s => (s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32) || 'advisor';
const rand4 = () => Math.random().toString(36).slice(2,6);
async function loadAdvisorsRegistry(t){ const { json, sha } = await getJson(t, 'advisors.json').catch(() => ({ json:null, sha:null }));
  const reg = json && Array.isArray(json.advisors) ? json : { advisors: [] }; return { reg, sha }; }
const fmtDate = ts => { if(!ts) return ''; const d=new Date(ts); if(isNaN(d)) return ''; return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
const relTime = ts => { if(!ts) return ''; const s=(Date.now()-new Date(ts).getTime())/1000; if(isNaN(s)) return ''; if(s<75) return 'just now'; if(s<3600) return Math.round(s/60)+'m ago'; if(s<86400) return Math.round(s/3600)+'h ago'; return Math.round(s/86400)+'d ago'; };
function suggHtml(c){
  if (!c.edit) return '';
  const e = c.edit, find = escapeHtml((e.find||'').slice(0,140)), repl = escapeHtml((e.replacement||'').slice(0,240));
  const label = e.op==='replace'?'Replace':e.op==='insert'?'Insert after':'Delete';
  const inner = e.op==='delete' ? `<del>${find}</del>`
    : e.op==='insert' ? `<span style="color:var(--text-3)">…${find}</span> <ins>${repl}</ins>`
    : `<del>${find}</del> <ins>${repl}</ins>`;
  return `<div class="sugg"><div class="op"><i class="ti ti-pencil"></i>Suggested ${label} · verbatim</div>${inner}</div>`;
}

// ---------- search ----------
function runSearch(q){ clearSearch(); if (!q.trim()) return; const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  let first = null; document.querySelectorAll('#doc p').forEach(p => { if (re.test(p.textContent)){ p.innerHTML = p.innerHTML.replace(re, m => `<mark style="background:var(--warn-bg)">${m}</mark>`); if (!first) first = p; } });
  if (first) first.scrollIntoView({ behavior:'smooth', block:'center' }); }
function clearSearch(){ document.querySelectorAll('#doc mark').forEach(m => m.replaceWith(...m.childNodes)); }

// ---------- send to claude / cursor ----------
function openSendMenu(){
  document.getElementById('sendmenu')?.remove();
  const menu = document.createElement('div'); menu.id = 'sendmenu';
  menu.style.cssText = 'position:absolute;top:50px;right:52px;z-index:45;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.16);padding:6px;min-width:248px';
  const open = review.comments.filter(c => c.status === 'open').length;
  menu.innerHTML = `
    <div class="smi" data-type="apply-edits"><i class="ti ti-git-pull-request"></i><div><div style="font-weight:500">Apply edits${open?` · ${open}`:''}</div><div class="smi-d">stage LaTeX edits on review-edits/${current}</div></div></div>
    <div class="smi" data-type="run-agents"><i class="ti ti-robot-face"></i><div><div style="font-weight:500">Run review agents</div><div class="smi-d">dissertation-adversary read-only critique</div></div></div>
    <div class="smi" data-type="export"><i class="ti ti-file-export"></i><div><div style="font-weight:500">Export this chapter…</div><div class="smi-d">Word · PDF · Markdown, with comments</div></div></div>`;
  document.body.appendChild(menu);
  menu.querySelectorAll('.smi').forEach(el => { el.onmouseenter = () => el.style.background='var(--bg-3)'; el.onmouseleave = () => el.style.background='transparent';
    el.onclick = () => { menu.remove(); if (el.dataset.type === 'export') exportDialog(current); else sendJob(el.dataset.type); }; });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='btn-send' && !e.target.closest?.('#btn-send')){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
async function sendJob(type){
  const t = tok(); if (!t){ flash('Add your access token first (click a chapter → connect).'); return; }
  try {
    await syncUp();
    const { json, sha } = await getJson(t, 'jobs.json');
    const jobs = Array.isArray(json) ? json : [];
    if (type === 'run-agents'){
      flash('Requesting agent review…');
      jobs.push({ id:'j_'+Date.now().toString(36), type:'run-agents', chapter:current,
        agents:['dissertation-adversary'], status:'queued', requested_ts:new Date().toISOString() });
      await putJson(t, 'jobs.json', jobs, sha, 'review: agents '+current);
      flash(`Requested adversary review of Chapter ${chMeta(current).n}`);
      return;
    }
    const open = review.comments.filter(c => c.status === 'open');
    if (!open.length){ flash('No open comments to send.'); return; }
    flash('Sending…');
    jobs.push({ id:'j_'+Date.now().toString(36), type:'apply-edits', chapter:current,
      comment_ids: open.map(c => c.id), status:'queued', requested_ts:new Date().toISOString() });
    await putJson(t, 'jobs.json', jobs, sha, 'review: queue '+current);
    open.forEach(c => { review = updateComment(review, c.id, { status:'queued' }); });
    save(); await syncUp(); renderComments(); buildNav(); paintHighlights();
    flash(`Queued ${open.length} comment${open.length>1?'s':''} → review-edits/${current}`);
  } catch(e){ flash('Send failed: '+e.message); }
}
function flash(msg){ const t = document.createElement('div'); t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:9px 16px;border-radius:20px;font-size:13px;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.2)';
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
// ---------- export: chapter / dissertation -> Word · PDF · Markdown, with comments ----------
function exportDialog(scope){
  document.getElementById('expdlg')?.remove();
  const whole = scope === '__all__';
  const title = whole ? 'the whole dissertation' : `Chapter ${chMeta(scope).n} · ${escapeHtml(shortTitle(chMeta(scope).title))}`;
  const back = document.createElement('div'); back.id = 'expdlg';
  back.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center';
  back.innerHTML = `<div class="expcard" style="background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-lg);box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(460px,92vw);padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:3px">Export ${title}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Built by the real pipeline (pandoc + LaTeX) with comments and attribution. Runs in the cloud and appears under Downloads when ready.</div>
      <div class="exp-sec">Formats</div>
      <label class="exp-row"><input type="checkbox" class="exp-fmt" value="docx" checked> Word (.docx) — native comments + tracked changes</label>
      <label class="exp-row"><input type="checkbox" class="exp-fmt" value="md" checked> Markdown</label>
      <label class="exp-row"><input type="checkbox" class="exp-fmt" value="pdf"> PDF — typeset + comments annex <span style="color:var(--text-3)">(slower: full LaTeX build)</span></label>
      <div class="exp-sec" style="margin-top:12px">Comments</div>
      <label class="exp-row"><input type="checkbox" id="exp-resolved" checked> Include resolved/answered comments</label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn" id="exp-cancel">Cancel</button>
        <button class="btn btn-primary" id="exp-go"><i class="ti ti-file-export"></i>Export</button></div>
      <div id="exp-stat" style="font-size:12px;color:var(--text-3);margin-top:8px"></div></div>`;
  document.body.appendChild(back);
  back.onclick = e => { if (e.target === back) back.remove(); };
  back.querySelector('#exp-cancel').onclick = () => back.remove();
  const stat = back.querySelector('#exp-stat');
  back.querySelector('#exp-go').onclick = async () => {
    const formats = [...back.querySelectorAll('.exp-fmt:checked')].map(x => x.value);
    if (!formats.length){ stat.textContent = 'Pick at least one format.'; return; }
    const opts = { resolved: back.querySelector('#exp-resolved').checked };
    stat.textContent = 'Queuing…';
    try { await queueExport(scope, formats, opts);
      stat.textContent = 'Queued ✓ — the cloud build will produce it; check Downloads in a few minutes.';
      setTimeout(() => back.remove(), 1600); }
    catch(e){ stat.textContent = 'Failed: ' + e.message; }
  };
}
async function queueExport(scope, formats, opts){
  const t = tok(); if (!t) throw new Error('add your access token first');
  const { json, sha } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(json) ? json : [];
  jobs.push({ id:'j_'+Date.now().toString(36), type:'export', chapter:scope, formats, opts,
    status:'queued', requested_ts:new Date().toISOString() });
  await putJson(t, 'jobs.json', jobs, sha, `export: queue ${scope} (${formats.join(',')})`);
}
// all export jobs (done + in-flight), newest first — for the home Downloads section
async function listExports(){
  const t = tok(); if (!t) return [];
  const { json } = await getJson(t, 'jobs.json').catch(() => ({ json:null }));
  return (Array.isArray(json) ? json : []).filter(j => j.type === 'export')
    .sort((a,b) => (b.requested_ts||'').localeCompare(a.requested_ts||''));
}
const _expOpen = new Set();   // which chapter groups are expanded (persists within the session)
const FMT_NAME = { docx:'Word', pdf:'PDF', md:'Markdown' };
// Home Downloads: grouped by chapter, collapsible, versioned, with pending state + delete.
async function renderHomeDownloads(){
  const box = document.getElementById('home-downloads'); if (!box) return;
  const jobs = await listExports();
  const header = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div class="home-allch" style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin:0">DOWNLOADS</div>
      <button class="btn" id="dl-export-all" style="margin-left:auto;padding:5px 11px;font-size:12px"><i class="ti ti-file-export"></i>Export whole dissertation…</button></div>`;
  if (!jobs.length){ box.innerHTML = header + `<div style="font-size:12.5px;color:var(--text-3)">No exports yet. Use a chapter's “…” menu → Export, or the button above.</div>`;
    box.querySelector('#dl-export-all').onclick = () => exportDialog('__all__'); return; }
  // group by scope (chapter id or __all__)
  const groups = {};
  for (const j of jobs){ (groups[j.chapter] ||= []).push(j); }
  const order = Object.keys(groups).sort((a,b) => (a==='__all__'?99:chMeta(a).n) - (b==='__all__'?99:chMeta(b).n));
  box.innerHTML = header + order.map(scope => {
    const list = groups[scope];
    const name = scope === '__all__' ? 'Whole dissertation' : `Chapter ${chMeta(scope).n} · ${escapeHtml(shortTitle(chMeta(scope).title))}`;
    const pending = list.filter(j => j.status !== 'done').length;
    const open = _expOpen.has(scope);
    const versions = list.map(j => {
      const when = j.done_ts ? fmtDate(j.done_ts) : (j.requested_ts ? fmtDate(j.requested_ts) : '');
      if (j.status !== 'done'){
        const lbl = j.status === 'queued' ? 'queued — building when the executor runs' : (j.status||'building') + '…';
        return `<div class="dl-ver"><div class="dl-ver-h"><i class="ti ti-clock" style="color:var(--warn)"></i> ${when} <span style="color:var(--warn)">${lbl}</span></div></div>`;
      }
      const dls = (j.artifacts||[]).map(art => `<button class="btn dl-get" data-path="${escapeHtml(art.path)}" style="padding:3px 9px;font-size:11.5px"><i class="ti ti-download"></i>${art.chapter && scope==='__all__' ? escapeHtml((chMeta(art.chapter).n||'')+'·') : ''}${FMT_NAME[art.fmt]||art.fmt}</button>`).join(' ');
      return `<div class="dl-ver"><div class="dl-ver-h">${when}<button class="dl-del" data-job="${escapeHtml(j.id)}" title="Delete this export"><i class="ti ti-trash"></i></button></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${dls}</div></div>`;
    }).join('');
    return `<div class="dl-grp"><button class="dl-grp-h" data-scope="${escapeHtml(scope)}"><i class="ti ti-chevron-${open?'down':'right'}"></i><span>${name}</span><span class="dl-count">${list.length} version${list.length>1?'s':''}${pending?` · ${pending} building`:''}</span></button>
      <div class="dl-grp-body" style="display:${open?'block':'none'}">${versions}</div></div>`;
  }).join('');
  box.querySelector('#dl-export-all').onclick = () => exportDialog('__all__');
  box.querySelectorAll('.dl-grp-h').forEach(h => h.onclick = () => { const s = h.dataset.scope; _expOpen.has(s) ? _expOpen.delete(s) : _expOpen.add(s); renderHomeDownloads(); });
  box.querySelectorAll('.dl-get').forEach(b => b.onclick = () => downloadArtifact(b.dataset.path));
  box.querySelectorAll('.dl-del').forEach(b => b.onclick = () => deleteExport(b.dataset.job));
}
async function deleteExport(jobId){
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  const { json, sha } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(json) ? json : [];
  const job = jobs.find(j => j.id === jobId); if (!job) return;
  if (!confirm(`Delete this export (${(job.artifacts||[]).length} file${(job.artifacts||[]).length!==1?'s':''})? This can't be undone.`)) return;
  flash('Deleting…');
  try {
    for (const art of (job.artifacts||[])) await deleteFile(t, art.path, `export: delete ${art.path}`);
    const left = jobs.filter(j => j.id !== jobId);
    await putJson(t, 'jobs.json', left, sha, `export: remove job ${jobId}`);
    flash('Deleted ✓'); renderHomeDownloads();
  } catch(e){ flash('Delete failed: ' + e.message); }
}
const _SAVE_TYPES = {
  docx: { description:'Word document', accept:{ 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx'] } },
  pdf:  { description:'PDF', accept:{ 'application/pdf':['.pdf'] } },
  md:   { description:'Markdown', accept:{ 'text/markdown':['.md'] } },
};
// save a blob with the native Finder/Explorer dialog (Chromium) or a standard download (Safari/Firefox)
async function saveBlob(blob, filename){
  if (window.showSaveFilePicker){
    try {
      const ext = (filename.split('.').pop()||'').toLowerCase(); const ty = _SAVE_TYPES[ext];
      const handle = await window.showSaveFilePicker({ suggestedName: filename, ...(ty ? { types:[ty] } : {}) });
      const ws = await handle.createWritable(); await ws.write(blob); await ws.close(); return;
    } catch(e){ if (e.name === 'AbortError') return; /* unsupported/blocked → fall back below */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function downloadArtifact(path){
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  flash('Fetching…');
  let blob;
  try { const url = `https://api.github.com/repos/mattlmccoy/dissertation-tracker-data/contents/${path}?t=${Date.now()}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (!r.ok) throw new Error('GitHub '+r.status);
    blob = await r.blob();
  } catch(e){ flash('Download failed: ' + e.message); return; }
  await saveBlob(blob, path.split('/').pop()); flash('Saved ✓');
}
function restoreCursor(){ if (review.cursor?.sec){ document.getElementById(review.cursor.sec)?.scrollIntoView(); } }

// ---------- home / chapter library ----------
const DEFENSE = '2026-10-15';
const daysToDefense = () => Math.max(0, Math.ceil((new Date(DEFENSE) - new Date()) / 86400000));
function chapterStats(ch){
  const r = JSON.parse(localStorage.getItem('review:'+ch) || 'null');
  const checked = r?.read ? Object.keys(r.read).length : 0;
  const sec = r?.secCount || 0;
  return { open: r ? r.comments.filter(c=>c.status==='open').length : 0,
           merged: r ? r.comments.filter(c=>c.status==='merged').length : 0,
           total: r ? r.comments.length : 0,
           checked, sec, frac: sec ? checked/sec : 0, readDone: sec>0 && checked>=sec };
}
function enterHome(){
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<span style="display:inline-flex;align-items:center;gap:8px"><svg width="20" height="20" viewBox="0 0 52 52" style="flex:0 0 auto"><rect x="3" y="3" width="46" height="46" rx="12" fill="#2c64c4"/><line x1="19" y1="14" x2="19" y2="38" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="38" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="38" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.6" fill="#fff"/></svg><strong style="font-size:16px;font-weight:600">Footnote</strong></span>
     <span style="margin-left:auto;font-size:12.5px;color:var(--text-2);display:inline-flex;align-items:center;gap:6px"><i class="ti ti-flag"></i>defense in ${daysToDefense()} days</span>
     <button class="btn" id="btn-token" style="padding:6px 12px${tok()?'':';color:var(--warn);border-color:var(--warn)'}" title="Your GitHub access token"><i class="ti ti-key"></i>${tok()?'Token':'Add token'}</button>
     <button class="btn" id="btn-outline" style="padding:6px 12px" title="Proposed outline (what advisors see)"><i class="ti ti-list-tree"></i>Outline</button>
     <button class="btn" id="btn-export" style="padding:6px 12px" title="Printable response to advisor comments"><i class="ti ti-file-text"></i>Response</button>
     <button class="btn" id="btn-releases" style="padding:6px 12px"><i class="ti ti-users"></i>Reviewers</button>
     <button class="icbtn" id="btn-tour" title="Take the tour"><i class="ti ti-help-circle"></i></button>
     <a class="icbtn" href="./index.html" title="Back to dashboard"><i class="ti ti-layout-dashboard"></i></a>
     <button class="icbtn" id="btn-theme"><i class="ti ti-moon"></i></button>`;
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-releases').onclick = openReleasePanel;
  document.getElementById('btn-export').onclick = exportAdvisorResponse;
  document.getElementById('btn-outline').onclick = loadOwnerOutline;
  document.getElementById('btn-token').onclick = manageToken;
  document.getElementById('btn-tour').onclick = openTourMenu;
  read.innerHTML = homeHtml();
  read.querySelectorAll('.chcard[data-ch], .btn[data-ch]').forEach(el => el.onclick = () => enterChapter(el.dataset.ch));
  refreshInbox();
  renderHomeDownloads();
}
// ---------- proposed outline (read-only view of what advisors see) ----------
async function loadOwnerOutline(){
  current = '__outline__'; review = loadLocalReview('__outline__'); localStorage.setItem('lastChapter', '__outline__');
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = '';
  document.getElementById('topbar').innerHTML = `<button class="icbtn" id="ol-back" title="Home"><i class="ti ti-arrow-left"></i></button>
    <strong style="font-size:15px;font-weight:600;margin-left:4px">Proposed outline</strong>
    <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place" style="margin-left:auto"><i class="ti ti-refresh"></i></button>
    <button class="icbtn" id="btn-theme"><i class="ti ti-moon"></i></button>`;
  document.getElementById('ol-back').onclick = enterHome;
  document.getElementById('btn-theme').onclick = toggleTheme;
  read.innerHTML = `<div class="empty">Loading outline…</div>`;
  let data = null; const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  try {
    if (dev){ const r = await fetch('./outline.json'); if (r.ok) data = await r.json(); }
    if (!data){ const t = tok(); if (t){ const got = await getJson(t, 'outline.json'); data = got.json; } }
  } catch(e){}
  if (!data){ read.innerHTML = `<div class="empty">Couldn't load the outline. Open a chapter once to connect your token, then retry.</div>`; return; }
  renderOwnerOutline(data); renderComments(); syncDown();
  loadAdvisorComments('__outline__').then(() => renderOwnerOutline(data));   // pull advisor outline comments into the rail + refresh node badges
}
function renderOwnerOutline(data){
  const cnt = (label, sec) => review.comments.concat(advisorComments).filter(c => c.anchor?.quote===label && c.anchor?.section===sec).length;   // count your notes AND advisor comments on this node
  const badge = n => n ? `<i class="ti ti-message"></i>${n}` : `<i class="ti ti-message-plus"></i>`;
  const node = (title, synopsis, sec, cls) => `<div class="ol-node ${cls}"><div class="ol-srow"><span class="ol-slabel">${escapeHtml(title)}</span>${synopsis?`<span class="ol-syn">${escapeHtml(synopsis)}</span>`:''}</div>
      <button class="ol-cmt" data-node="${escapeHtml(title)}" data-sec="${escapeHtml(sec)}">${badge(cnt(title, sec))}</button></div>`;
  const chapters = data.chapters.map(ch => {
    const secs = (ch.sections||[]).map(s => {
      const subs = (s.subsections||[]).map(ss => node(ss.title, ss.synopsis, ch.title, 'ol-sub')).join('');
      return node(s.title, s.synopsis, ch.title, 'ol-sec') + subs;
    }).join('');
    return `<div class="ol-chapter open"><div class="ol-chead" data-toggle><i class="ti ti-chevron-right ol-chev"></i><span class="ol-cn">${ch.n}</span>
        <div style="min-width:0;flex:1"><div class="ol-ctitle">${escapeHtml(ch.title)}</div>${ch.synopsis?`<div class="ol-csyn">${escapeHtml(ch.synopsis)}</div>`:''}</div>
        <button class="ol-cmt" data-node="${escapeHtml(ch.title)}" data-sec="${escapeHtml(ch.title)}">${badge(cnt(ch.title, ch.title))}</button></div>
      <div class="ol-sections">${secs}</div></div>`;
  }).join('');
  read.innerHTML = `<div class="ol-wrap"><h1 class="ol-h1">${escapeHtml(data.title||'Proposed outline')}</h1>
    <p class="ol-intro">${escapeHtml(data.intro||'')}</p>
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:16px">This is what advisors and lab reviewers see. Comment on any node to leave yourself a note; their outline comments land in your inbox. Edit the structure by updating <code>outline.json</code>.</div>${chapters}</div>`;
  read.querySelectorAll('[data-toggle]').forEach(h => h.onclick = e => { if (e.target.closest('.ol-cmt')) return; h.closest('.ol-chapter').classList.toggle('open'); });
  read.querySelectorAll('.ol-cmt').forEach(b => b.onclick = e => { e.stopPropagation(); ownerOutlineComment(b, b.dataset.node, b.dataset.sec); });
}
function ownerOutlineComment(btn, label, section){
  document.getElementById('ol-composer')?.remove();
  const box = document.createElement('div'); box.id = 'ol-composer'; box.className = 'ol-composer';
  box.innerHTML = `<textarea rows="2" placeholder="Note on “${escapeHtml(label)}”…"></textarea>
    <div class="ol-cactions"><button class="btn btn-primary ol-save" style="padding:4px 11px;font-size:12px">Add note</button><button class="btn ol-cancel" style="padding:4px 11px;font-size:12px">Cancel</button></div>`;
  (btn.closest('.ol-node, .ol-chead')||btn).after(box); box.querySelector('textarea').focus();
  box.querySelector('.ol-cancel').onclick = () => box.remove();
  box.querySelector('.ol-save').onclick = () => { const v = box.querySelector('textarea').value.trim(); if (!v) return;
    review = addComment(review, { anchor:{ quote:label, section }, kind:'text', tag:'wording', body:v });
    save(); syncUpSoon(); box.remove();
    const n = review.comments.filter(c => c.anchor?.quote===label && c.anchor?.section===section).length; btn.innerHTML = `<i class="ti ti-message"></i>${n}`;
    renderComments(); flash('Note added to the outline.'); };
}
// ---------- inbox / triage: aggregate everything that needs the owner across all chapters ----------
async function gatherInbox(t){
  const paths = await ghTree(t);
  const has = p => paths.includes(p);
  const jr = await getJson(t, 'jobs.json').catch(() => ({ json:null }));
  const jobs = Array.isArray(jr.json) ? jr.json : [];
  const chData = await Promise.all(CHAPTERS.map(async c => {
    const p = `reviews/${c.id}.json`;
    const r = has(p) ? await getJson(t, p).catch(() => ({ json:null })) : { json:null };
    const cs = r.json?.comments || [];
    return { ch:c.id, n:c.n, title:c.title,
      open: cs.filter(x => x.status==='open').length,
      staged: cs.filter(x => x.status==='staged' || x.status==='approved').length,
      merged: cs.filter(x => x.status==='merged').length, total: cs.length };
  }));
  const advFiles = paths.filter(p => /^advisor\/[^/]+\/[^/]+\.json$/.test(p));
  const advRaw = await Promise.all(advFiles.map(async p => {
    const m = p.match(/^advisor\/([^/]+)\/(.+)\.json$/);
    const r = await getJson(t, p).catch(() => ({ json:null }));
    const fresh = (r.json?.comments || []).filter(x => x.status==='submitted' && !x.resolution);
    return fresh.length ? { advisor:m[1], ch:m[2], count:fresh.length } : null;
  }));
  return { jobs, chData, adv: advRaw.filter(Boolean) };
}
// printable "how each advisor comment was addressed" — neutral, author-facing wording (never AI)
async function exportAdvisorResponse(){
  const t = tok(); if (!t){ flash('Connect first to build the response.'); return; }
  flash('Building response…');
  try {
    const paths = await ghTree(t);
    const advFiles = paths.filter(p => /^advisor\/[^/]+\/.+\.json$/.test(p));
    const byAdv = {};
    await Promise.all(advFiles.map(async p => {
      const m = p.match(/^advisor\/([^/]+)\/(.+)\.json$/);
      const r = await getJson(t, p).catch(() => ({ json:null }));
      const cs = (r.json?.comments || []).filter(x => x.status === 'submitted');
      if (cs.length) (byAdv[m[1]] ??= []).push({ ch:m[2], comments:cs });
    }));
    const RES = { addressed:'Addressed — changed as suggested', declined:'Kept as written', noted:'Noted' };
    const advs = Object.keys(byAdv).sort();
    if (!advs.length){ flash('No advisor comments to export yet.'); return; }
    const sections = advs.map(a => {
      const name = ADVISOR_NAME[a] || a;
      const items = byAdv[a].sort((x,y) => (chMeta(x.ch).n||0)-(chMeta(y.ch).n||0)).map(g => {
        const rows = g.comments.map(c => {
          const r = c.resolution;
          const status = r ? RES[r.state] || 'Noted' : '<i style="color:#999">Pending</i>';
          return `<tr><td class="q">"${escapeHtml((c.anchor?.quote||'').slice(0,90))}"</td>
            <td class="cm">${escapeHtml(c.body)}</td>
            <td class="rs"><b>${status}</b>${r?.note?`<div>${escapeHtml(r.note)}</div>`:''}</td></tr>`;
        }).join('');
        return `<h3>Chapter ${chMeta(g.ch).n} — ${escapeHtml(shortTitle(chMeta(g.ch).title))}</h3>
          <table><thead><tr><th>Passage</th><th>Comment</th><th>Response</th></tr></thead><tbody>${rows}</tbody></table>`;
      }).join('');
      return `<section><h2>Response to ${escapeHtml(name)}</h2>${items}</section>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Response to reviewer comments</title>
      <style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#1a1a1a}
      h1{font-size:22px} h2{font-size:17px;margin-top:30px;border-bottom:2px solid #333;padding-bottom:4px} h3{font-size:14px;color:#444;margin:18px 0 6px}
      table{width:100%;border-collapse:collapse;margin-bottom:10px} th,td{border:1px solid #ddd;padding:7px 9px;vertical-align:top;text-align:left;font-size:12.5px}
      th{background:#f4f4f4;font-size:11px;text-transform:uppercase;letter-spacing:.04em} td.q{width:30%;color:#555;font-style:italic} td.rs b{color:#1a7a3a} td.rs div{color:#444;margin-top:3px}
      @media print{body{margin:0}}</style></head>
      <body><h1>Response to reviewer comments</h1><p style="color:#666">Prepared by the author · ${new Date().toISOString().slice(0,10)}</p>${sections}</body></html>`;
    const w = window.open('', '_blank'); if (!w){ flash('Allow pop-ups to open the response.'); return; }
    w.document.write(html); w.document.close();
  } catch(e){ flash('Export failed: '+e.message); }
}
async function refreshInbox(){
  const panel = document.getElementById('inbox-panel'); if (!panel) return;
  const t = tok(); if (!t){ panel.style.display = 'none'; return; }
  try { renderInbox(panel, await gatherInbox(t)); }
  catch(e){ panel.innerHTML = `<div class="ibx-empty">Couldn't load triage (${escapeHtml(e.message)}).</div>`; }
}
function renderInbox(panel, { jobs, chData, adv }){
  const advByCh = {}; adv.forEach(a => { advByCh[a.ch] = (advByCh[a.ch]||0) + a.count; });
  const stagedTotal = chData.reduce((s,c) => s + c.staged, 0);
  const advTotal = adv.reduce((s,a) => s + a.count, 0);
  const queued = jobs.filter(j => j.status==='queued').length;
  const running = jobs.filter(j => j.status==='running').length;
  const firstStaged = chData.find(c => c.staged);
  const firstAdv = adv[0];
  const chip = (icon, n, label, color, ch) => n
    ? `<button class="ibx-chip" ${ch?`data-ch="${ch}"`:''} style="--c:${color}"><i class="ti ti-${icon}"></i><b>${n}</b> ${label}</button>` : '';
  const chips = [
    chip('git-pull-request', stagedTotal, 'staged to approve', 'var(--info)', firstStaged?.ch),
    chip('user-exclamation', advTotal, 'new advisor comment'+(advTotal!==1?'s':''), 'var(--accent)', firstAdv?.ch),
    chip('clock-play', queued+running, 'Claude job'+(queued+running!==1?'s':'')+(running?' running':' queued'), 'var(--warn)'),
  ].filter(Boolean).join('');
  const cell = (n, cls, ch) => n
    ? `<button class="mx ${cls}" data-ch="${ch}">${n}</button>` : `<span class="mx mx0">·</span>`;
  const rows = chData.map(c => `<div class="mxrow">
      <button class="mxname" data-ch="${c.ch}">Ch ${c.n}</button>
      ${cell(c.open,'mxopen',c.ch)}${cell(c.staged,'mxstaged',c.ch)}${advByCh[c.ch]?`<button class="mx mxadv" data-ch="${c.ch}">${advByCh[c.ch]}</button>`:'<span class="mx mx0">·</span>'}${cell(c.merged,'mxmerged',c.ch)}
    </div>`).join('');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="ibx-head"><i class="ti ti-inbox"></i>Needs you${(stagedTotal||advTotal||queued||running)?'':' — all clear ✓'}</div>
    ${chips ? `<div class="ibx-chips">${chips}</div>` : ''}
    <div class="mxgrid">
      <div class="mxrow mxhead"><span class="mxname"></span><span class="mx">open</span><span class="mx">staged</span><span class="mx">advisor</span><span class="mx">merged</span></div>
      ${rows}
    </div>`;
  panel.querySelectorAll('[data-ch]').forEach(el => el.onclick = () => enterChapter(el.dataset.ch));
}
function homeHtml(){
  const last = localStorage.getItem('lastChapter');
  const lm = last && chMeta(last);
  const lr = last ? JSON.parse(localStorage.getItem('review:'+last) || 'null') : null;
  const cont = lm ? `<div style="border:.5px solid var(--accent);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;display:flex;align-items:center;gap:14px">
      <i class="ti ti-player-play" style="font-size:22px;color:var(--accent)"></i>
      <div style="min-width:0">
        <div style="font-size:11.5px;color:var(--text-2)">Continue where you left off</div>
        <div style="font-size:14px;font-weight:500">Chapter ${lm.n} · ${shortTitle(lm.title)}</div>
        ${lr?.comments?.length ? `<div style="font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">last comment: "${escapeHtml(lr.comments[lr.comments.length-1].body).slice(0,64)}"</div>` : ''}
      </div>
      <button class="btn" data-ch="${last}" style="margin-left:auto;flex-shrink:0">Resume</button></div>` : '';
  const cards = CHAPTERS.map(c => {
    const s = chapterStats(c.id); const pct = Math.round(s.frac*100);
    const done = s.readDone;
    const bar = done ? 'var(--success)' : 'var(--accent)';
    const status = done ? `<span style="color:var(--success)">complete</span>` : s.checked>0 ? `${s.checked}/${s.sec} sections` : `not started`;
    const right = s.open ? `<span style="color:var(--accent)">${s.open} open</span>` : s.merged ? `${s.merged} merged` : `<span style="color:var(--text-3)">—</span>`;
    return `<div class="chcard" data-ch="${c.id}" style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 15px;cursor:pointer">
        <div style="font-size:11.5px;color:var(--text-3)">Chapter ${c.n}</div>
        <div style="font-size:14px;font-weight:500;line-height:1.35;margin:3px 0 11px;min-height:38px">${shortTitle(c.title)}</div>
        <div style="height:5px;border-radius:4px;background:var(--bg-3);overflow:hidden;margin-bottom:8px"><div style="width:${done?100:pct}%;height:100%;background:${bar}"></div></div>
        <div style="font-size:11px;color:var(--text-2);display:flex"><span>${status}</span><span style="margin-left:auto">${right}</span></div></div>`;
  }).join('');
  return `<div id="home-wrap" style="max-width:900px;margin:0 auto;padding:28px 24px 90px">
      ${cont}
      <div class="home-allch" style="font-size:11px;letter-spacing:.06em;color:var(--text-3);margin-bottom:13px">ALL CHAPTERS</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px">${cards}</div>
      <div id="inbox-panel" class="ibx" style="display:none;margin-top:28px;margin-bottom:0"></div>
      <div id="home-downloads" style="margin-top:36px"></div></div>`;
}

// ---------- history / version timeline (data repo content commits — readable with the data-repo token) ----------
const HIST_REPO = 'mattlmccoy/dissertation-tracker-data';
async function ghApi(t, path){
  const r = await fetch('https://api.github.com/' + path, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github+json' } });
  if (!r.ok) throw new Error('HTTP '+r.status); return r.json();
}
async function showHistory(){
  const t = tok();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  if (!t){ read.innerHTML = `<div class="empty"><div style="font-size:15px;font-weight:500">History needs your access token</div><div style="font-size:13px;color:var(--text-2);margin-top:6px">Open a chapter and add your data-repo token first.</div></div>`; return; }
  if (!current){ read.innerHTML = `<div class="empty">Open a chapter first, then view its history.</div>`; return; }
  read.innerHTML = `<div class="empty">Loading history…</div>`;
  const file = `content/${current}.html`;
  try {
    const commits = await ghApi(t, `repos/${HIST_REPO}/commits?path=${encodeURIComponent(file)}&per_page=20`);
    if (!commits.length){ read.innerHTML = `<div class="empty">No revision history recorded for this chapter yet.</div>`; return; }
    renderHistoryShell(commits, file); selectCommit(commits[0].sha, file);
  } catch(e){ read.innerHTML = `<div class="empty">Couldn't load history (${e.message}).</div>`; }
}
function renderHistoryShell(commits, file){
  const m = chMeta(current);
  read.innerHTML = `<div style="height:100%;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:.5px solid var(--border);background:var(--bg-2)">
        <i class="ti ti-history"></i><strong style="font-weight:600">History · Chapter ${m.n}</strong>
        <button class="btn" id="hist-close" style="margin-left:auto"><i class="ti ti-x"></i>Close</button></div>
      <div style="flex:1;display:flex;min-height:0">
        <div id="hist-list" style="flex:0 0 290px;border-right:.5px solid var(--border);overflow:auto;padding:12px 10px"></div>
        <div id="hist-diff" style="flex:1;min-width:0;overflow:auto;padding:16px 20px"></div></div></div>`;
  document.getElementById('hist-close').onclick = () => enterChapter(current);
  document.getElementById('hist-list').innerHTML = commits.map(c => {
    const d = new Date(c.commit.author.date), msg = c.commit.message.split('\n')[0];
    return `<div class="hcommit" data-sha="${c.sha}" style="display:flex;gap:9px;padding:9px 10px;border-radius:8px;cursor:pointer">
      <i class="ti ti-git-commit" style="color:var(--text-3);margin-top:2px"></i>
      <div style="min-width:0"><div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(msg).slice(0,42)}</div>
        <div style="font-size:10.5px;color:var(--text-3)">${escapeHtml(c.commit.author.name.split(' ')[0])} · ${d.toLocaleDateString()} · ${c.sha.slice(0,7)}</div></div></div>`;
  }).join('');
  document.querySelectorAll('.hcommit').forEach(el => el.onclick = () => selectCommit(el.dataset.sha, file));
}
async function selectCommit(sha, file){
  document.querySelectorAll('.hcommit').forEach(el => el.style.background = el.dataset.sha === sha ? 'var(--accent-bg)' : 'transparent');
  const diff = document.getElementById('hist-diff'); diff.innerHTML = 'Loading…';
  try {
    const detail = await ghApi(tok(), `repos/${HIST_REPO}/commits/${sha}`);
    const f = (detail.files||[]).find(x => x.filename === file) || {};
    const d = new Date(detail.commit.author.date);
    diff.innerHTML = `
      <div style="font-size:13px;color:var(--text-3);margin-bottom:4px">${d.toLocaleString()} · ${escapeHtml(detail.commit.author.name)} · ${sha.slice(0,7)}</div>
      <div style="font-size:15px;font-weight:600;white-space:pre-wrap;margin-bottom:12px">${escapeHtml(detail.commit.message)}</div>
      <div style="display:flex;gap:14px;font-size:12.5px;color:var(--text-2);margin-bottom:14px">
        <span><b style="color:var(--success)">+${f.additions||0}</b> added</span>
        <span><b style="color:var(--danger)">−${f.deletions||0}</b> removed</span>
        <span>${f.changes||0} line${f.changes===1?'':'s'} changed</span></div>
      <div style="font-size:11px;letter-spacing:.05em;color:var(--text-3);margin-bottom:7px">WHAT CHANGED · removed text in red, added in green</div>
      ${renderPatch(f.patch)}
      <div style="font-size:12px;color:var(--text-3);margin-top:16px;border-top:.5px solid var(--border);padding-top:12px">Diff of the chapter's published text; figure/image swaps show as a single line. The reading view above always reflects the latest published version.</div>`;
  } catch(e){ diff.innerHTML = `<div style="color:var(--text-3)">Couldn't load this revision (${e.message}).</div>`; }
}
// readable old-vs-new diff of the chapter's published text: strip HTML tags so prose shows,
// collapse the giant base64 image lines, keep red (removed) / green (added)
function renderPatch(patch){
  if (!patch) return `<div style="color:var(--text-3);font-size:12.5px;padding:4px 0">No line-level diff is available for this revision — the change was too large for GitHub to inline (often a figure/image swap).</div>`;
  const rows = []; let lastEllipsis = false;
  patch.split('\n').slice(0, 900).forEach(l => {
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')) return;
    if (l.startsWith('@@')){ if (!lastEllipsis){ rows.push(`<div class="hd-gap">⋯</div>`); lastEllipsis = true; } return; }
    const c = l[0], rest = l.slice(1);
    if (l.length > 240){ rows.push(`<div class="hd-img">${c==='+'?'＋':c==='-'?'－':' '} (embedded image or long block changed)</div>`); lastEllipsis = false; return; }
    const text = escapeHtml(rest.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g,' ').trim());
    if (!text){ return; }                                  // tag-only / blank line — skip
    lastEllipsis = false;
    if (c === '+') rows.push(`<div class="hd-add">+ ${text}</div>`);
    else if (c === '-') rows.push(`<div class="hd-del">− ${text}</div>`);
    else rows.push(`<div class="hd-ctx">${text}</div>`);
  });
  const body = rows.join('') || `<div style="padding:10px;color:var(--text-3)">No textual changes in this revision (formatting or image only).</div>`;
  return `<div class="hdiff">${body}</div>`;
}

// ---------- global search (across the dissertation) ----------
let searchIndex = null;
async function loadIndex(){
  if (searchIndex) return searchIndex;
  const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (dev){ try { const r = await fetch('./search_index.json'); if (r.ok){ searchIndex = await r.json(); return searchIndex; } } catch(e){} }
  const t = tok(); if (!t) return null;
  try { const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/search_index.json`,
      { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' } });
    searchIndex = await r.json(); return searchIndex; } catch(e){ return null; }
}
async function globalSearch(q){
  if (!q.trim()) return;
  const idx = await loadIndex(); if (!idx){ flash('Global search needs your access token.'); return; }
  const ql = q.toLowerCase(), hits = [];
  for (const [ch, secs] of Object.entries(idx)) for (const s of secs)
    if ((s.h + ' ' + s.t).toLowerCase().includes(ql)) hits.push({ ch, h:s.h, snip: s.h + ' — ' + s.t });
  showSearchResults(q, hits.slice(0, 60));
}
function showSearchResults(q, hits){
  document.getElementById('searchpanel')?.remove();
  const p = document.createElement('div'); p.id = 'searchpanel';
  p.style.cssText = 'position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:50;width:min(640px,92%);max-height:72vh;overflow:auto;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-lg);box-shadow:0 14px 44px rgba(0,0,0,.18);padding:8px';
  p.innerHTML = `<div style="font-size:11px;color:var(--text-3);padding:6px 10px">${hits.length} result${hits.length!==1?'s':''} across the dissertation for "${escapeHtml(q)}"</div>` +
    (hits.length ? hits.map(h => `<div class="sres" data-ch="${h.ch}" data-h="${escapeHtml(h.h)}" style="padding:9px 10px;border-radius:8px;cursor:pointer">
        <div style="font-size:12px;font-weight:500">${chMeta(h.ch).n}. ${escapeHtml(shortTitle(chMeta(h.ch).title))} <span style="color:var(--text-3)">· ${escapeHtml(h.h).slice(0,42)}</span></div>
        <div style="font-size:11.5px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(h.snip).slice(0,120)}</div></div>`).join('') : `<div style="padding:10px;color:var(--text-3)">No matches.</div>`);
  document.body.appendChild(p);
  p.querySelectorAll('.sres').forEach(el => el.onclick = () => { p.remove(); const h = el.dataset.h; enterChapter(el.dataset.ch);
    setTimeout(() => { const hh = [...document.querySelectorAll('#doc h2, #doc h3')].find(x => x.textContent.trim() === h); hh?.scrollIntoView({ behavior:'smooth', block:'start' }); }, 1800); });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!p.contains(e.target)){ p.remove(); document.removeEventListener('click', h); } }), 0);
}

// ---------- panes / focus / keyboard ----------
function toggleNav(){ const n = document.getElementById('nav'); if (n) n.style.display = n.style.display==='none'?'':'none'; }
function toggleRail(){ const c = document.getElementById('comments'); if (c) c.style.display = c.style.display==='none'?'':'none'; }
function toggleFocus(){ document.body.classList.toggle('focusmode'); flash(document.body.classList.contains('focusmode')?'Focus mode on — press f to exit':'Focus mode off'); }
function cycleComment(dir){
  const list = filteredComments(); if (!list.length) return;
  let i = list.findIndex(c => c.id === activeCommentId);
  i = i < 0 ? (dir > 0 ? 0 : list.length-1) : (i + dir + list.length) % list.length;
  const c = list[i]; activeCommentId = c.id; renderComments(); jumpTo(c);
  document.querySelector(`#comments .ccard[data-id="${c.id}"]`)?.scrollIntoView({ block:'nearest' });
}
const SHORTCUTS = [['j / k','next / previous comment'],['↵ on a comment','jump to its place in the text'],['f','focus (distraction-free) mode'],['[ / ]','collapse left nav / comments rail'],['/','search this chapter'],[`${MOD}\\`,'search the whole dissertation'],[`${MOD}↵`,'open the Send to Claude menu'],['⌥1–5 (in popover)','pick a tag'],['Esc','close popover / overlay'],['?','show this help']];
const BUTTONS = [
  ['ti-layout-grid','Home — the chapter library'],
  ['ti-book-2','Chapter switcher'],
  ['ti-search',`Search this chapter (${MOD}\\ = whole dissertation)`],
  ['ti-arrows-diagonal-minimize-2','Focus mode — hide both side panes'],
  ['ti-history','Version history & diffs for this chapter'],
  ['ti-moon','Light / dark theme'],
  ['ti-send','Send to Claude — apply edits or run review agents'],
  ['ti-circle','Check off a section as read (left rail)'],
  ['ti-dots','This menu — token, shortcuts, dashboard'],
];
function toggleHelp(){
  const ex = document.getElementById('helpov'); if (ex){ ex.remove(); return; }
  const ov = document.createElement('div'); ov.id = 'helpov';
  ov.innerHTML = `<div class="help-card">
    <div class="help-h">Reference</div>
    <div class="help-sub">Toolbar</div>
    ${BUTTONS.map(([ic,d]) => `<div class="help-row"><span class="help-ic"><i class="ti ${ic}"></i></span><span>${d}</span></div>`).join('')}
    <div class="help-sub" style="margin-top:14px">Keyboard</div>
    ${SHORTCUTS.map(([k,d]) => `<div class="help-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}
    <div style="text-align:right;margin-top:14px"><button class="btn" id="help-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#help-x').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
}
function openMoreMenu(){
  document.getElementById('moremenu')?.remove();
  const menu = document.createElement('div'); menu.id = 'moremenu';
  menu.style.cssText = 'position:absolute;top:50px;right:14px;z-index:45;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.16);padding:6px;min-width:220px';
  const hasTok = !!tok();
  const autoOff = tourSeen('tour-owner-v1');   // true = tour won't auto-show for returning users
  menu.innerHTML = `
    <div class="mmi" data-act="release"><i class="ti ti-users"></i>Reviewers…</div>
    <div class="mmi" data-act="help"><i class="ti ti-keyboard"></i>Buttons & shortcuts</div>
    <div class="mmi" data-act="token"><i class="ti ti-key"></i>Access token${hasTok?' <span style="color:var(--success);font-size:11px;margin-left:auto">connected</span>':' <span style="color:var(--warn);font-size:11px;margin-left:auto">not set</span>'}</div>
    <div class="mmi" data-act="tour"><i class="ti ti-help-circle"></i>Take the setup tour</div>
    <div class="mmi" data-act="tourchapter"><i class="ti ti-book-2"></i>Reviewing a chapter (demo)</div>
    <div class="mmi" data-act="tourtoggle"><i class="ti ti-${autoOff?'eye-off':'eye-check'}"></i>Auto-show tour: ${autoOff?'off — turn on':'on — turn off'}</div>
    <div class="mmi" data-act="dash"><i class="ti ti-layout-dashboard"></i>Back to dashboard</div>`;
  document.body.appendChild(menu);
  const acts = { release: openReleasePanel, help: toggleHelp, token: manageToken, dash: () => location.href = './index.html', tour: launchOwnerTour, tourchapter: launchOwnerChapterTour,
    tourtoggle: () => { if (tourSeen('tour-owner-v1')){ localStorage.removeItem('tour-owner-v1'); flash('Auto-tour turned on — it\'ll show on next load.'); }
      else { markTourSeen('tour-owner-v1'); flash('Auto-tour turned off.'); } } };
  menu.querySelectorAll('.mmi').forEach(el => { el.onmouseenter = () => el.style.background='var(--bg-3)'; el.onmouseleave = () => el.style.background='transparent';
    el.onclick = () => { menu.remove(); acts[el.dataset.act](); }; });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='btn-more' && !e.target.closest?.('#btn-more')){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
function manageToken(){
  const cur = tok();
  const v = prompt(cur ? 'Access token is set. Paste a new one to replace it, or leave blank and OK to remove it:' : 'Paste a fine-grained PAT (Contents: read/write on the data repo):', '');
  if (v === null) return;
  if (v.trim() === ''){ if (cur && confirm('Remove the saved access token from this browser?')){ localStorage.removeItem('ghpat'); flash('Token removed.'); } return; }
  localStorage.setItem('ghpat', v.trim()); flash('Token saved.'); if (document.getElementById('doc') || current) loadChapter(current);
}
// ---------- release gate: control which chapters each advisor's portal shows ----------
async function openReleasePanel(){
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<strong style="font-size:16px;font-weight:600"><i class="ti ti-users" style="margin-right:7px"></i>Reviewers</strong>
     <button class="btn" id="rel-close" style="margin-left:auto"><i class="ti ti-arrow-left"></i>Back to chapters</button>`;
  document.getElementById('rel-close').onclick = enterHome;
  read.innerHTML = `<div class="rel-page"><div id="rel-body" style="color:var(--text-3)">Loading…</div></div>`;
  let rel, sha;
  try { const r = await getJson(t, 'release.json'); rel = r.json || {}; sha = r.sha; }
  catch(e){ document.getElementById('rel-body').textContent = 'Could not load release.json ('+e.message+').'; return; }
  if (!rel.general) rel.general = { name:'General reviewers', released:[] };   // shared lab-reviewer gate
  const advs = Object.keys(rel).filter(k => k !== '_comment');                 // gating rows + portal links
  const base = location.origin + location.pathname.replace(/[^/]+$/, '');
  const { reg: advReg, sha: advSha } = await loadAdvisorsRegistry(t);
  // discover every reviewer comment file (named advisors AND per-person lab reviewers) via the tree
  const inbox = {};   // inbox[fileId] = [{chapter, comment}]
  const filesByAdv = {};   // filesByAdv[id] = [comment-file paths] — used to clear a person from the inbox
  let advFilePaths = [];
  try { const paths = await ghTree(t); advFilePaths = paths.filter(p => /^advisor\/[^/]+\/.+\.json$/.test(p)); } catch(e){}
  const pres = {};   // per-advisor presence: unsubmitted-draft count + last-active stamp (drafts stay hidden until Submit)
  await Promise.all(advFilePaths.map(async p => {
    const m = p.match(/^advisor\/([^/]+)\/(.+)\.json$/); const id = m[1], ch = m[2];
    (filesByAdv[id] = filesByAdv[id] || []).push(p);
    try { const r = await getJson(t, p);
      const drafts = (r.json?.comments||[]).filter(c => c.status==='open').length;
      pres[id] = { drafts: (pres[id]?.drafts||0) + drafts, lastActive: [pres[id]?.lastActive, r.json?.last_active].filter(Boolean).sort().pop() };
      inbox[id] = inbox[id] || [];   // an advisor with only drafts still shows up (with their presence)
      (r.json?.comments||[]).forEach(c => { if (c.status!=='open') inbox[id].push({ chapter:ch, c }); }); } catch(e){}
  }));
  const idLabel = id => ADVISOR_NAME[id] || (/^general-/.test(id) ? (inbox[id]?.[0]?.c.author || 'Lab reviewer') : (rel[id]?.name || id));
  // inbox sections: named advisors first, then per-person lab reviewers
  const inboxIds = Object.keys(inbox).sort((a,b) => (/^general-/.test(a)?1:0) - (/^general-/.test(b)?1:0) || idLabel(a).localeCompare(idLabel(b)));
  const rows = CHAPTERS.map(c => `<tr><td>${c.n}. ${escapeHtml(shortTitle(c.title))}</td>${advs.map(a => `<td style="text-align:center"><input type="checkbox" data-a="${a}" data-ch="${c.id}" ${(rel[a].released||[]).includes(c.id)?'checked':''}></td>`).join('')}</tr>`).join('');
  const unreadOf = a => (inbox[a]||[]).filter(({c}) => !c.read && c.status==='submitted').length;
  const advHeadHtml = a => { const unread = unreadOf(a); const pr = pres[a]||{};
    const active = pr.lastActive ? (Date.now()-new Date(pr.lastActive).getTime())/1000 < 120 : false;
    const presence = (pr.drafts>0 || pr.lastActive)
      ? `<span class="chip" title="When this reviewer was last active" style="background:${active?'var(--success-bg)':'var(--bg-3)'};color:${active?'var(--success)':'var(--text-3)'}">${active?'<i class="ti ti-pencil" style="font-size:11px;margin-right:3px"></i>active now':`active ${relTime(pr.lastActive)}`}</span> `
      : '';
    return `${presence}${unread?`<span class="chip" style="background:var(--warn-bg);color:var(--warn)">${unread} unread</span> <button class="btn rel-readall" data-a="${a}" style="padding:2px 9px;font-size:11.5px"><i class="ti ti-checks"></i>Mark all read</button>`:`<span class="chip" style="background:var(--success-bg);color:var(--success)"><i class="ti ti-check" style="font-size:12px"></i> all read</span>`}`; };
  const cmtRow = (a, chapter, c) => `<div class="rel-row${c.read?' is-read':''}" data-a="${a}" data-ch="${chapter}" data-cid="${c.id}" data-q="${escapeHtml((c.anchor?.quote||'').slice(0,60))}">
      <label class="rel-read"><input type="checkbox" class="rel-readbox" ${c.read?'checked':''}></label>
      <div class="rel-row-main">
        <div class="rel-row-h">${escapeHtml(chMeta(chapter).n+'')}. ${escapeHtml(shortTitle(chMeta(chapter).title))} · ${escapeHtml(c.anchor?.section||'')}${c.created_ts?` · ${fmtDate(c.created_ts)}`:''}${c.sent?'<span class="chip" style="background:var(--info-bg);color:var(--info)">sent</span>':c.resolution?'<span class="chip" style="background:var(--success-bg);color:var(--success)">resolved</span>':c.status==='submitted'?'<span class="chip" style="background:var(--success-bg);color:var(--success)">submitted</span>':''}${c.reopened?'<span class="chip" style="background:var(--warn-bg);color:var(--warn)">re-opened</span>':''}</div>
        <div class="rel-row-q">"${escapeHtml((c.anchor?.quote||'').slice(0,64))}" — ${escapeHtml((c.body||'').slice(0,64))}</div>
      </div>
      <button class="btn rel-open"><i class="ti ti-arrow-right"></i>Open in context</button></div>`;
  const inboxHtml = (inboxIds.length ? inboxIds : []).map(a => {
    const items = inbox[a]||[]; const unread = unreadOf(a);
    return `<div class="rel-inbox" data-adv="${a}"><div class="rel-inbox-h"><b>${escapeHtml(idLabel(a))}</b>${/^general-/.test(a)?'<span class="chip" style="margin-left:5px">lab</span>':''}<span class="chip" style="background:var(--accent-bg);color:var(--accent)">${items.length} comment${items.length!==1?'s':''}</span>
        <span class="rel-unread" style="margin-left:auto">${advHeadHtml(a)}</span>
        <button class="btn rel-sendall" data-a="${a}" style="padding:2px 9px;font-size:11.5px;margin-left:6px" ${unread?'disabled title="Read every comment from this reviewer first"':''}><i class="ti ti-send"></i>Send unsent</button>
        <button class="rel-del" data-a="${a}" data-count="${items.length}" title="Remove this reviewer's comments from your inbox" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:none;background:none;color:var(--text-3);cursor:pointer;font-size:13px;margin-left:2px;opacity:0;transition:opacity .12s"><i class="ti ti-trash"></i></button></div>
        <div style="font-size:11.5px;color:var(--text-3);margin:-1px 0 8px">Reply, suggest edits, and send to Claude from the comment itself — click <b>Open in context</b>.</div>${
      items.length ? items.map(({chapter, c}) => cmtRow(a, chapter, c)).join('') : `<div style="font-size:12.5px;color:var(--text-3);padding:6px 2px">No comments submitted yet.</div>` }</div>`;
  }).join('');
  document.getElementById('rel-body').innerHTML = `
    <div class="rel-sec">Advisors</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Add a reviewer to create their portal and (with an email) send them an invite with their link + access key. The access key can read released chapters and write only review comments — keep it private.</div>
    <div class="advadd" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:center;margin-bottom:12px">
      <input id="adv-name" placeholder="Full name" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <input id="adv-email" type="email" placeholder="Email (to send the invite)" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <input id="adv-title" placeholder="Title (optional)" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <button class="btn btn-primary" id="adv-add"><i class="ti ti-user-plus"></i>Add</button>
    </div>
    <div id="adv-list"></div>
    <div id="adv-stat" style="font-size:12px;color:var(--text-3);margin:6px 0 18px"></div>
    <div class="rel-sec">Which chapters each advisor can see</div>
    <table class="rel-tbl"><thead><tr><th>Chapter</th>${advs.map(a => `<th>${escapeHtml(a)}<div style="font-weight:400;font-size:10px;color:var(--text-3)">${escapeHtml(rel[a].name||a)}</div></th>`).join('')}</tr></thead><tbody>${rows}<tr style="border-top:2px solid var(--border-2)"><td>Release responses<div style="font-weight:400;font-size:10px;color:var(--text-3)">let them see how you addressed their comments</div></td>${advs.map(a => `<td style="text-align:center"><input type="checkbox" data-resp="${a}" ${rel[a].responses_released?'checked':''}></td>`).join('')}</tr></tbody></table>
    <div style="display:flex;gap:8px;margin:14px 0 6px;align-items:center"><button class="btn btn-primary" id="rel-save">Save &amp; publish</button><span id="rel-stat" style="font-size:12px;color:var(--text-3)"></span></div>
    <div class="rel-links">${advs.map(a => {
        // Legacy committee members have dedicated pages; the shared lab pool uses review-lab.html;
        // everyone added through the Advisors feature uses the generic advisor.html?a=<id> portal.
        const url = a === 'general' ? base + 'review-lab.html'
          : (a === 'CJS' || a === 'CCS') ? base + a + '.html'
          : advisorUrl(a, rel[a].name);
        return `<div><b>${escapeHtml(rel[a].name||a)}</b> → <code>${escapeHtml(url)}</code></div>`;
      }).join('')}</div>
    <div class="rel-sec" style="margin-top:26px">Comments received from advisors</div>${inboxHtml}
    <div class="rel-sec" style="margin-top:34px;padding-top:10px;border-top:1px solid var(--border)"><i class="ti ti-settings" style="margin-right:6px"></i>Settings</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Email, notifications, and access — how the reviewer system is configured, separate from managing reviewers. (Will move to its own page.)</div>
    <div id="adv-email-banner"></div>
    <div style="display:flex;align-items:center;gap:8px;margin:0 0 12px">
      <label style="font-size:12.5px;color:var(--text-2);white-space:nowrap">Notify me at</label>
      <input id="notify-email" type="email" placeholder="you@example.com (twice-daily digest of advisor activity)"
        style="flex:1;font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <button class="btn" id="notify-save" style="padding:6px 12px">Save</button>
      <span id="notify-stat" style="font-size:11.5px;color:var(--text-3)"></span>
    </div>`;
  const refresh = () => openReleasePanel();
  // panel is overview-only: read-gate + batch send + open-in-context. All in-place (no full re-fetch).
  const syncAdvHeader = a => {
    const box = document.querySelector(`.rel-inbox[data-adv="${a}"]`); if (!box) return;
    const unread = unreadOf(a);
    box.querySelector('.rel-unread').innerHTML = advHeadHtml(a);
    const send = box.querySelector('.rel-sendall'); send.disabled = unread > 0; send.title = unread > 0 ? 'Read every comment from this reviewer first' : '';
    wireHeader(box, a);
  };
  function wireHeader(box, a){
    const ra = box.querySelector('.rel-readall'); if (ra) ra.onclick = async () => {
      ra.disabled = true; ra.textContent = 'Marking…';
      try { for (const {chapter, c} of (inbox[a]||[])) if (!c.read){ await markAdvisorRead(a, chapter, c.id); c.read = true; }
        box.querySelectorAll('.rel-row').forEach(r => { r.classList.add('is-read'); const cb = r.querySelector('.rel-readbox'); if (cb) cb.checked = true; }); syncAdvHeader(a); }
      catch(e){ ra.textContent = 'Failed'; }
    };
    const sa = box.querySelector('.rel-sendall'); sa.onclick = async () => {
      const todo = (inbox[a]||[]).filter(({c}) => c.read && !c.sent && c.status==='submitted');
      if (!todo.length){ sa.textContent = 'Nothing to send'; return; }
      if (!confirm(`Send ${todo.length} comment${todo.length!==1?'s':''} from ${idLabel(a)} to Claude?`)) return;
      sa.disabled = true; sa.textContent = 'Sending…';
      try { for (const {chapter, c} of todo){ await sendAdvisorToClaude(a, chapter, c); c.sent = true; } refresh(); }
      catch(e){ sa.textContent = 'Failed: ' + e.message; }
    };
  }
  // Clear a reviewer from the inbox: deletes only their comment files (advisor/<id>/*.json).
  // Independent of the advisor list — advisors.json / release.json are untouched, so the person
  // stays on your roster and their portal keeps working; this only wipes the received comments.
  const clearAdvisorInbox = async (a) => {
    const files = filesByAdv[a] || [];
    const n = (inbox[a]||[]).length;
    const label = idLabel(a);
    const msg = n
      ? `Delete all ${n} comment${n!==1?'s':''} from ${label}? This removes them from your inbox permanently (recoverable only from the data repo's git history). The reviewer stays on your list and can still comment again later.`
      : `Remove ${label} from your inbox? They have no submitted comments — this just clears the leftover entry. The reviewer stays on your list.`;
    if (!confirm(msg)) return;
    const box = document.querySelector(`.rel-inbox[data-adv="${a}"]`);
    const btn = box?.querySelector('.rel-del'); if (btn){ btn.style.opacity = '.85'; btn.innerHTML = '<i class="ti ti-loader"></i>'; }
    try {
      for (const p of files) await deleteFile(t, p, `inbox: clear ${label}'s comments (${p})`);
      flash(`Cleared ${label} from your inbox.`);
      refresh();
    } catch(e){ flash('Failed: ' + e.message); if (btn){ btn.innerHTML = '<i class="ti ti-trash"></i>'; } }
  };
  document.querySelectorAll('.rel-inbox').forEach(box => {
    wireHeader(box, box.dataset.adv);
    const del = box.querySelector('.rel-del');
    if (del){
      box.addEventListener('mouseenter', () => del.style.opacity = '.85');
      box.addEventListener('mouseleave', () => del.style.opacity = '0');
      del.onclick = () => clearAdvisorInbox(box.dataset.adv);
    }
  });
  document.querySelectorAll('.rel-row').forEach(el => {
    const a = el.dataset.a, ch = el.dataset.ch, cid = el.dataset.cid;
    el.querySelector('.rel-open').onclick = () => {
      if (ch === '__outline__'){ loadOwnerOutline(); return; }   // outline comments open the outline view, not a chapter
      enterChapter(ch);
      jumpWhenReady({ id: cid, anchor: { quote: el.dataset.q, section: el.dataset.sec || '' } });
    };
    el.querySelector('.rel-readbox').onchange = async e => {
      const v = e.target.checked; const item = (inbox[a]||[]).find(x => x.c.id === cid);
      try { await markAdvisorRead(a, ch, cid, v); if (item) item.c.read = v; el.classList.toggle('is-read', v); syncAdvHeader(a); }
      catch(err){ alert('Failed: ' + err.message); e.target.checked = !v; }
    };
  });
  // true only once the invite workflow has confirmed working SMTP creds (it writes email_configured).
  // Until then we must NOT imply an email was sent — we tell the owner plainly and show how to fix it.
  const emailConfigured = () => advReg.email_configured === true;
  const renderEmailBanner = () => {
    const box = document.getElementById('adv-email-banner'); if (!box) return;
    if (emailConfigured()){
      // Keep a way back in — the owner can switch providers or re-test at any time.
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3);border:.5px solid var(--border);border-radius:8px;padding:8px 11px;margin-bottom:12px">
        <i class="ti ti-circle-check" style="color:var(--success)"></i> Email invites are set up.
        <button id="adv-email-test" class="btn" style="padding:3px 10px;font-size:11px;margin-left:auto"><i class="ti ti-send"></i>Send test email</button>
        <button id="adv-email-change" class="btn" style="padding:3px 10px;font-size:11px">Change email / re-test</button></div>`;
      const cb = document.getElementById('adv-email-change'); if (cb) cb.onclick = openConnectForm;
      const tb = document.getElementById('adv-email-test'); if (tb) tb.onclick = openTestSend;
      return;
    }
    const dataRepo = 'mattlmccoy/dissertation-tracker-data';   // where the invite workflow + secrets live
    box.innerHTML = `
      <div style="border:.5px solid var(--warn);background:var(--warn-bg);border-radius:9px;padding:11px 13px;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <i class="ti ti-alert-triangle" style="color:var(--warn);font-size:15px;margin-top:1px"></i>
          <div style="font-size:12.5px;line-height:1.5;color:var(--text)">
            <b>Email invites aren't set up yet.</b> You can still add advisors and open their portals — but no invite email is sent automatically. Connect email once and future invites go out on their own; until then, copy each advisor's portal link and send it yourself.
            <div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap">
              <button id="adv-email-connect" class="btn btn-primary" style="padding:4px 11px;font-size:11.5px"><i class="ti ti-plug"></i>Connect email</button>
              <button id="adv-email-toggle" class="btn" style="padding:4px 10px;font-size:11.5px"><i class="ti ti-book"></i>Set it up manually</button>
            </div>
          </div>
        </div>
        <div id="adv-email-guide" style="display:none;margin:11px 0 2px;padding-top:11px;border-top:.5px solid var(--warn);font-size:12px;line-height:1.6;color:var(--text-2)">
          <div style="font-weight:600;color:var(--text);margin-bottom:5px">One-time setup — you don't have to use Gmail</div>
          Invites are sent by a GitHub Action in your data repo (<code>${dataRepo}</code>), using any SMTP mail server. Pick whichever you like:
          <ul style="margin:7px 0 7px 16px;padding:0">
            <li><b>Institutional / work email</b> — ask IT for the SMTP host, port, and whether an app password is needed (e.g. Georgia Tech, Outlook/Office 365: <code>smtp.office365.com</code> port <code>587</code>).</li>
            <li><b>Gmail</b> — turn on 2-Step Verification, then create an <i>App Password</i> (Google Account → Security → App passwords). Host <code>smtp.gmail.com</code>, port <code>465</code>. Note: some Google Workspace accounts (incl. some GT accounts) disable app passwords — use a transactional service or institutional SMTP instead.</li>
            <li><b>Transactional service</b> (no personal inbox needed) — Resend, SendGrid, Mailgun, Postmark. They give you an SMTP host, port, username, and key.</li>
          </ul>
          <div style="font-weight:600;color:var(--text);margin:8px 0 4px">Add these in the data repo</div>
          <div style="margin-bottom:3px">Settings → Secrets and variables → Actions, in <code>${dataRepo}</code>:</div>
          <div style="font-size:11.5px;margin-left:2px">
            <b>Secrets</b> — <code>SMTP_USER</code> (login / from-address), <code>SMTP_PASS</code> (password, app password, or API key), <code>ADVISOR_KEY</code> (the access key advisors paste). Optional: <code>SMTP_HOST</code>, <code>SMTP_PORT</code> (default Gmail <code>smtp.gmail.com</code>:<code>465</code>), <code>SMTP_FROM_NAME</code>.<br>
            <b>Variables</b> — <code>AUTHOR_NAME</code> (shown in the invite), <code>PORTAL_BASE</code> (your site URL, e.g. <code>${portalBase()}</code>).
          </div>
          <div style="margin-top:8px">Or with the GitHub CLI:</div>
          <pre style="background:var(--bg);border:.5px solid var(--border);border-radius:7px;padding:8px 10px;margin:5px 0;font-size:11px;overflow-x:auto;white-space:pre">gh secret set SMTP_USER --repo ${dataRepo}
gh secret set SMTP_PASS --repo ${dataRepo}
gh secret set ADVISOR_KEY --repo ${dataRepo}
# optional non-Gmail server:
gh secret set SMTP_HOST --repo ${dataRepo}    # e.g. smtp.office365.com
gh secret set SMTP_PORT --repo ${dataRepo}    # e.g. 587
gh variable set AUTHOR_NAME --repo ${dataRepo}
gh variable set PORTAL_BASE --repo ${dataRepo}</pre>
          Once set, add an advisor (or hit <b>Resend</b>) — the invite goes out and this notice clears.
        </div>
      </div>`;
    const tg = document.getElementById('adv-email-toggle');
    if (tg) tg.onclick = () => { const g = document.getElementById('adv-email-guide'); if (g) g.style.display = g.style.display === 'none' ? 'block' : 'none'; };
    const cbtn = document.getElementById('adv-email-connect');
    if (cbtn) cbtn.onclick = openConnectForm;
  };
  // Direct "send a test email" — writes email_test_request.json to the data repo using the owner's
  // already-stored token (Contents:write). That push triggers the invite workflow, which sends the
  // test and deletes the request file. No workflow-scoped token needed.
  function openTestSend(){
    const box = document.getElementById('adv-email-banner'); if (!box) return;
    box.innerHTML = `
      <div style="border:.5px solid var(--border);border-radius:9px;padding:12px 13px;margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px"><i class="ti ti-send" style="margin-right:5px"></i>Send a test email</div>
        <div style="display:grid;gap:8px">
          <input id="ts-to" type="email" placeholder="Recipient email" style="${inputCss}">
          <div style="display:flex;gap:8px;align-items:center">
            <button id="ts-send" class="btn btn-primary" style="padding:5px 13px;font-size:12px">Send test</button>
            <button id="ts-cancel" class="btn" style="padding:5px 11px;font-size:12px">Cancel</button>
            <span id="ts-stat" style="font-size:11.5px;color:var(--text-3)"></span>
          </div>
          <div style="font-size:11px;color:var(--text-3)">Uses your saved access — no extra token needed.</div>
        </div>
      </div>`;
    document.getElementById('ts-cancel').onclick = renderEmailBanner;
    document.getElementById('ts-send').onclick = async () => {
      const to = (document.getElementById('ts-to').value || '').trim();
      const stat = document.getElementById('ts-stat');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ stat.textContent = 'Enter a valid recipient email.'; return; }
      const sendBtn = document.getElementById('ts-send'); sendBtn.disabled = true;
      try {
        stat.textContent = 'Requesting a test send…';
        let beforeTs = '';
        try { const { json } = await getJson(tok(), 'advisors.json'); beforeTs = json?.email_test?.ts || ''; } catch(e){}
        await putJson(tok(), 'email_test_request.json', { to, ts: new Date().toISOString() }, undefined, 'email: request test send to ' + to);
        stat.textContent = 'Sending… the mail workflow is running (up to ~1 min).';
        const deadline = Date.now() + 120000; let et = null;
        while (Date.now() < deadline){
          await new Promise(r => setTimeout(r, 5000));
          try { const { json } = await getJson(tok(), 'advisors.json'); const e = json?.email_test;
            if (e && e.ts && e.ts !== beforeTs){ et = e; break; } } catch(err){}
        }
        if (et && et.ok){ flash('✅ Test email sent to ' + to); renderEmailBanner(); }
        else if (et && !et.ok){ stat.innerHTML = 'Test failed: <code>' + escapeHtml(et.error || 'unknown') + '</code>'; sendBtn.disabled = false; }
        else { stat.textContent = 'Requested, but no result yet — give it a minute and check your inbox / Spam.'; sendBtn.disabled = false; }
      } catch(e){ stat.textContent = 'Failed: ' + e.message; sendBtn.disabled = false; }
    };
  }
  const inputCss = 'width:100%;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)';
  // ---- Connect email: write SMTP secrets to the data repo + real test send (owner-only) ----
  // TOKEN_URL: pre-scoped classic token so the owner just clicks Generate (repo→secrets, workflow→dispatch).
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Dissertation%20reviewer%20email%20setup';
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  // The elevated token must do THREE things: write secrets (getPublicKey), and read+dispatch Actions
  // (latestRun proxies Actions access). Checking only secrets let a Secrets-but-not-Actions token
  // through, then latestRun 403'd ("Failed: runs 403"). Returns the public key when fully capable,
  // null when a permission is missing, and rethrows genuine/transient errors.
  const checkAccess = async (token) => {
    let pk;
    try { pk = await getPublicKey(token); } catch(e){ if (isScopeError(e)) return null; throw e; }
    try { await latestRun(token); }        catch(e){ if (isScopeError(e)) return null; throw e; }
    return pk;
  };
  // Stepped Connect-email wizard: one decision per screen, provider first, with the exact "get your
  // key" instructions + link shown right where they're needed. State lives in S and every input writes
  // to it, so re-rendering a step never loses what was typed.
  const openConnectForm = () => {
    const box = document.getElementById('adv-email-banner'); if (!box) return;
    const S = { step:'provider', provider:'', user:'', from:'', pass:'', host:'', port:'', name:'', testTo:'', ghtoken:'', advkey:'',
                needToken:false, savedPk:null };
    const $ = id => document.getElementById(id);
    const seq = () => ['provider', 'key', ...(S.needToken ? ['token'] : []), 'test'];
    const at = () => Math.max(0, seq().indexOf(S.step));

    // background: prefill name/test-recipient, and learn whether the saved login can save settings.
    withTimeout(prefillFromGitHub(tok()), 8000).then(pf => {
      if (!S.name) S.name = pf.name || '';
      if (!S.testTo) S.testTo = pf.email || '';
      if (S.step === 'test' || S.step === 'provider') render();
    }).catch(() => {});
    S.probe = withTimeout(checkAccess(tok()), 9000)
      .then(pk => { S.savedPk = pk; S.needToken = !pk; return pk; })
      .catch(() => { S.needToken = true; return null; });

    const frame = (title, inner, footer) => `
      <div style="border:.5px solid var(--border);border-radius:9px;padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
          <div style="font-weight:600;font-size:13px"><i class="ti ti-plug"></i> ${title}</div>
          <div style="font-size:11px;color:var(--text-3)">Step ${at() + 1} of ${seq().length}</div>
        </div>
        ${inner}
        <div id="ce-stat" style="font-size:12px;color:var(--text-3);min-height:16px;margin-top:10px"></div>
        <div style="display:flex;gap:8px;margin-top:8px">${footer}</div>`+`</div>`;
    const backBtn = `<button id="ce-back" class="btn" style="padding:5px 12px;font-size:12px">Back</button>`;
    const cancelBtn = `<button id="ce-cancel" class="btn" style="padding:5px 12px;font-size:12px">Cancel</button>`;
    const nextBtn = `<button id="ce-next" class="btn btn-primary" style="padding:5px 12px;font-size:12px">Next →</button>`;
    const wireCommon = () => { const c = $('ce-cancel'); if (c) c.onclick = () => renderEmailBanner();
      const b = $('ce-back'); if (b) b.onclick = () => { S.step = seq()[Math.max(0, at() - 1)]; render(); }; };

    const render = () => {
      const P = PROVIDERS[S.provider] || {};
      if (S.step === 'provider'){
        const cards = [['gmail','Gmail','Works from any personal Gmail — one App Password, nothing else.'],
                       ['outlook','Outlook / Office 365','Work/school or personal Microsoft accounts.'],
                       ['custom','Other / institutional email','Your university or work SMTP — enter host, port, login, key.'],
                       ['brevo','Brevo (advanced)','Only if you own a domain to authenticate — NOT for @gmail senders.']]
          .map(([id, name, desc]) => `<button class="ce-pick btn" data-id="${id}" style="display:block;width:100%;text-align:left;padding:10px 12px;margin-bottom:7px">
             <div style="font-weight:600;font-size:12.5px">${name}${id === 'gmail' ? ' <span style="color:var(--success)">· recommended</span>' : ''}</div>
             <div style="color:var(--text-3);font-size:11.5px;margin-top:1px">${desc}</div></button>`).join('');
        box.innerHTML = frame('Connect email', `<div style="font-size:12px;color:var(--text-3);margin-bottom:9px">Which email should the invites be sent from? Use an account you already own — most people pick Gmail or their university email.</div>${cards}`, cancelBtn);
        box.querySelectorAll('.ce-pick').forEach(b => b.onclick = () => { S.provider = b.dataset.id; S.step = 'key'; render(); });
        wireCommon();
        return;
      }
      if (S.step === 'key'){
        const howto = (P.howto || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
        const link = P.keyUrl ? `<a href="${P.keyUrl}" target="_blank" rel="noopener" class="btn" style="padding:5px 11px;font-size:11.5px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin:2px 0 10px"><i class="ti ti-external-link"></i>${escapeHtml(P.keyLabel || 'Open provider')}</a>` : '';
        const customHostPort = S.provider === 'custom' ? `
          <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:9px">
            <label style="font-size:12px">SMTP host<input id="ce-host" value="${escapeHtml(S.host)}" placeholder="smtp.yourprovider.com" style="${inputCss}"></label>
            <label style="font-size:12px">Port<input id="ce-port" value="${escapeHtml(S.port || '587')}" style="${inputCss}"></label>
          </div>` : '';
        // Brevo's SMTP login differs from the From address, so show two fields; others use one.
        const loginBlock = P.separateLogin ? `
           <label style="font-size:12px">SMTP login (username)<div style="font-size:11px;color:var(--text-3);font-weight:400;margin:2px 0 3px">${escapeHtml(P.loginHint || '')}</div>
             <input id="ce-user" value="${escapeHtml(S.user)}" placeholder="12345@smtp-brevo.com" style="${inputCss};margin-bottom:9px"></label>
           <label style="font-size:12px">From address advisors will see<div style="font-size:11px;color:var(--text-3);font-weight:400;margin:2px 0 3px">Your real, verified sender email (add it under Senders in Brevo).</div>
             <input id="ce-from" type="email" value="${escapeHtml(S.from)}" placeholder="you@university.edu" style="${inputCss};margin-bottom:9px"></label>`
          : `<label style="font-size:12px">Sending email address<input id="ce-user" type="email" value="${escapeHtml(S.user)}" placeholder="you@example.com" style="${inputCss};margin-bottom:9px"></label>`;
        box.innerHTML = frame(`Get your ${escapeHtml(P.secretWord)}`,
          `<div style="font-size:12px;color:var(--text-2);margin-bottom:6px">This is a special key you generate — <b>not</b> your normal email login password.</div>
           <ol style="margin:0 0 9px 17px;padding:0;font-size:12px;line-height:1.65;color:var(--text-2)">${howto}</ol>${link}
           ${loginBlock}
           ${customHostPort}
           <label style="font-size:12px">Paste your ${escapeHtml(P.secretWord)}<input id="ce-pass" type="password" value="${escapeHtml(S.pass)}" placeholder="the ${escapeHtml(P.secretWord)} from the step above" style="${inputCss}"></label>`,
          backBtn + nextBtn + cancelBtn);
        $('ce-user').oninput = e => S.user = e.target.value;
        $('ce-pass').oninput = e => S.pass = e.target.value;
        if (P.separateLogin){ $('ce-from').oninput = e => S.from = e.target.value; }
        if (S.provider === 'custom'){ $('ce-host').oninput = e => S.host = e.target.value; $('ce-port').oninput = e => S.port = e.target.value; }
        $('ce-next').onclick = async () => {
          if (!S.user.trim() || !S.pass){ $('ce-stat').textContent = `Enter your SMTP login and your ${P.secretWord}.`; return; }
          if (P.separateLogin && !S.from.trim()){ $('ce-stat').textContent = 'Enter the From address advisors will see (your verified sender).'; return; }
          if (S.provider === 'custom' && (!S.host.trim() || !(S.port || '').trim())){ $('ce-stat').textContent = 'Enter your SMTP host and port.'; return; }
          $('ce-stat').textContent = 'Checking…'; await S.probe;
          S.step = S.needToken ? 'token' : 'test'; render();
        };
        wireCommon();
        return;
      }
      if (S.step === 'token'){
        // One-click path (only once the GitHub App + relay are provisioned) vs manual-token fallback.
        const oneClick = ghAppConfigured() ? `
          <button id="ce-ghconnect" class="btn btn-primary" style="padding:6px 13px;font-size:12.5px;display:inline-flex;align-items:center;gap:5px"><i class="ti ti-brand-github"></i> Connect with GitHub</button>
          <div id="ce-ghcode" style="font-size:12px;color:var(--text-2);margin-top:8px"></div>
          <div style="font-size:11px;color:var(--text-3);margin:10px 0 6px">or paste a one-time token manually:</div>` : `
          <div style="font-size:12px;line-height:1.6;color:var(--text-2)">To <b>save</b> these settings, GitHub needs a one-time token (used once, never stored). It's separate from your email — your saved login can read your files but can't store settings.</div>
          <ol style="margin:9px 0 9px 17px;padding:0;font-size:12px;line-height:1.65;color:var(--text-2)"><li>Click <b>Generate token</b> below.</li><li>Keep the <b>repo</b> box checked, then create the token.</li><li>Copy it and paste it here.</li></ol>`;
        box.innerHTML = frame('One quick authorization',
          `${oneClick}
           <a href="${TOKEN_URL}" target="_blank" rel="noopener" class="btn" style="padding:5px 11px;font-size:11.5px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:10px"><i class="ti ti-external-link"></i>Generate token</a>
           <input id="ce-ghtoken" type="password" value="${escapeHtml(S.ghtoken)}" placeholder="paste the GitHub token here" style="${inputCss}">`,
          backBtn + nextBtn + cancelBtn);
        $('ce-ghtoken').oninput = e => S.ghtoken = e.target.value;
        $('ce-next').onclick = () => { if (!S.ghtoken.trim()){ $('ce-stat').textContent = 'Paste the token (click Generate token first).'; return; } S.step = 'test'; render(); };
        const gc = $('ce-ghconnect');
        if (gc) gc.onclick = async () => {
          const stat = $('ce-stat');
          try {
            stat.textContent = 'Contacting GitHub…';
            const d = await startDeviceLogin();
            $('ce-ghcode').innerHTML = `Enter this code at GitHub: <b style="font-size:15px;letter-spacing:2px">${escapeHtml(d.user_code)}</b> <button id="ce-ghopen" class="btn" style="padding:3px 9px;font-size:11px">Open GitHub</button>`;
            const open = () => window.open(d.verification_uri, '_blank', 'noopener');
            $('ce-ghopen').onclick = open; open();
            stat.textContent = 'Waiting for you to authorize on GitHub…';
            const token = await pollForToken(d.device_code, d.interval, s => {
              if (s.state === 'slow') stat.textContent = 'Waiting… (GitHub asked us to slow down)';
            });
            localStorage.setItem('ghpat', token); localStorage.setItem('ghauth', 'app');
            stat.textContent = 'Connected — checking access…';
            const pk = await checkAccess(token).catch(() => null);
            if (pk){ S.needToken = false; S.savedPk = pk; S.step = 'test'; render(); }
            else stat.innerHTML = 'Connected, but the app can\'t reach your data repo yet — make sure the GitHub App is <b>installed on your data repo</b>, then try again.';
          } catch(e){ stat.textContent = 'GitHub connect failed: ' + e.message + ' — you can paste a token instead.'; }
        };
        wireCommon();
        return;
      }
      // test step
      box.innerHTML = frame('Send a test to confirm',
        `<div style="font-size:12px;color:var(--text-3);margin-bottom:9px">We'll send one real email to make sure it works. After that, invites go out automatically.</div>
         <label style="font-size:12px">Your name (shown in the invite)<input id="ce-name" value="${escapeHtml(S.name)}" style="${inputCss};margin-bottom:9px"></label>
         <label style="font-size:12px">Send the test to<input id="ce-test" type="email" value="${escapeHtml(S.testTo)}" placeholder="your@email.com" style="${inputCss};margin-bottom:9px"></label>
         <div style="border-top:.5px solid var(--border);margin-top:2px;padding-top:9px">
           <label style="font-size:12px">Advisor access key <span style="color:var(--text-3);font-weight:400">(the token advisors paste to read chapters + comment)</span>
             <div style="font-size:11px;color:var(--text-3);font-weight:400;margin:3px 0 4px;line-height:1.5">Use a <b>least-privilege</b> GitHub token — <b>not</b> your account password/PAT (it gets emailed to every advisor). Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> with access to <b>only</b> <code>dissertation-tracker-data</code> and <b>Contents: Read and write</b>. Leave blank to keep the current one.</div>
             <input id="ce-advkey" type="password" value="${escapeHtml(S.advkey)}" placeholder="paste the advisor access token (or leave blank)" style="${inputCss}"></label>
         </div>`,
        backBtn + `<button id="ce-go" class="btn btn-primary" style="padding:5px 12px;font-size:12px"><i class="ti ti-send"></i> Connect &amp; send test</button>` + cancelBtn);
      $('ce-name').oninput = e => S.name = e.target.value;
      $('ce-test').oninput = e => S.testTo = e.target.value;
      $('ce-advkey').oninput = e => S.advkey = e.target.value;
      $('ce-go').onclick = () => runConnect(S, $('ce-stat'));
      wireCommon();
    };
    render();
  };
  // Turn an SMTP error into an actionable, provider-specific hint. "Login denied"/535/auth means the
  // username or key was rejected — the #1 cause is using the account password instead of the app key.
  const authHint = (provider, err) => {
    const e = err || '';
    // Brevo IP allowlisting blocks CI's changing IPs — the credentials are fine, the IP is rejected.
    if (/unauthorized ip|525|5\.7\.1/i.test(e)){
      return 'Your email server is blocking the sending server\'s IP. In <b>Brevo → Settings → Security → Authorised IPs</b>, remove the IP restriction (allow any IP) — GitHub\'s servers use changing IPs. Or switch to <b>Gmail</b>, which has no IP restriction.';
    }
    const isAuth = /login denied|535|5\.7\.0|authenticat|credential|\(67\)/i.test(e);
    if (!isAuth) return 'Go Back, fix the setting, and try again.';
    switch (provider){
      case 'brevo':   return 'The server rejected your login. In Brevo → <b>SMTP &amp; API → SMTP</b>: the password must be the <b>SMTP key</b> (not your account password), and the sending address must be the <b>Login</b> shown on that page (your Brevo account email). Also make sure your Brevo account is activated for sending.';
      case 'gmail':   return 'Gmail rejected the login. The password must be a 16-char <b>App Password</b> (not your normal Google password), and 2-Step Verification must be ON.';
      case 'outlook': return 'The server rejected the login. Use an <b>app password</b> (not your normal password); work/school accounts create it in your IT security portal.';
      default:        return 'The server rejected the username/password — double-check both (the password should be your provider\'s app password / API key, not your login).';
    }
  };
  // Do the actual work from the wizard's collected state: verify token can write secrets AND run
  // Actions, write the secrets/vars, fire a real test send, and report the true outcome.
  const runConnect = async (S, stat) => {
    const P = PROVIDERS[S.provider] || {};
    const user = (S.user || '').trim(), name = (S.name || '').trim(), testTo = (S.testTo || '').trim();
    // Gmail App Passwords are shown with spaces but must be entered without them — strip all whitespace.
    const pass = S.provider === 'gmail' ? (S.pass || '').replace(/\s+/g, '') : S.pass;
    const host = (S.provider === 'custom' ? S.host : P.host || '').trim();
    const port = String(S.provider === 'custom' ? (S.port || '587') : P.port || '').trim();
    if (!user || !pass){ stat.textContent = 'Missing your sending address or key — go Back.'; return; }
    if (!host || !port){ stat.textContent = 'Missing SMTP host/port — go Back.'; return; }
    if (!testTo){ stat.textContent = 'Enter an address to send the test to.'; return; }
    let etok = S.needToken ? (S.ghtoken || '').trim() : tok();
    if (S.needToken && !etok){ stat.textContent = 'Missing the GitHub token — go Back a step.'; return; }
    stat.textContent = 'Checking access…';
    let pk;
    try { pk = (S.needToken || !S.savedPk) ? await checkAccess(etok) : S.savedPk; }
    catch(e){ stat.textContent = 'Access check failed: ' + e.message; return; }
    if (!pk){ stat.innerHTML = 'That GitHub token is missing <b>Secrets</b> or <b>Actions</b> access — go Back and regenerate it with the <b>repo</b> box ticked.'; return; }
    try {
      stat.textContent = 'Saving credentials…';
      // NOTE: do NOT touch ADVISOR_KEY here — that's the advisors' access token, a separate concern
      // from email. Overwriting it with a random string broke advisor sign-in on every email connect.
      await putSecret(etok, pk, sealToBase64, 'SMTP_USER', user);
      await putSecret(etok, pk, sealToBase64, 'SMTP_PASS', pass);
      await putSecret(etok, pk, sealToBase64, 'SMTP_HOST', host);
      await putSecret(etok, pk, sealToBase64, 'SMTP_PORT', port);
      await putSecret(etok, pk, sealToBase64, 'SMTP_FROM', (S.from || user).trim());   // sender ≠ login for Brevo
      // Advisor access token (emailed to advisors so they can read + comment). Only overwrite when the
      // owner supplied one — a blank field keeps the existing key. This is a separate, least-privilege
      // token, never the owner's account PAT. Not persisted in the browser (lives only in S.advkey).
      if ((S.advkey || '').trim()) await putSecret(etok, pk, sealToBase64, 'ADVISOR_KEY', S.advkey.trim());
      if (name) await putSecret(etok, pk, sealToBase64, 'SMTP_FROM_NAME', name);
      if (name) await setVariable(etok, 'AUTHOR_NAME', name);
      await setVariable(etok, 'PORTAL_BASE', portalBase());
      stat.textContent = 'Sending a test email…';
      const before = (await latestRun(etok))?.id || 0;
      await dispatchInvite(etok, testTo);
      // Poll with etok (the capable token) — the saved login may lack Actions:read, which used to
      // 403 here AFTER a successful dispatch and mislead with "Actions not enabled".
      const deadline = Date.now() + 90000; let run = null;
      while (Date.now() < deadline){
        await new Promise(r => setTimeout(r, 4000));
        run = await latestRun(etok);
        if (run && run.id !== before && run.status === 'completed') break;
      }
      if (!run || run.status !== 'completed'){ stat.innerHTML = 'Saved, but the test run didn\'t finish in time. Check back in a minute and reopen.'; return; }
      const { json } = await getJson(tok(), 'advisors.json').catch(() => ({ json:null }));
      if (json){ advReg.email_configured = json.email_configured; }
      if (run.conclusion === 'success' && json?.email_test?.ok){
        flash('✅ Email connected — test sent.');
        // The mail server ACCEPTED it; the recipient's spam filter may still hold it. Say so plainly
        // (a persistent panel, not a toast) so the owner knows to check spam, not assume failure.
        const box = document.getElementById('adv-email-banner');
        if (box) box.innerHTML = `<div style="border:.5px solid var(--success);border-radius:9px;padding:13px;margin-bottom:12px;font-size:12.5px;line-height:1.55">
            <div style="font-weight:600;color:var(--success);margin-bottom:4px"><i class="ti ti-circle-check"></i> Email connected — invites will send automatically</div>
            The test was sent to <b>${escapeHtml(testTo)}</b>. If it isn't in the inbox within a minute, check <b>Spam/Junk</b> and any quarantine — automated mail often lands there the first time. Mark it “not spam” so future invites arrive normally.
            <div style="margin-top:9px"><button id="ce-done" class="btn" style="padding:4px 11px;font-size:12px">Done</button></div></div>`;
        const d = document.getElementById('ce-done'); if (d) d.onclick = () => renderEmailBanner();
        renderAdvList();
        return;
      } else {
        const err = json?.email_test?.error || ('run concluded: ' + run.conclusion);
        stat.innerHTML = 'Test send failed: <code>' + escapeHtml(err) + '</code><br>' + authHint(S.provider, err);
      }
    } catch(e){
      if (isScopeError(e)) stat.innerHTML = 'Your GitHub token is missing <b>Actions</b> access — go Back and regenerate it with the <b>repo</b> box ticked.';
      else stat.textContent = 'Failed: ' + e.message;
    }
  };
  const renderAdvList = () => {
    renderEmailBanner();
    const box = document.getElementById('adv-list'); if (!box) return;
    if (!advReg.advisors.length){ box.innerHTML = `<div style="font-size:12.5px;color:var(--text-3)">No added advisors yet.</div>`; return; }
    box.innerHTML = advReg.advisors.map(a => {
      const status = a.invited ? `<span class="chip" style="background:var(--success-bg);color:var(--success)">invited${a.invited_ts?` · ${fmtDate(a.invited_ts)}`:''}</span>`
        : a.invite_error ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn)" title="${escapeHtml(a.invite_error)}">invite failed</span>`
        : a.email ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn)">invite pending</span>`
        : `<span class="chip">no email</span>`;
      return `<div class="advrow" data-id="${escapeHtml(a.id)}" style="display:flex;align-items:center;gap:9px;padding:7px 0;border-top:.5px solid var(--border)">
          <div style="min-width:0"><div style="font-size:13px;font-weight:500">${escapeHtml(a.name)}${a.title?` <span style="color:var(--text-3);font-weight:400">· ${escapeHtml(a.title)}</span>`:''}</div>
            <div style="font-size:11.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.email||'')}</div></div>
          <span style="margin-left:auto"></span>${status}
          <button class="btn adv-copy" data-id="${escapeHtml(a.id)}" style="padding:3px 9px;font-size:11.5px"><i class="ti ti-link"></i>Copy link</button>
          ${a.email?`<button class="btn adv-resend" data-id="${escapeHtml(a.id)}" style="padding:3px 9px;font-size:11.5px"><i class="ti ti-mail-forward"></i>Resend</button>`:''}
          <button class="adv-del" data-id="${escapeHtml(a.id)}" title="Remove advisor" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:var(--text-3);font-size:13px;opacity:0;transition:opacity .12s"><i class="ti ti-trash"></i></button></div>`;
    }).join('');
    box.querySelectorAll('.advrow').forEach(row => { row.onmouseenter = () => { const d = row.querySelector('.adv-del'); if (d) d.style.opacity = '.85'; };
      row.onmouseleave = () => { const d = row.querySelector('.adv-del'); if (d) d.style.opacity = '0'; }; });
    box.querySelectorAll('.adv-copy').forEach(b => b.onclick = () => { const a = advReg.advisors.find(x=>x.id===b.dataset.id);
      navigator.clipboard?.writeText(advisorUrl(a.id, a.name)); flash('Portal link copied.'); });
    box.querySelectorAll('.adv-resend').forEach(b => b.onclick = () => resendInvite(b.dataset.id));
    box.querySelectorAll('.adv-del').forEach(b => b.onclick = () => removeAdvisor(b.dataset.id));
  };
  // read-modify-write: always fetch the current advisors.json (fresh sha) before writing, so we
  // never send a stale/missing sha (GitHub 422) and never clobber the invite-status the workflow set.
  const mutateAdvisors = async (fn, msg) => {
    const { json, sha } = await getJson(t, 'advisors.json').catch(() => ({ json:null, sha:null }));
    const reg = json && Array.isArray(json.advisors) ? json : { advisors: [] };
    fn(reg);
    await putJson(t, 'advisors.json', reg, sha, msg);   // sha refetched each call, so no cached advSha to update
    advReg.advisors = reg.advisors;
  };
  const addAdvisor = async () => {
    const name = document.getElementById('adv-name').value.trim();
    const email = document.getElementById('adv-email').value.trim();
    const title = document.getElementById('adv-title').value.trim();
    const stat = document.getElementById('adv-stat');
    if (!name){ stat.textContent = 'Name is required.'; return; }
    const id = `${slugify(name)}-${rand4()}`;
    const entry = { id, name, email, title, added_ts:new Date().toISOString(), invited:false, invited_ts:null, invite_error:null };
    stat.textContent = 'Saving…';
    try {
      await mutateAdvisors(reg => reg.advisors.push(entry), `advisors: add ${name}`);
      const { json:relNow, sha:relSha } = await getJson(t, 'release.json');
      relNow[id] = { name, released: [], responses_released: false };
      await putJson(t, 'release.json', relNow, relSha, `release: register ${name}`);
      const link = `<code>${escapeHtml(advisorUrl(id, name))}</code>`;
      stat.innerHTML = !email
        ? `Added (no email given — share this portal link yourself): ${link}`
        : emailConfigured()
          ? `Added. Invite email will send shortly. Portal: ${link}`
          : `Added, but email sending isn't set up — <b>no invite was sent</b>. Copy this portal link and send it to them, or set up email invites above: ${link}`;
      document.getElementById('adv-name').value = document.getElementById('adv-email').value = document.getElementById('adv-title').value = '';
      renderAdvList();
    } catch(e){ stat.textContent = 'Failed: ' + e.message; }
  };
  const resendInvite = async (id) => {
    try { await mutateAdvisors(reg => { const a = reg.advisors.find(x=>x.id===id); if (a){ a.invited=false; a.invited_ts=null; a.invite_error=null; } }, `advisors: resend invite ${id}`);
      flash(emailConfigured() ? 'Invite re-queued — it will send shortly.' : 'Re-queued, but email isn\'t set up yet — no email will send until you configure it above.'); renderAdvList(); }
    catch(e){ flash('Failed: ' + e.message); }
  };
  // intentionally high-friction: must type the advisor's exact name. Removes them from the list +
  // release gate (their portal stops showing chapters); their already-submitted comments are kept.
  const removeAdvisor = async (id) => {
    const a = advReg.advisors.find(x => x.id === id); if (!a) return;
    const typed = prompt(`Remove ${a.name}?\n\nThis takes them off your advisor list and revokes their chapter access. Comments they already submitted are kept.\n\nTo confirm, type their full name exactly:`);
    if (typed === null) return;
    if (typed.trim() !== a.name.trim()){ flash('Name did not match — advisor not removed.'); return; }
    try {
      await mutateAdvisors(reg => { const i = reg.advisors.findIndex(x=>x.id===id); if (i>=0) reg.advisors.splice(i,1); }, `advisors: remove ${a.name}`);
      try { const { json:relNow, sha:relSha } = await getJson(t, 'release.json');
        if (relNow && relNow[id]){ delete relNow[id]; await putJson(t, 'release.json', relNow, relSha, `release: remove ${a.name}`); } } catch(e){}
      flash(`Removed ${a.name}.`); renderAdvList();
    } catch(e){ flash('Failed: ' + e.message); }
  };
  document.getElementById('adv-add').onclick = addAdvisor;
  renderAdvList();
  // Notify-me-at: stored in notify_config.json (data repo) — written with the everyday token,
  // read by the notify workflow. No elevated scope needed (unlike Actions variables).
  (async () => {
    const inp = document.getElementById('notify-email'); if (!inp) return;
    try { const { json } = await getJson(t, 'notify_config.json'); if (json && json.author_email) inp.value = json.author_email; } catch(e){}
    const stat = document.getElementById('notify-stat');
    document.getElementById('notify-save').onclick = async () => {
      const val = inp.value.trim();
      stat.textContent = 'Saving…';
      try {
        const { json, sha } = await getJson(t, 'notify_config.json').catch(() => ({ json:null, sha:null }));
        const cfg = json && typeof json === 'object' ? json : {};
        cfg.author_email = val;
        await putJson(t, 'notify_config.json', cfg, sha, `notify: set author email`);
        stat.textContent = val ? 'Saved — digests will send twice daily.' : 'Cleared — digests off.';
      } catch(e){ stat.textContent = 'Failed: ' + e.message; }
    };
  })();
  document.getElementById('rel-save').onclick = async () => {
    advs.forEach(a => { rel[a].released = [...document.querySelectorAll(`input[data-a="${a}"]:checked`)].map(x => x.dataset.ch);
      rel[a].responses_released = !!document.querySelector(`input[data-resp="${a}"]`)?.checked; });
    const stat = document.getElementById('rel-stat'); stat.textContent = 'Publishing…';
    try { sha = await putJson(t, 'release.json', rel, sha, 'release: update advisor chapter gate'); stat.textContent = 'Published ✓'; }
    catch(e){ stat.textContent = 'Failed: ' + e.message; }
  };
}
// resolution display (shared by the inbox + advisor portal — neutral, reviewer-facing wording)
function resolHtml(c){
  if (!c.resolution) return ''; const r = c.resolution;
  const label = r.state==='addressed'?'Addressed':r.state==='declined'?'Kept as written':'Noted';
  const icon = r.state==='addressed'?'circle-check':r.state==='declined'?'circle-x':'info-circle';
  const diff = (r.before||r.after) ? `<div class="rdiff">${r.before?`<del>${escapeHtml(r.before)}</del>`:''}${r.after?` <ins>${escapeHtml(r.after)}</ins>`:''}</div>` : '';
  return `<div class="resol resol-${r.state||'noted'}"><div class="resol-h"><i class="ti ti-${icon}"></i>${label}${r.ts?` · ${(r.ts||'').slice(0,10)}`:''}</div>${r.note?`<div>${escapeHtml(r.note)}</div>`:''}${diff}</div>`;
}
// write a resolution into an advisor's comment file so it appears on their portal
// mutate one advisor comment in advisor/<id>/<ch>.json (fetch -> apply -> push)
async function _mutateAdvisorComment(advisorId, ch, cid, fn, msg){
  const t = tok(); const path = `advisor/${advisorId}/${ch}.json`;
  // read-modify-write with conflict retry: re-fetch + re-apply on 409 so concurrent
  // edits to the SAME file (e.g. two comments in one chapter) don't clobber each other.
  for (let attempt = 0; attempt < 5; attempt++){
    const { json, sha } = await getJson(t, path);
    if (!json) throw new Error('advisor file not found');
    const c = (json.comments||[]).find(x => x.id === cid); if (!c) throw new Error((json.deleted||[]).includes(cid) ? 'The reviewer withdrew this comment.' : 'comment not found');
    fn(c);
    try { await putJson(t, path, json, sha, msg, false); return; }
    catch(e){ if (String(e.message).includes('409') && attempt < 4){ await new Promise(r => setTimeout(r, 250*(attempt+1))); continue; } throw e; }
  }
}
async function recordResolution(advisorId, ch, cid, resolution){
  await _mutateAdvisorComment(advisorId, ch, cid, c => { c.resolution = resolution; c.read = true; }, `resolution: ${advisorId} ${ch} ${cid}`);
}
// owner decides on a staged edit (approve / reject / revise / clear); conflict-safe write to the chapter review
async function recordDecision(id, decision, note){
  review = setDecision(review, id, decision, note);          // local, immediate
  save(); renderComments(); refreshStaged();
  const t = tok(); if (!t) return;
  for (let attempt = 0; attempt < 5; attempt++){             // conflict-safe: re-fetch, re-apply this decision, push
    const { json, sha } = await getJson(t, reviewPath(current));
    if (!json) return;
    const c = (json.comments||[]).find(x => x.id === id); if (!c) return;
    if (decision){ c.decision = decision; if (note) c.decision_note = note; c.decision_ts = new Date().toISOString(); }
    else { delete c.decision; delete c.decision_note; delete c.decision_ts; }
    try { await putJson(t, reviewPath(current), json, sha, `review: decide ${id} ${decision||'clear'}`, false); return; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } throw e; }
  }
}
async function unqueueComment(id){
  review = updateComment(review, id, { status:'staged' });
  review = setDecision(review, id, null);
  save(); renderComments(); refreshStaged();
  const t = tok(); if (!t) return;
  for (let attempt = 0; attempt < 5; attempt++){
    const { json, sha } = await getJson(t, reviewPath(current)); if (!json) return;
    const c = (json.comments||[]).find(x => x.id === id); if (!c) return;
    c.status = 'staged'; delete c.decision; delete c.decision_note; delete c.decision_ts;
    try { await putJson(t, reviewPath(current), json, sha, `review: unqueue ${id}`, false); return; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } throw e; }
  }
}
// "Request changes" → send the staged edit back to Claude to redo NOW (not a batched decision):
// re-open the comment (drop the staged edit), attach the note, and queue a revision job.
async function requestChanges(id, note){
  const ts = new Date().toISOString();
  const cur = review.comments.find(x => x.id === id);
  const thread = [...((cur && cur.thread) || []), { author:'you', text:note, ts }];
  review = updateComment(review, id, { status:'queued', staged_edit:undefined, decision:undefined, decision_note:undefined, decision_ts:undefined, thread });
  save(); renderComments(); refreshStaged();
  const t = tok(); if (!t){ flash('Saved on this device — add your access token to send it to Claude.'); return; }
  for (let attempt = 0; attempt < 5; attempt++){               // re-open the comment in the review file (conflict-safe)
    const { json, sha } = await getJson(t, reviewPath(current)); if (!json) break;
    const c = (json.comments||[]).find(x => x.id === id); if (!c) break;
    c.status = 'queued'; delete c.staged_edit; delete c.decision; delete c.decision_note; delete c.decision_ts;
    if (!(c.thread||[]).some(m => m.author==='you' && m.text===note)) c.thread = [...(c.thread||[]), { author:'you', text:note, ts }];
    try { await putJson(t, reviewPath(current), json, sha, `review: request changes ${id}`, false); break; }
    catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r=>setTimeout(r,250*(attempt+1))); continue; } throw e; }
  }
  const { json:jj, sha:js } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));   // queue the revision for Claude
  const jobs = Array.isArray(jj) ? jj : [];
  jobs.push({ id:'j_'+Date.now().toString(36), type:'apply-edits', chapter:current, comment_ids:[id], revision:true, revise_note:note, status:'queued', requested_ts:ts });
  await putJson(t, 'jobs.json', jobs, js, `review: revision request ${id}`);
  flash('Change request sent to Claude — it’ll come back as a fresh staged edit.');
}
const markAdvisorRead = (advisorId, ch, cid, val=true) => _mutateAdvisorComment(advisorId, ch, cid, c => { c.read = val; }, `read: ${advisorId} ${ch} ${cid}`);
const replyToAdvisorComment = (advisorId, ch, cid, text) => _mutateAdvisorComment(advisorId, ch, cid, c => { c.thread = [...(c.thread||[]), { author:'author', text, ts:new Date().toISOString() }]; c.read = true; }, `reply: ${advisorId} ${ch} ${cid}`);
const suggestAdvisorEdit = (advisorId, ch, cid, edit) => _mutateAdvisorComment(advisorId, ch, cid, c => { c.edit = edit; c.read = true; }, `suggest: ${advisorId} ${ch} ${cid}`);
// owner-private notes live in reviews/advisor_notes.json (advisor portal never fetches it)
async function loadAdvisorNotes(t){ try { const r = await getJson(t, 'reviews/advisor_notes.json'); return { notes:r.json||{}, sha:r.sha }; } catch(e){ return { notes:{}, sha:null }; } }
async function savePrivateNote(state, cid, text){
  state.notes[cid] = [...(state.notes[cid]||[]), { text, ts:new Date().toISOString() }];
  state.sha = await putJson(tok(), 'reviews/advisor_notes.json', state.notes, state.sha, 'notes: private advisor note');
}
// copy an advisor comment into the owner review + queue an apply-edits job (the existing pipeline)
async function sendAdvisorToClaude(advisorId, ch, c){
  const t = tok();
  const { json, sha } = await getJson(t, `reviews/${ch}.json`).catch(() => ({ json:null, sha:null }));
  let review = json || newReview(ch, '');
  // idempotent: if this advisor comment was already copied in (e.g. the jobs.json PUT failed and we're retrying), reuse it
  let nc = review.comments.find(x => x.from_advisor && x.from_advisor.id === advisorId && x.from_advisor.cid === c.id);
  if (!nc){
    review = addComment(review, { anchor:c.anchor, kind:c.kind, tag:c.edit?'edit':(c.tag||'wording'), body:c.body, edit:c.edit||null });
    nc = review.comments[review.comments.length-1];
    nc.from_advisor = { id:advisorId, cid:c.id, name: ADVISOR_NAME[advisorId] || c.author || advisorId }; nc.status = 'queued';
    await putJson(t, `reviews/${ch}.json`, review, sha, `review: incorporate ${advisorId} comment ${c.id}`);
  }
  const jr = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(jr.json) ? jr.json : [];
  // idempotent: don't double-queue a still-open job for the same advisor comment
  const dup = jobs.find(j => j.from_advisor && j.from_advisor.id === advisorId && j.from_advisor.cid === c.id && j.status !== 'done' && j.status !== 'merged');
  if (!dup){
    jobs.push({ id:'j_'+Date.now().toString(36), type:'apply-edits', chapter:ch, comment_ids:[nc.id], from_advisor:{ id:advisorId, cid:c.id }, status:'queued', requested_ts:new Date().toISOString() });
    await putJson(t, 'jobs.json', jobs, jr.sha, `review: queue advisor comment ${c.id}`);
  }
  await _mutateAdvisorComment(advisorId, ch, c.id, x => { x.sent = true; x.read = true; }, `sent: ${advisorId} ${ch} ${c.id}`);
}
window.addEventListener('keydown', e => {
  const pop = document.getElementById('pop');
  if (pop){
    if (e.key === 'Escape'){ pop.querySelector('#ccancel').click(); return; }
    if ((e.metaKey||e.ctrlKey) && e.key === 'Enter'){ e.preventDefault(); pop._commit(); return; }
    if (e.altKey && e.key >= '1' && e.key <= '5'){ e.preventDefault(); pop._pickTag(+e.key - 1); return; }
    return;
  }
  if ((e.metaKey||e.ctrlKey) && e.key === '\\'){ e.preventDefault(); const s = document.getElementById('search'); if (s && s.value.trim()) globalSearch(s.value); else s?.focus(); return; }
  if ((e.metaKey||e.ctrlKey) && e.key === 'Enter'){ e.preventDefault(); if (document.getElementById('doc')) openSendMenu(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (typing){ if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (!document.getElementById('doc') && !['?','f'].includes(e.key)) return;
  switch (e.key){
    case 'j': e.preventDefault(); cycleComment(1); break;
    case 'k': e.preventDefault(); cycleComment(-1); break;
    case 'f': toggleFocus(); break;
    case '[': toggleNav(); break;
    case ']': toggleRail(); break;
    case '/': e.preventDefault(); document.getElementById('search')?.focus(); break;
    case '?': toggleHelp(); break;
  }
});

// ---------- mobile: comments rail as a bottom sheet ----------
function setupMobileSheet(){
  const back = document.createElement('div'); back.id = 'sheetbackdrop';
  back.onclick = () => document.body.classList.remove('sheet-open');
  const fab = document.createElement('button'); fab.id = 'sheetfab'; fab.innerHTML = '<i class="ti ti-message-circle"></i>';
  fab.onclick = () => document.body.classList.toggle('sheet-open');
  document.body.append(back, fab);
}
// ---------- boot ----------
setupMobileSheet();
document.addEventListener('click', e => { if (e.target.closest('#btn-refresh')) doRefresh(); });   // refresh buttons across every topbar
(() => { const r = sessionStorage.getItem('_resume'); if (r){ sessionStorage.removeItem('_resume'); enterChapter(r); } else enterHome(); })();   // a refresh returns you to where you were
document.addEventListener('mouseover', e => { const c = e.target.closest?.('.chcard'); if (c) c.style.borderColor='var(--border-2)'; });
document.addEventListener('mouseout', e => { const c = e.target.closest?.('.chcard'); if (c) c.style.borderColor='var(--border)'; });

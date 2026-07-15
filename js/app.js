import { newReview, addComment, updateComment, deleteComment, setDecision, partitionByDecision, queueApproved } from './model.js?v=f0898b1';
import { anchorFromSelection } from './anchor.js?v=a2ba4a9';
import { reviewPath, mergeReview, getJson, putJson, ghTree, putFile, getDataUrl, deleteFile } from './gh.js?v=b3b8d59';
import { PROVIDERS, detectProvider, genKey, getPublicKey, putSecret, setVariable, getVariable, dispatchInvite, latestRun, dispatchRender, renderRun, setAiSecrets, dispatchApply, applyRun, cancelRun, applyRunLabel, listSecretNames, claudeConnectionStatus, prefillFromGitHub, isScopeError, checkActionsAccess, permissionFromError } from './ghsecrets.js?v=9f27b8e';
import { ensureRenderPipeline, ensureApplyEngine, ensureInvitePipeline } from './seed.js?v=c823c55';
import { isOverleafLinked } from './overleaf.js?v=5e5b959';   // tokenless B1: recognize an Overleaf-bridge-linked project
import { sealToBase64 } from './vendor/seal.js?v=175ae7b';
import { isConfigured as ghAppConfigured, startDeviceLogin, pollForToken } from './ghauth.js?v=434b300';
import { startTour, tourSeen, markTourSeen } from './tour.js?v=1dde05d';
import { loadConfig, dataRepoParts, loadChapters, dataRepoReadable, loadProjects, resolveProject, setConfig, writeProjectPatch, assistantEnabled, sendMenuActions, dataPath, advisorInviteUrl, sourceLabel, sourceMarkerRepo, resolveSourceInfo } from './config.js?v=98c897b';
import { processingMode, processingModePatch, modeMarker, modePill } from './processingmode.js?v=3407908';
import { parseEvents, groupByComment, groupStream, isTerminal, summaryLine, usageTotals, usageLine, usageCostNote, usageGauge } from './cloudprogress.js?v=770202d';
import { loadAgentCatalog, agentCatalogView, agentCatalogHtml, partitionCatalog, buildAuthorJob, approveAuthored, deleteAuthored, editAuthored, writeAgentsJson, splitAgentsForCloud } from './agentcatalog.js?v=fa6ad90';
import { orderedUnits, mergeReviews, routeWrite, wrapUnit, stripSegmentId } from './wholedoc.js?v=80e01b5';
import { buildRefsSection } from './wholerefs.js?v=4260d4d';   // consolidate scattered per-unit reference lists into one at the end of the whole-doc
import { unitLabel, unitLabelWithTitle } from './unitlabel.js?v=2b788e9';   // "Chapter 3" / "Appendix A" — one label rule for both portals
import { parseLatexChapters, detectUnitLevel, resolveUnitNoun, parseDocTitle, parseLatexOutline, parseDocxChapters, docxToXml } from './docparse.js?v=534763c';
import { importFormat, stagingPath, sourceRepoSuggestion, ensureRepo, repoFileSha, commitSourceFile, commitSourceBinary, pickEntryTex, stripTopFolder, isTextPath } from './importdoc.js?v=14b7d2d';
import { inviteReadiness, healthSignals, reviewerStatus, restoreAdvisorPlan, renderBuiltStatus, emailTestOutcome } from './owneradmin.js?v=aa80e0c';
import { buildWorklist, worklistToMarkdown, worklistToHtml } from './worklist.js?v=cc14030';
import { startWatch as startNetWatch } from './netstatus.js?v=131b82f';
import { settingsSections, resolveSection } from './settings.js?v=621de9a';
import { modalReducer, topModal } from './modal.js?v=aa8d478';
import { showBuildTag } from './buildinfo.js?v=bb62768';
import { readProgress } from './cardstats.js?v=cfa6c99';
import { clusterComments, editComments, clusterHasConflict } from './cluster.js?v=7a3b025';   // group reviewer comments on the same passage + flag/resolve edit conflicts
import { isChecklistDismissed, dismissChecklist, restoreChecklist } from './relchecklist.js?v=551197f';
import { classicTokenUrl, fineGrainedUrl, CREDENTIALS, credentialStatus } from './tokenscopes.js?v=cf28223';
import { repoExplainerHtml } from './repoexplainer.js?v=2903d0f';
import { MODELS as AI_MODELS, DEFAULT_MODEL as AI_DEFAULT_MODEL, INHERIT as AI_INHERIT } from './aimodels.js?v=4259b34';
import { resolveReviewerName } from './reviewername.js?v=ee4ce53';
import { isAiComment, buildAdvisorClaudeJob } from './aicomment.js?v=1a7f4b2';
startNetWatch();
showBuildTag(import.meta.url);
// Load the effective config before the module body evaluates. Two modes:
//  • multi-project: footnote.config.json sets hubRepo → the reviewer opens ONE project via ?project=<id>,
//    resolving its config from the hub's projects.json. No ?project → redirect to the launcher (index.html).
//  • single-project: no hubRepo → footnote.config.json IS the config (backward compatible).
const _appCfg = await loadConfig();
const _projectId = new URLSearchParams(location.search).get('project');
// The workspace (hub) repo can come from footnote.config.json OR the launcher's localStorage override —
// keep both surfaces in sync so opening a project from the launcher resolves correctly.
const _hub = localStorage.getItem('footnote:hub') || _appCfg.hubRepo || '';
let _CFG = { ..._appCfg, hubRepo: _hub };
if (_hub) {
  // A never-resolving await halts this module so the boot IIFE never runs during a redirect (no home flash).
  const _halt = () => new Promise(() => {});
  if (!_projectId) { location.replace('index.html'); await _halt(); }
  else {
    const _projects = await loadProjects({ ..._appCfg, hubRepo: _hub }, localStorage.getItem('ghpat'));
    try { _CFG = resolveProject({ ..._appCfg, hubRepo: _hub }, _projects, _projectId); }
    catch { location.replace('index.html'); await _halt(); }
  }
}
// Make the effective config the one every module reads (gh.js/loadChapters resolve the project's dataRepo).
setConfig(_CFG);
// Document nouns for user-facing copy (default "dissertation"/"chapter"; an adopter sets e.g.
// "thesis"/"section" or "paper"/"part"). Capitalized variants for sentence starts.
const DOC = _CFG.doc.noun;
let UNIT = _CFG.doc.unitNoun;                                 // let: an import can update the unit noun in-session
const DOCC = DOC.charAt(0).toUpperCase() + DOC.slice(1);
let UNITC = UNIT.charAt(0).toUpperCase() + UNIT.slice(1);     // "Chapter"/"Section"/… for visible unit labels
// Optional AI assistant (Send to Claude / run agents) — OFF by default; the deterministic review→stage→
// approve→merge flow is core. Toggled per-user in ⋯ menu (localStorage) or shipped on via reviewAgents.
const ASSIST_KEY = 'footnote:assistant';
const assistantOn = () => assistantEnabled(_CFG, localStorage.getItem(ASSIST_KEY));
// Prefix a data-repo path for this project ('' legacy → passthrough; '<id>/' in the consolidated workspace).
const dpath = p => dataPath(_CFG, p);

// Guided owner tour — points only at elements that are reliably present on the home view, so nothing
// is mis-highlighted. The engine skips any step whose element is absent.
const OWNER_TOUR = [
  { sel:'#btn-settings-h', title:'Settings & your access token', body:'Your GitHub token — which lets Footnote read your private data — now lives here in Settings, along with email and notifications.' },
  { sel:'.chcard', title:`Your ${UNIT}s`, body:`Each card opens a ${UNIT} to read and to work through your reviewers' comments. The bar shows how far along you are.` },
  { sel:'#inbox-panel', title:'Needs you', body:`Your triage center. Across every ${UNIT} it gathers comments waiting on you, edits staged to approve, and finished jobs. Click any count to jump straight there.` },
  { sel:'#btn-releases', title:`Invite reviewers and release ${UNIT}s`, body:`Add reviewers, connect email so invites send on their own, and choose which ${UNIT}s each reviewer can see.` },
  { sel:'#btn-outline', title:'Share your outline early', body:`Post your planned structure so reviewers can comment on it before the full ${UNIT}s are ready.` },
  { sel:'#btn-export-menu', title:'Export your review work', body:'When you\'re ready, take your reviewers\' comments to Overleaf as an edit worklist, or generate a point-by-point response letter.' },
  { sel:'#dl-export-all', title:'Export the document', body:`Download the whole ${DOC}, or any single ${UNIT}, as Word or Markdown with comments and tracked changes included.` },
  { sel:'#btn-tour', title:'Replay anytime', body:`Reopen this tour or turn auto-show off from here. Open any ${UNIT}, then use the More menu for the reviewing walkthrough.` },
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
    <div class="mmi" data-a="chapter"><i class="ti ti-book-2"></i>Reviewing a ${UNIT} (demo)</div>
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
      <h1>Sample ${UNIT} (tour preview)</h1>
      <p id="tour-demo-select">This preview ${UNIT} shows how reviewing works. Lorem ipsum dolor sit amet, consectetur adipiscing elit; <mark class="cmark" data-aid="demo-adv">radio-frequency heating enables rapid, volumetric energy delivery</mark> through a dielectric medium. Select any words here to attach a comment.</p>
      <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Ut enim ad minim veniam, <del class="tc-stage">quis nostrud exercitation ullamco laboris</del><ins class="tc-stage"> clearer, simpler wording</ins> nisi.</p>
      <figure><img alt="Sample figure" src="${fig}"><figcaption>Figure 3.1. A sample figure. Click it to comment on the figure itself.</figcaption></figure>
      <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
      <table><caption>Table 3.1. Sample results.</caption><thead><tr><th>Case</th><th>Value</th></tr></thead>
        <tbody><tr><td>Baseline</td><td>12.4</td></tr><tr><td>Compensated</td><td>4.1</td></tr></tbody></table>
      <p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam.</p></article>`;
  cmt.innerHTML = `<div class="lbl">COMMENTS<span style="margin-left:auto">1 · 0 open</span></div>
    ${sugCard}
    <div class="lbl adv-lbl"><i class="ti ti-users" style="margin-right:5px"></i>FROM REVIEWERS<span style="margin-left:auto">1</span></div>
    ${advCard}`;
  return () => { demoMode = false;   // nothing live was touched — just re-render the real view
    if (prevReading && CHAPTERS.some(c => c.id === prevCurrent)){ current = prevCurrent; enterChapter(prevCurrent); }
    else { current = prevCurrent; enterHome(); } };
}
const OWNER_CHAPTER_TOUR = [
  { sel:'#doc h1', title:`Inside a ${UNIT}`, body:`The reading view. We loaded a sample ${UNIT} with a sample reviewer comment and a staged edit so you can see the workflow. Nothing here is saved.` },
  { sel:'.ccard.adv', title:'Reviewers\' comments land here', body:'Every comment your reviewers leave shows here, pinned to the exact spot. Its buttons carry the full action set: Jump to it, Reply so they see your answer, add a Private note only you see, Suggest an edit, record a Resolution, or Send it to Claude.' },
  { sel:'.ccard.adv .a-rec', title:'Record how you handled it', body:'Resolution lets you pick Addressed, Kept as written, or Noted, add an optional note, and Save to reviewer. They see the outcome in their Responses view.' },
  { sel:'.ccard.adv .a-send', title:'Or hand it to Claude', body:'Once you have read a comment, send it to Claude to draft the edit. You still approve the result before anything lands.' },
  { sel:'#doc ins.tc-stage', title:'Proposed edits show inline', body:'A staged edit shows as tracked changes right in the text, the old wording struck through and the new wording in place.' },
  { sel:'#approvebar', title:'Approve and merge', body:'The bar tallies what is approved, rejected, or still to decide. Preview the rendered result, then Queue the approved edits for merge.' },
  { sel:'#tour-demo-select', title:'Comment yourself too', body:'Select any text to leave your own note or propose exact replacement wording, the same way your reviewers do.', pin:'bl' },
  { sel:'#doc figure', title:'Comment on a figure', body:'Click a figure to comment on it, and you can draw a box or circle to point at the exact spot.', pin:'bl' },
  { sel:'#doc table', title:'Everything is reviewable', body:'Tables and equations take comments too, not just paragraphs. Your reviewers can weigh in on all of them the same way.' },
  { sel:'#btn-more', title:'That is the loop', body:'Read, resolve, approve, merge. Reopen this walkthrough anytime from the More menu.' },
];
function launchOwnerChapterTour(){ const restore = loadDemoChapterOwner(); startTour(OWNER_CHAPTER_TOUR, { storageKey:'tour-owner-chapter-v1', onDone: restore }); }
// Mark seen the moment it auto-launches (not just on finish) so a hard refresh never re-triggers it
// for a returning user. The ⋯ menu lets them replay it or turn auto-show back on.
if (!tourSeen('tour-owner-v1')){ markTourSeen('tour-owner-v1'); setTimeout(() => { try { launchOwnerTour(); } catch {} }, 1400); }

const DATA_REPO = _CFG.dataRepo;
// The chapter list is discovered by parsing the author's document and stored in the data repo's
// chapters.json — never hardcoded. Empty (no token / nothing imported yet) → the home shows the
// "import your document" state. Re-fetched on reload after a token is added or a document imported.
let CHAPTERS = await loadChapters(localStorage.getItem('ghpat'));
const chMeta = id => CHAPTERS.find(c => c.id === id) || (id === '__outline__' ? { n:'·', title:'Proposed outline' } : id === '__whole__' ? { n:'·', title:'Whole document' } : { n:'?', title:id });
// ---------- whole-document ("read the whole paper") view state ----------
// WHOLE = the continuous view is active. _reviews holds EVERY chapter's review (per-chapter files stay
// separate — comments never collapse into one blob). _wholeUnits = the assembled ordered units;
// _wholeAdv = per-chapter advisor comments. All writes route back to the owning chapter's file.
let WHOLE = false;
const _reviews = {};      // chapterId -> reviewObj
let _wholeUnits = [];     // orderedUnits(CHAPTERS) currently assembled
const _wholeAdv = {};     // chapterId -> [advisor comments]
const chapterIdOfNode = node => {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const seg = el && el.closest && el.closest('.wd-chapter');
  return seg ? stripSegmentId(seg.id) : null;
};
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
    <button class="icbtn" id="btn-home" title="All ${UNIT}s"><i class="ti ti-layout-grid"></i></button>
    <button class="chsel" id="chsel"><i class="ti ti-book-2"></i><span>${current==='__whole__' ? 'Whole '+escapeHtml(DOC) : `${unitLabel(m, UNIT)} · ${shortTitle(m.title)}`}</span><i class="ti ti-chevron-down" style="font-size:15px;color:var(--text-3)"></i></button>
    <div class="search"><i class="ti ti-search"></i><input id="search" placeholder="Search ${UNIT} · ${MOD}\\ for all"></div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
      <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
      <button class="icbtn" id="btn-focus" title="Focus mode (f)"><i class="ti ti-arrows-diagonal-minimize-2"></i></button>
      <button class="icbtn" id="btn-history" title="History"><i class="ti ti-history"></i></button>
      <button class="icbtn" id="btn-help" title="Guides &amp; help"><i class="ti ti-help-circle"></i></button>
      <button class="icbtn" id="btn-theme" title="Theme"><i class="ti ti-moon"></i></button>
      <button class="btn btn-primary" id="btn-send">${assistantOn() ? '<i class="ti ti-send"></i>Send to Claude' : '<i class="ti ti-git-pull-request"></i>Review actions'}</button>
      <span class="pm-pill" title="${processingMode(_CFG) === 'cloud' ? 'Click to watch cloud activity' : 'Review processing: local'}" style="align-self:center;margin-left:8px;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;${processingMode(_CFG) === 'cloud' ? 'background:var(--accent,#2c64c4);color:#fff;cursor:pointer' : 'background:var(--bg-3,#eef);color:var(--text-3)'}">${modePill(_CFG.processingMode).label}${processingMode(_CFG) === 'cloud' ? ' ◵' : ''}</span>
      <button class="icbtn" id="btn-settings" title="Settings"><i class="ti ti-settings"></i></button>
      <button class="icbtn" id="btn-more" title="More"><i class="ti ti-dots"></i></button>
    </div>`;
  document.getElementById('btn-home').onclick = enterHome;
  document.getElementById('chsel').onclick = openChapterMenu;
  document.getElementById('btn-help').onclick = () => window.open('tutorials/index.html', '_blank', 'noopener');
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-send').onclick = openSendMenu;
  document.getElementById('btn-history').onclick = showHistory;
  document.getElementById('btn-focus').onclick = toggleFocus;
  document.getElementById('btn-more').onclick = openMoreMenu;
  document.getElementById('btn-settings').onclick = () => openSettingsPage();
  const si = document.getElementById('search');
  si.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(si.value); if (e.key === 'Escape'){ si.value=''; clearSearch(); } });
}
const shortTitle = t => { const s = t.split(':')[0].trim(); return s.length <= 34 ? s : s.slice(0,34).replace(/\s\S*$/,'') + '…'; };

function openChapterMenu(){
  const old = document.getElementById('chmenu'); if (old){ old.remove(); return; }
  const menu = document.createElement('div'); menu.id = 'chmenu';
  menu.style.cssText = 'position:absolute;top:50px;left:16px;z-index:40;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 34px rgba(0,0,0,.16);padding:6px;min-width:330px';
  const wholeRow = CHAPTERS.length ? `<div data-ch="__whole__" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500${current==='__whole__'?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px"><i class="ti ti-book"></i></span>Whole ${escapeHtml(DOC)}</div><div style="height:1px;background:var(--border);margin:5px 8px"></div>` : '';
  menu.innerHTML = wholeRow + CHAPTERS.map(c => `<div data-ch="${c.id}" style="display:flex;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px${c.id===current?';background:var(--accent-bg);color:var(--accent)':''}"><span style="color:var(--text-3);min-width:20px">${c.n}</span>${shortTitle(c.title)}</div>`).join('');
  menu.querySelectorAll('[data-ch]').forEach(d => { d.onmouseenter = () => { if (d.dataset.ch!==current) d.style.background='var(--bg-3)'; };
    d.onmouseleave = () => { if (d.dataset.ch!==current) d.style.background='transparent'; };
    d.onclick = () => { menu.remove(); selectChapter(d.dataset.ch); }; });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='chsel'){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
// Export ▾ menu (home topbar): the two things you do WITH your reviewers' comments — take them to Overleaf
// as an edit worklist, or generate a point-by-point response letter. Modeled on openChapterMenu.
function openExportMenu(){
  const old = document.getElementById('export-menu'); if (old){ old.remove(); return; }   // toggle off
  const btn = document.getElementById('btn-export-menu'); if (!btn) return;
  const r = btn.getBoundingClientRect();
  const menu = document.createElement('div'); menu.id = 'export-menu';
  menu.style.cssText = `position:fixed;top:${r.bottom+6}px;left:${r.left}px;z-index:9999;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md,10px);box-shadow:0 10px 34px rgba(0,0,0,.16);padding:6px;min-width:250px`;
  const item = (act, icon, title, sub) => `<div data-act="${act}" style="padding:9px 11px;border-radius:7px;cursor:pointer"><div style="font-size:13px;font-weight:500"><i class="ti ti-${icon}" style="margin-right:8px;color:var(--text-3)"></i>${title}</div><div style="font-size:11px;color:var(--text-3);margin:2px 0 0 25px">${sub}</div></div>`;
  menu.innerHTML = item('overleaf', 'file-symlink', 'Overleaf edit worklist', 'Where to change your .tex for each comment') +
                   item('response', 'file-text', 'Response letter', 'Point-by-point summary for your reviewers');
  document.body.appendChild(menu);
  menu.querySelectorAll('[data-act]').forEach(d => {
    d.onmouseenter = () => d.style.background = 'var(--bg-3)';
    d.onmouseleave = () => d.style.background = 'transparent';
    d.onclick = () => { menu.remove(); if (d.dataset.act === 'overleaf') openOverleafPanel().catch(e => alert('Could not build worklist: ' + e.message)); else exportAdvisorResponse(); };
  });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && !e.target.closest('#btn-export-menu')){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
function doRefresh(){ try{ sessionStorage.setItem('_resume', current||''); }catch(e){} const u = new URL(location.href); u.searchParams.set('_r', Date.now()); location.replace(u.toString()); }   // reload for a fresh deploy, keeping your place
function enterChapter(ch){ if (ch === '__outline__'){ WHOLE = false; localStorage.setItem('lastChapter', ch); loadOwnerOutline(); return; }   // the outline isn't a real chapter — don't try to fetch it
  if (ch === '__whole__'){ localStorage.setItem('lastChapter', ch); loadWholeDoc(); return; }   // the whole-document view assembles every unit; it isn't a single fetch
  WHOLE = false;
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
    const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('content/'+ch+'.html')}`,
      { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' } });
    if (!r.ok) throw new Error('HTTP '+r.status);
    renderDoc(await r.text());
  } catch(e){
    if (/\b401\b/.test(e.message)){ read.innerHTML = `<div class="empty"><i class="ti ti-key-off" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Your access token expired</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:14px">Fine-grained tokens are time-limited. Generate a new Owner key on your Review repo (exact permissions under Settings &rarr; Access &amp; tokens) and re-enter it.</div>
      <button class="btn btn-primary" id="connect">Enter a new token</button></div>`;
      document.getElementById('connect').onclick = () => { const v = prompt('New fine-grained PAT:'); if (v){ localStorage.setItem('ghpat', v.trim()); loadChapter(current); } };
      return; }
    if (/\b404\b/.test(e.message)){   // source imported but this unit's reading HTML isn't built — build it automatically
      autoBuildReadingView(ch);
      return; }
    read.innerHTML = `<div class="empty">Couldn't pull ${escapeHtml(UNIT)} ${chMeta(ch).n} from your private repo (${e.message}). Check the access token in <b>⋯ → Settings</b>.</div>`; }
}
function renderConnect(){
  read.innerHTML = `<div class="empty"><i class="ti ti-lock" style="font-size:24px;color:var(--text-3)"></i>
    <div style="font-size:17px;font-weight:500;margin:10px 0 6px">Connect your ${DOC}</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px">Chapters are pulled privately from your Review repo <code>${DATA_REPO}</code>. Paste your Owner key (exact permissions under Settings &rarr; Access &amp; tokens), set <b>Expiration → No expiration</b> so it never needs replacing — stored only in this browser.</div>
    <button class="btn" id="connect">Add your Owner key</button></div>`;
  document.getElementById('connect').onclick = () => { const v = prompt('Owner key (fine-grained PAT on your Review repo):'); if (v){ localStorage.setItem('ghpat', v.trim()); loadChapter(current); } };
}

// Seamless render: when a unit's reading HTML isn't there yet, build it AUTOMATICALLY — no button. If a
// build is already running (the render workflow auto-fires on import), just poll it; otherwise self-heal
// (ensure the pipeline exists — recovers a project whose first seed failed — and start a build), then poll
// until this section's content appears and load it. A missing `workflow` scope is the one unrecoverable
// case: tell the user exactly how to fix their token instead of spinning forever.
const _buildKicked = new Set();   // project ids we've already started a build for this session (no double-dispatch)
// Tokenless B1: an Overleaf-linked project's source lives in the Overleaf-synced bridge repo (external
// source). Overleaf → bridge repo is automatic (Overleaf's own GitHub sync); but render.yml auto-fires only
// on the DATA repo's own source, not on an external repo changing — so the owner pulls Overleaf's latest with
// this explicit refresh, which just re-dispatches the render (resolve_source re-clones the bridge repo).
async function refreshFromOverleaf(){
  const t = tok(); if (!t) return openSettingsPage('access');
  try {
    flash('Refreshing from Overleaf…');
    await dispatchRender(t, _projectId);
    flash('Pulling Overleaf’s latest — the reading view will rebuild shortly.');
  } catch (e){ flash('Refresh failed: ' + (e && e.message || e)); }
}

async function autoBuildReadingView(ch){
  const t = tok(); if (!t){ renderConnect(); return; }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  read.innerHTML = `<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i>
    <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Building your reading view…</div>
    <div id="buildrv-status" style="font-size:12.5px;color:var(--text-3);max-width:460px;margin:0 auto;line-height:1.7"></div></div>`;
  const say = m => { const s = document.getElementById('buildrv-status'); if (s) s.innerHTML = m; };
  const fetchContent = () => fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('content/' + ch + '.html')}`,
    { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github.raw' }, cache: 'no-store' }).catch(() => null);
  try {
    let run = await renderRun(t).catch(() => null);
    const active = run && (run.status === 'queued' || run.status === 'in_progress');
    if (!active && !_buildKicked.has(_projectId)){          // nothing building → make sure it can, and start it
      say('Setting up the build on your repo…');
      const res = await ensureRenderPipeline(DATA_REPO, t);
      if (res.seeded.includes('.github/workflows/render.yml')) await wait(4000);   // let GitHub register the new workflow
      for (let a = 0; a < 3; a++){ try { await dispatchRender(t, _projectId); break; } catch (err){ if (a === 2) throw err; await wait(3000); } }
      _buildKicked.add(_projectId);
    }
    say(`Rendering your ${escapeHtml(UNIT)}s on your GitHub — this takes a couple of minutes…`);
    for (let i = 0; i < 60; i++){                            // poll up to ~5 min; load the instant this section lands
      await wait(5000);
      const c = await fetchContent();
      if (c && c.ok){ renderDoc(await c.text()); return; }
      run = await renderRun(t).catch(() => null);
      if (run && run.status === 'completed' && run.conclusion !== 'success'){
        say('The build didn’t succeed. Open the <b>Actions</b> tab on your Review repo to see why, then reload.'); return;
      }
      if (run && run.status) say(`Building… (${escapeHtml(run.status)})`);
    }
    say('This is taking longer than expected. Check the <b>Actions</b> tab on your Review repo, then reload.');
  } catch (e){
    if (/workflow-scope/.test(e.message)){
      say(`Your token is missing the <b>workflow</b> permission, so Footnote can’t build on your repo. <a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Footnote" target="_blank" rel="noopener">Generate a new token</a> (<code>repo</code> + <code>workflow</code>), update it in <b>⋯ → Settings</b>, then reload.`);
    } else {
      say('Couldn’t build the reading view: ' + escapeHtml(e.message) + '. Check <b>⋯ → Settings</b>.');
    }
  }
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
      else { const t = tok(); if (!t) return; const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('content/'+ch+'.srcmap.json')}?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' }); if (r.ok) json = await r.json(); }
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
const ADVISOR_IDS = _CFG.advisors.map(a=>a.id);
const ADVISOR_NAME = Object.fromEntries(_CFG.advisors.map(a=>[a.id,a.name]));
// Names of reviewers added at RUNTIME (via the Reviewers panel → advisors.json), which aren't in the
// config. Populated lazily from advisors.json so a comment pill shows "Matt McCoy", not "matt-mccoy-h2uf".
let _advNamesRuntime = {};
// label a comment's source: named advisor → their name (config or runtime); shared lab reviewer → typed name
const whoLabel = c => resolveReviewerName(c._advisor, { configNames: ADVISOR_NAME, runtimeNames: _advNamesRuntime, author: c.author });
// an advisor's follow-up replies (when they felt a response was incomplete) + a re-opened flag
const fupHtml = c => (c.followups||[]).map(f => `<div class="rel-fup"><i class="ti ti-corner-down-right" style="font-size:13px"></i> ${escapeHtml(f.text)} <span style="color:var(--text-3);font-size:11px">· ${(f.ts||'').slice(0,10)}</span></div>`).join('');
const threadHtml = c => (c.thread||[]).map(m => `<div class="rel-fup" style="border-left-color:${m.author==='author'?'var(--accent)':'var(--success)'}"><b>${m.author==='author'?'You':'Reviewer'}</b> <span style="color:var(--text-3);font-size:11px">· ${fmtDate(m.ts)}</span><div>${escapeHtml(m.text)}</div></div>`).join('');
let advisorComments = [];
// Load reviewer display names once (runtime reviewers live in advisors.json, not the config) so pills
// show names, not ids. Dev reads the local file; production reads the data repo via the token.
let _advNamesLoaded = false;
async function ensureAdvNames(t){
  if (_advNamesLoaded) return;
  try {
    let advisors = null;
    if (location.hostname==='localhost' || location.hostname==='127.0.0.1'){
      const r = await fetch('./advisors.json'); if (r.ok){ const j = await r.json(); advisors = j && j.advisors; }
    } else if (t){ const { reg } = await loadAdvisorsRegistry(t); advisors = reg.advisors; }
    if (Array.isArray(advisors)){ _advNamesRuntime = Object.fromEntries(advisors.map(a=>[a.id, a.name])); _advNamesLoaded = true; }
  } catch(e){}
}
async function loadAdvisorComments(ch){
  advisorComments = []; const dev = location.hostname==='localhost' || location.hostname==='127.0.0.1';
  await ensureAdvNames(tok());   // reviewer names for comment pills (runtime reviewers aren't in the config)
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
                  kind:'figure', figure:info.id, section: headingFor(fig), confirmed:true, rects:[], chapterId: WHOLE ? chapterIdOfNode(fig) : null };
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
      pending = { quote: label ? `${label}: ${quote}` : quote, kind:'figure', figure:label, section: headingFor(el), confirmed:true, rects:[], chapterId: WHOLE ? chapterIdOfNode(el) : null };
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
  pending.chapterId = WHOLE ? chapterIdOfNode(range.startContainer) : null;   // whole-doc: which chapter's review does this comment belong to
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
    const fields = { anchor:pending, kind:edit?'suggestion':pending.kind, tag:edit?'edit':tag, body:body.value, edit };
    if (WHOLE){ createWholeComment(pending.chapterId, fields); pop.remove(); window.getSelection().removeAllRanges(); return; }
    review = addComment(review, fields);
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
      // whole-doc: route the markup comment to the figure's OWN chapter review; else the current chapter.
      const chId = WHOLE ? anchor.chapterId : null;
      let rev = addComment(chId ? routeWrite(_reviews, chId, id => loadLocalReview(id)) : review, { anchor, kind:'figure', tag:'figure', body:note });
      const c = rev.comments[rev.comments.length-1];
      const path = `markups/${c.id}.png`; markupCache[path] = dataUrl;
      rev = updateComment(rev, c.id, { markup:{ path, ts:new Date().toISOString() } });
      const t = tok();
      if (chId){
        _reviews[chId] = rev; localStorage.setItem('review:'+chId, JSON.stringify(rev));
        paintWholeHighlights(); buildNavWhole(); renderWholeComments(); ov.remove();
        if (t){ await putFile(t, path, b64, `markup: figure comment ${c.id}`); await pushChapterReview(chId); flash('Markup saved.'); }
        else flash('Markup saved locally — connect to upload it.');
      } else {
        review = rev; save(); renderComments(); buildNav(); paintHighlights(); ov.remove();
        if (t){ await putFile(t, path, b64, `markup: figure comment ${c.id}`); await syncUp(); flash('Markup saved.'); }
        else flash('Markup saved locally — connect to upload it.');
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
let editingId = null, activeCommentId = null, resolvedOpen = false;
let cFilter = { status:'all', tag:'all', sort:'doc' };
const STATUS_ORDER = ['all','open','queued','staged','approved','answered','merged','declined','resolved'];
const RESOLVED_STATES = new Set(['merged','declined','resolved']);   // terminal — fold into "Resolved (N)"
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
        ${assistantOn() ? `<button class="btn cdec-b ${c.decision==='revise'?'on-revise':''}" data-d="revise"><i class="ti ti-pencil"></i>Request changes</button>` : ''}
      </div>
      ${assistantOn() ? `<div class="cdec-revform" style="display:none"><textarea class="cdec-revt" rows="2" placeholder="What should change? This re-queues the edit for Claude."></textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-primary cdec-revsend" style="padding:4px 11px;font-size:11.5px">Send to Claude</button><button class="btn cdec-revcancel" style="padding:4px 11px;font-size:11.5px">Cancel</button></div></div>` : ''}` : ''}
      ${c.status === 'approved' ? `<div class="cdec" data-id="${c.id}"><span class="cqd"><i class="ti ti-clock-check"></i>queued for merge</span><button class="btn cunq" data-id="${c.id}"><i class="ti ti-arrow-back-up"></i>Unqueue</button></div>` : ''}
      ${c.claude?.response ? `<div class="cresp"><div class="cresp-h"><i class="ti ti-robot-face"></i>Claude</div>${escapeHtml(c.claude.response)}</div>` : ''}
      ${c.claude?.branch ? `<div class="branch"><i class="ti ti-git-branch"></i>${escapeHtml(c.claude.branch)}</div>` : ''}
      ${(c.thread||[]).map(m => `<div class="cmsg ${m.author==='you'?'me':'cl'}"><span class="cmsg-h">${m.author==='you'?'You':'Claude'} · ${(m.ts||'').slice(0,10)}</span>${escapeHtml(m.text)}</div>`).join('')}
      ${st!=='resolved' ? `<div class="creply"><button class="creply-open">${(c.thread&&c.thread.length)?'Reply':(assistantOn()&&(c.claude?.response||c.claude?.branch)?'Reply / push back':'Add a note')}</button>
        <div class="creply-form" style="display:none"><textarea class="creply-t" rows="2" placeholder="${assistantOn()&&(c.claude?.response||c.claude?.branch)?'Reply to Claude / request a change…':'Add a private note…'}"></textarea><button class="btn btn-primary creply-send" style="padding:4px 11px;font-size:11.5px">Send</button></div></div>` : ''}`;
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
  // Only re-queue for Claude when the assistant is ON; with AI off a reply is just a private note.
  const handled = assistantOn() && (!!(c.claude?.response || c.claude?.branch) || ['staged','approved','answered','merged'].includes(c.status));
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
  lbl.innerHTML = `<i class="ti ti-users" style="margin-right:5px"></i>FROM REVIEWERS<span style="margin-left:auto">${active.length}</span>`;
  pane.appendChild(lbl);
  // C2b: comments on the same passage collapse into one group card ("N reviewers on this passage").
  clusterComments(active).forEach(g => pane.appendChild(g.length > 1 ? buildAdvCluster(g) : buildAdvCard(g[0])));
  if (resolved.length){   // advisor-resolved comments fold into a collapsible group instead of vanishing
    const grp = document.createElement('div'); grp.className = 'resolved-grp';
    const head = document.createElement('button'); head.className = 'resolved-head';
    head.innerHTML = `<i class="ti ti-chevron-${advResolvedOpen?'down':'right'}"></i><span>Resolved by reviewer</span><span class="rcount">${resolved.length}</span>`;
    const body = document.createElement('div'); body.className = 'resolved-body'; body.style.display = advResolvedOpen?'block':'none';
    resolved.forEach(c => body.appendChild(buildAdvCard(c)));
    head.onclick = () => { advResolvedOpen = !advResolvedOpen; body.style.display = advResolvedOpen?'block':'none'; head.querySelector('i').className = `ti ti-chevron-${advResolvedOpen?'down':'right'}`; };
    grp.appendChild(head); grp.appendChild(body); pane.appendChild(grp);
  }
}
// C2b: two reviewers on the same passage → one group card wrapping the individual comment cards, so
// the author sees they concern the same text. Expandable; the member cards keep their full action set.
function buildAdvCluster(group){
  const reviewers = [...new Set(group.map(c => whoLabel(c)))];
  const quote = (group[0] && group[0].anchor && group[0].anchor.quote || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  const wrap = document.createElement('div'); wrap.className = 'ccluster';
  wrap.style.cssText = 'border:1px solid var(--accent);border-radius:var(--r-lg,10px);margin:0 0 10px;overflow:hidden;background:var(--accent-bg,rgba(44,100,196,.06))';
  const head = document.createElement('button');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:none;cursor:pointer;padding:9px 11px;font:inherit;color:var(--text)';
  head.innerHTML = `<i class="ti ti-users" style="color:var(--accent);flex:0 0 auto"></i><span style="font-size:12.5px;font-weight:600;flex:0 0 auto">${reviewers.length > 1 ? `${reviewers.length} reviewers` : `${group.length} comments`} on this passage</span><span style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">"${escapeHtml(quote)}"</span><i class="ti ti-chevron-down cc-car" style="color:var(--text-3);flex:0 0 auto"></i>`;
  const body = document.createElement('div'); body.style.cssText = 'padding:0 8px 6px';
  group.forEach(c => body.appendChild(buildAdvCard(c)));
  let open = true;
  head.onclick = () => { open = !open; body.style.display = open ? '' : 'none'; head.querySelector('.cc-car').className = `ti ti-chevron-${open ? 'down' : 'right'} cc-car`; };
  wrap.appendChild(head);
  // C2: conflict escalation — 2+ reviewers proposed edits to this same passage. Surface it and let the
  // author keep one (the others are recorded declined). The merge backend (C2c) is the safety net.
  if (clusterHasConflict(group)){
    const edits = editComments(group);
    const banner = document.createElement('div');
    banner.style.cssText = 'margin:0 8px 8px;padding:8px 10px;border:1px solid var(--warn);background:var(--warn-bg,rgba(190,120,20,.08));border-radius:8px';
    banner.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--warn);display:flex;align-items:center;gap:6px"><i class="ti ti-alert-triangle"></i>Both edited this — keep one</div>
      <div style="font-size:11.5px;color:var(--text-2);margin:3px 0 7px">${edits.length} reviewers proposed edits to this passage. Keep one; the others are dismissed for the reviewer.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${edits.map(e => `<button class="btn cc-keep" data-keep="${e.id}" style="padding:3px 9px;font-size:11.5px"><i class="ti ti-check"></i>Keep ${escapeHtml(whoLabel(e))}’s edit</button>`).join('')}</div>`;
    banner.querySelectorAll('.cc-keep').forEach(btn => btn.onclick = async () => {
      const keepId = btn.dataset.keep; banner.querySelectorAll('.cc-keep').forEach(b => b.disabled = true);
      try {
        for (const e of edits){
          if (e.id === keepId) continue;
          await recordResolution(e._advisor, current, e.id, { state:'declined', note:'Superseded by another reviewer’s edit on this passage.' });
          e.resolution = { state:'declined', note:'' }; e.read = true;
        }
        renderComments(); paintHighlights();
      } catch(err){ banner.querySelectorAll('.cc-keep').forEach(b => b.disabled = false); alert('Failed: ' + err.message); }
    });
    wrap.appendChild(banner);
  }
  wrap.appendChild(body);
  return wrap;
}
// build one in-context advisor card with the full action set (rail is the primary action surface)
function buildAdvCard(c){
  const card = document.createElement('div'); card.className = 'ccard adv' + (c.read?' is-read':''); card.dataset.aid = c.id;
  const notes = (advNotesState.notes[c.id]||[]);
  const ai = isAiComment(c);
  card.innerHTML = `<div class="row">
      <label class="rel-read"><input type="checkbox" class="adv-readbox" ${c.read?'checked':''}>read</label>
      <span class="chip advchip" style="${ai?'background:var(--info-bg);color:var(--info)':''}"><i class="ti ti-${ai?'robot-face':'user'}" style="font-size:11px;margin-right:3px"></i>${escapeHtml(whoLabel(c))}</span>
      ${c.tag&&c.tag!=='other'?`<span class="chip" style="margin-left:5px">${c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:10px;margin-right:2px"></i>':''}${escapeHtml(c.tag)}</span>`:''}
      ${c.sent?'<span class="status" style="margin-left:auto;background:var(--info-bg);color:var(--info)">sent</span>':c.status==='submitted'?'<span class="status" style="margin-left:auto;background:var(--success-bg);color:var(--success)">submitted</span>':''}</div>
    <div class="snip">"${escapeHtml((c.anchor?.quote||'').slice(0,52))}"${c.created_ts?`<span class="cmeta"> · ${fmtDate(c.created_ts)}</span>`:''}</div>
    <div class="body">${escapeHtml(c.body)}</div>${suggHtml(c)}${resolHtml(c)}${threadHtml(c)}
    ${notes.map(n=>`<div class="rel-note"><i class="ti ti-lock" style="font-size:12px"></i> ${escapeHtml(n.text)} <span style="color:var(--text-3);font-size:11px">· private · ${fmtDate(n.ts)}</span></div>`).join('')}
    <div class="advacts">
      <button class="btn aj"><i class="ti ti-arrow-right"></i>Jump</button>
      ${ai ? `
      ${assistantOn() ? `<button class="btn btn-primary a-act" ${c.sent?'disabled title="Already sent to Claude"':''}><i class="ti ti-check"></i>${c.sent?'Sent to Claude':'Act on it'}</button>` : ''}
      <button class="btn a-dismiss"><i class="ti ti-x"></i>Dismiss</button>
      ${assistantOn() ? `<button class="btn a-morework" ${c.sent?'disabled title="Already sent — iterate from the staged edit’s Request changes"':''}><i class="ti ti-pencil"></i>Request further work</button>` : ''}
      ` : `
      <button class="btn a-reply"><i class="ti ti-message"></i>Reply</button>
      <button class="btn a-note"><i class="ti ti-note"></i>Private note</button>
      <button class="btn a-suggest"><i class="ti ti-pencil"></i>Suggest edit</button>
      <button class="btn a-rec"><i class="ti ti-message-check"></i>${c.resolution?'Update':'Resolution'}</button>
      ${assistantOn() ? `<button class="btn a-send" ${(!c.read||c.sent)?`disabled title="${c.sent?'Already sent':'Mark this read first'}"`:''}><i class="ti ti-send"></i>${c.sent?'Sent':'Send to Claude'}</button>` : ''}
      `}</div>
    <div class="rel-pop a-replybox" style="display:none"><textarea rows="2" placeholder="Reply to ${escapeHtml(whoLabel(c))} — they'll see this…"></textarea><div class="rel-popacts"><button class="btn btn-primary a-reply-save">Send reply</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rel-pop a-notebox" style="display:none"><textarea rows="2" placeholder="Private note — only you see this…"></textarea><div class="rel-popacts"><button class="btn btn-primary a-note-save">Save note</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rel-pop a-suggestbox" style="display:none"><div class="sug-passage">Editing this passage:<blockquote>"${escapeHtml(c.anchor?.quote||'')}"</blockquote><button class="btn a-jump2" style="padding:2px 8px;font-size:11px"><i class="ti ti-arrow-right"></i>Read it in context</button></div>
      <select class="a-sug-op">${['replace','insert','delete'].map(o=>`<option value="${o}"${c.edit?.op===o?' selected':(o==='replace'&&!c.edit?' selected':'')}>${o==='replace'?'Replace with':o==='insert'?'Insert after':'Delete'}</option>`).join('')}</select>
      <textarea class="a-sug-find" rows="2" placeholder="Exact text to find (verbatim)…">${escapeHtml(c.edit?.find ?? c.anchor?.quote ?? '')}</textarea>
      <textarea class="a-sug-repl" rows="2" placeholder="Your replacement / insertion text…">${escapeHtml(c.edit?.replacement||'')}</textarea>
      <div class="rel-popacts"><button class="btn btn-primary a-sug-save">Attach edit</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rel-pop a-moreworkbox" style="display:none"><textarea rows="2" placeholder="What should Claude do? e.g. go deeper, wrong section, cite a source…"></textarea><div class="rel-popacts"><button class="btn btn-primary a-morework-save">Send to Claude</button><button class="btn a-x">Cancel</button></div></div>
    <div class="rform" style="display:none">
      <select class="r-state"><option value="addressed"${c.resolution?.state==='addressed'?' selected':''}>Addressed — changed as suggested</option><option value="declined"${c.resolution?.state==='declined'?' selected':''}>Kept as written</option><option value="noted"${c.resolution?.state==='noted'?' selected':''}>Noted</option></select>
      <textarea class="r-note" rows="2" placeholder="How it was handled — the reviewer sees this…">${escapeHtml(c.resolution?.note||'')}</textarea>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn btn-primary r-save" style="padding:4px 10px;font-size:11.5px">Save to reviewer</button><span class="r-stat" style="font-size:11px;color:var(--text-3)"></span></div></div>`;
  card.onmouseenter = () => document.querySelector(`#doc .cmark[data-aid="${c.id}"]`)?.classList.add('cmark-hot');
  card.onmouseleave = () => document.querySelector(`#doc .cmark[data-aid="${c.id}"]`)?.classList.remove('cmark-hot');
  const swap = () => { const fresh = buildAdvCard(c); card.replaceWith(fresh); };   // in-place re-render, no re-fetch
  const toggle = sel => { const box = card.querySelector(sel); card.querySelectorAll('.rel-pop, .rform').forEach(p => { if (p !== box) p.style.display = 'none'; }); box.style.display = box.style.display==='none'?'block':'none'; if (box.style.display==='block') box.querySelector('textarea')?.focus(); };
  card.querySelectorAll('.a-x').forEach(x => x.onclick = () => card.querySelectorAll('.rel-pop, .rform').forEach(p => p.style.display = 'none'));
  card.querySelector('.snip').onclick = () => jumpToAdvisor(c);
  card.querySelector('.aj').onclick = () => jumpToAdvisor(c);
  card.querySelector('.a-jump2')?.addEventListener('click', () => jumpToAdvisor(c));
  card.querySelector('.adv-readbox').onchange = async e => { const v = e.target.checked; try { await markAdvisorRead(c._advisor, current, c.id, v); c.read = v; swap(); } catch(err){ alert('Failed: ' + err.message); e.target.checked = !v; } };
  card.querySelector('.a-reply')?.addEventListener('click', () => toggle('.a-replybox'));
  if (ai){
    card.querySelector('.a-act')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Sending…';
      try { await sendAdvisorToClaude(c._advisor, current, c); c.sent = true; c.read = true; swap(); }
      catch(err){ b.disabled = false; b.textContent = 'Act on it'; alert('Failed: ' + err.message); }
    });
    card.querySelector('.a-dismiss')?.addEventListener('click', async () => {
      try { await recordResolution(c._advisor, current, c.id, { state:'declined', note:'' }); c.resolution = { state:'declined', note:'' }; c.read = true; swap(); }
      catch(err){ alert('Failed: ' + err.message); }
    });
    card.querySelector('.a-morework')?.addEventListener('click', () => toggle('.a-moreworkbox'));
    card.querySelector('.a-morework-save')?.addEventListener('click', async () => {
      const note = card.querySelector('.a-moreworkbox textarea').value.trim(); if (!note) return;
      try { await sendAdvisorToClaude(c._advisor, current, c, note); c.sent = true; c.read = true; swap(); }
      catch(err){ alert('Failed: ' + err.message); }
    });
  }
  card.querySelector('.a-note')?.addEventListener('click', () => toggle('.a-notebox'));
  card.querySelector('.a-suggest')?.addEventListener('click', () => toggle('.a-suggestbox'));
  card.querySelector('.a-rec')?.addEventListener('click', () => toggle('.rform'));
  card.querySelector('.a-reply-save')?.addEventListener('click', async () => { const txt = card.querySelector('.a-replybox textarea').value.trim(); if (!txt) return;
    try { await replyToAdvisorComment(c._advisor, current, c.id, txt); c.thread = [...(c.thread||[]), { author:'author', text:txt, ts:new Date().toISOString() }]; c.read = true; swap(); } catch(e){ alert('Failed: ' + e.message); } });
  card.querySelector('.a-note-save')?.addEventListener('click', async () => { const txt = card.querySelector('.a-notebox textarea').value.trim(); if (!txt) return;
    try { await savePrivateNote(advNotesState, c.id, txt); swap(); } catch(e){ alert('Failed: ' + e.message); } });
  card.querySelector('.a-sug-save')?.addEventListener('click', async () => { const op = card.querySelector('.a-sug-op').value, find = card.querySelector('.a-sug-find').value.trim(), replacement = card.querySelector('.a-sug-repl').value.trim();
    if (!find && op !== 'insert'){ alert('Enter the text to find.'); return; }
    try { const edit = { op, find, replacement }; await suggestAdvisorEdit(c._advisor, current, c.id, edit); c.edit = edit; c.read = true; swap(); } catch(e){ alert('Failed: ' + e.message); } });
  const aSendBtn = card.querySelector('.a-send');   // present only when the assistant is on
  if (aSendBtn) aSendBtn.onclick = async () => { if (!confirm('Send this comment to Claude to address?')) return;
    aSendBtn.disabled = true; aSendBtn.textContent = 'Sending…';
    try { await sendAdvisorToClaude(c._advisor, current, c); c.sent = true; c.read = true; swap(); } catch(e){ aSendBtn.textContent = 'Failed: ' + e.message; } };
  card.querySelector('.r-save')?.addEventListener('click', async () => { const stat = card.querySelector('.r-stat'); stat.textContent = 'Saving…';
    const resolution = { state:card.querySelector('.r-state').value, note:card.querySelector('.r-note').value.trim(), ts:new Date().toISOString() };
    try { await recordResolution(c._advisor, current, c.id, resolution); c.resolution = resolution; c.read = true; stat.textContent = 'Saved — visible to the reviewer.'; setTimeout(swap, 600); }
    catch(e){ stat.textContent = 'Failed: ' + e.message; } });
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
  if (el) scrollFlash(el); else flash(`Couldn’t find this passage in the ${UNIT}; it may have changed since the comment.`);
}
// jump after a chapter is still loading: retry until the doc is ready, then prefer the edit-diff
function jumpWhenReady(c, tries = 14){
  const tick = () => {
    if (document.getElementById('doc')){
      const el = jumpTarget(c);
      if (el){ scrollFlash(el); return; }
    }
    if (tries-- > 0) setTimeout(tick, 280); else flash(`Couldn’t find this passage in the ${UNIT}; it may have changed since the comment.`);
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
  if (el) scrollFlash(el); else flash(`Couldn’t find this passage in the ${UNIT}; it may have changed since the comment.`);
}
function activateComment(id){
  activeCommentId = id; if (WHOLE) renderWholeComments(); else renderComments();
  const card = document.querySelector(`#comments .ccard[data-id="${id}"]`);
  card?.scrollIntoView({ behavior:'smooth', block:'center' });
  card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 1500);
}
// wrap each comment's quoted text in a <mark> so commented passages are visible while reading.
// paintCommentsIn scopes ALL matching to `root` — in whole-doc `root` is one #wd-<id> segment, so an
// identical phrase in another chapter can never be highlighted by this chapter's comment.
function paintCommentsIn(root, comments, advComments){
  root.querySelectorAll('mark.cmark').forEach(m => { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
  root.querySelectorAll('.cmark-el').forEach(e => { e.classList.remove('cmark-el'); e.onclick = null; delete e.dataset.cid; });
  root.querySelectorAll('figure[data-cid]').forEach(f => { f.classList.remove('cmark-fig'); delete f.dataset.cid; });
  const blocks = [...root.querySelectorAll('p, li, figcaption')];
  (comments||[]).forEach(c => {
    if (RESOLVED_STATES.has(c.status)) return;   // don't highlight finalized comments (merged/answered/declined/resolved)
    if (c.kind === 'figure'){ markFigure(root, c); return; }
    const q = (c.anchor.quote||'').replace(/\s+/g,' ').trim(); if (q.length < 4) return;
    const needle = q.slice(0, 50);
    const el = blocks.find(e => e.textContent.replace(/\s+/g,' ').includes(needle.slice(0,40)));
    if (!el) return;
    if (!wrapInNode(el, needle, c)){ el.classList.add('cmark-el'); el.dataset.cid = c.id; el.style.setProperty('--mk', `var(--${c.tag})`); el.onclick = () => activateComment(c.id); }
  });
  // advisor comments — distinct marker, jump to their card
  (advComments||[]).forEach(c => {
    if (c.kind === 'figure') return;
    const q = (c.anchor?.quote||'').replace(/\s+/g,' ').trim(); if (q.length < 4) return;
    const needle = q.slice(0, 50);
    const el = blocks.find(e => e.textContent.replace(/\s+/g,' ').includes(needle.slice(0,40)));
    if (el) wrapInNode(el, needle, c, true);
  });
}
function paintHighlights(){
  const doc = document.getElementById('doc'); if (!doc) return;
  if (WHOLE){ paintWholeHighlights(); return; }
  paintCommentsIn(doc, review.comments, advisorComments);
}
// ================= whole-document ("read the whole paper") view =================
// Assemble every unit into one #doc, each wrapped in a #wd-<id> segment. Comments are held per chapter
// in _reviews and resolved WITHIN their own segment (chapter-scoped anchoring), and new comments route
// back to the owning chapter's review file. Live sync is off in this view (v1) — a manual refresh rebuilds.
async function loadWholeDoc(){
  WHOLE = true; current = '__whole__'; review = loadLocalReview('__whole__'); localStorage.setItem('lastChapter', '__whole__');
  document.getElementById('nav').style.display = ''; document.getElementById('comments').style.display = '';
  stopOwnerLiveSync();                       // v1: no per-chapter polling in whole-doc; single-chapter live sync is untouched
  renderTopbar();                            // chsel shows "Whole document" via chMeta
  _wholeUnits = orderedUnits(CHAPTERS);
  if (!_wholeUnits.length){
    read.innerHTML = `<div class="empty"><i class="ti ti-book" style="font-size:24px;color:var(--text-3)"></i>
      <div style="font-size:16px;font-weight:500;margin:10px 0 6px">Nothing to read yet</div>
      <div style="font-size:13px;line-height:1.6;max-width:420px;margin:0 auto">Import your ${escapeHtml(DOC)} first — then the whole ${escapeHtml(DOC)} shows here as one continuous read.</div></div>`;
    document.getElementById('nav').innerHTML = ''; document.getElementById('comments').innerHTML = ''; return;
  }
  const t = tok(); if (!t){ renderConnect(); return; }
  read.innerHTML = `<div class="empty"><i class="ti ti-loader-2" style="font-size:22px"></i><div style="margin-top:8px">Assembling the whole ${escapeHtml(DOC)}…</div></div>`;
  const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // Fetch every unit's rendered HTML CONCURRENTLY (was one sequential GitHub round-trip per unit, slow on a
  // large doc). Order is preserved by mapping back over _wholeUnits, not by fetch-completion order.
  const fetchFrag = async (u) => {
    try {
      if (dev){ const r = await fetch(`./chapters/${u.id}.html`); if (r.ok) return await r.text(); }
      const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('content/'+u.id+'.html')}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' } });
      if (r.ok) return await r.text();
    } catch(e){}
    return null;
  };
  const frags = await Promise.all(_wholeUnits.map(fetchFrag));
  const parts = _wholeUnits.map((u, i) => {
    const frag = frags[i] != null ? frags[i] : `<div class="empty" style="padding:22px"><i class="ti ti-file-code" style="font-size:20px;color:var(--text-3)"></i><div style="font-size:13px;margin-top:8px">Reading view not built yet for this ${escapeHtml(UNIT)}.</div></div>`;   // placeholder for THIS section — never abort the whole view
    return wrapUnit(u.id, `${unitLabelWithTitle(u, UNIT)}`, frag);
  });
  read.innerHTML = `<article id="doc">${parts.join('\n')}</article>`;
  const doc = document.getElementById('doc');
  consolidateWholeRefs(doc);   // pull each unit's own reference list into ONE at the very end
  fixFootnotes(doc); runKatex(doc); wireFigures(doc); wireCitations(doc); linkCrossRefs(doc);
  await loadAllReviews(_wholeUnits);
  buildNavWhole(); paintWholeHighlights(); renderWholeComments(); restoreCursor();
}
// Whole-doc only: collapse each unit's own citeproc #refs block into ONE References section at the end
// of #doc (dedup by ref key; also removes the duplicate ids the concatenation would otherwise create).
function consolidateWholeRefs(doc){
  if (!doc) return;
  const entries = [];
  doc.querySelectorAll('.wd-chapter').forEach(seg => {
    seg.querySelectorAll('#refs, .references').forEach(block => {
      block.querySelectorAll('.csl-entry').forEach(el => entries.push({ key: el.id, html: el.outerHTML }));
      block.remove();
    });
  });
  const html = buildRefsSection(entries);
  if (html) doc.insertAdjacentHTML('beforeend', html);
}
// Load EVERY unit's owner review (local merged with remote) + advisor comments into the per-chapter maps.
async function loadAllReviews(units){
  const t = tok(); const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  let advPaths = [];
  if (!dev && t){ try { advPaths = await ghTree(t); } catch(e){} }
  // Load every unit's review CONCURRENTLY (was N sequential round-trips). Each unit's own advisor files
  // load concurrently too. Per-item try/catch so one failure can't reject the whole batch.
  await Promise.all(units.map(async (u) => {
    let rev = loadLocalReview(u.id);
    try {
      if (dev){ const r = await fetch(`./reviews/${u.id}.json`); if (r.ok) rev = reconcileReview(rev, await r.json(), true); }
      else if (t){ const { json } = await getJson(t, reviewPath(u.id)); if (json) rev = reconcileReview(rev, json, true); }
    } catch(e){}
    _reviews[u.id] = rev;
    const adv = [];
    if (!dev && t){
      const re = new RegExp(`^advisor/([^/]+)/${u.id}\\.json$`);
      const ids = [...new Set(advPaths.map(p => { const m = p.match(re); return m && m[1]; }).filter(Boolean))];
      await Promise.all(ids.map(async (a) => { try { const { json } = await getJson(t, `advisor/${a}/${u.id}.json`); (json?.comments||[]).forEach(c => { if (c.status !== 'open') adv.push({ ...c, _advisor:a }); }); } catch(e){} }));
    }
    _wholeAdv[u.id] = adv;
  }));
}
function paintWholeHighlights(){
  const doc = document.getElementById('doc'); if (!doc) return;
  _wholeUnits.forEach(u => { const seg = document.getElementById('wd-' + u.id); if (!seg) return;
    paintCommentsIn(seg, (_reviews[u.id] && _reviews[u.id].comments) || [], _wholeAdv[u.id] || []); });
}
// Nav spans the whole doc: a bold per-chapter entry (with its active-comment count) + its section links.
function buildNavWhole(){
  const nav = document.getElementById('nav');
  nav.innerHTML = `<div class="lbl">${escapeHtml(DOC.toUpperCase())}<span style="margin-left:auto">${_wholeUnits.length}</span></div>`;
  _wholeUnits.forEach(u => {
    const cnt = ((_reviews[u.id] && _reviews[u.id].comments) || []).filter(c => !RESOLVED_STATES.has(c.status)).length;
    const a = document.createElement('a'); a.dataset.seg = 'wd-' + u.id;
    a.innerHTML = `<span class="nav-t" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(u.n + ' · ' + shortTitle(u.title))}</span>${cnt?`<span class="count">${cnt}</span>`:''}`;
    a.querySelector('.nav-t').onclick = () => document.getElementById('wd-' + u.id)?.scrollIntoView({ behavior:'smooth', block:'start' });
    nav.appendChild(a);
    const seg = document.getElementById('wd-' + u.id);
    [...(seg ? seg.querySelectorAll('h2, h3') : [])].forEach((h, i) => { if (!h.id) h.id = 'wd-' + u.id + '-sec-' + i;
      const s = document.createElement('a'); s.className = h.tagName === 'H3' ? 'sub' : ''; s.dataset.sec = h.id;
      s.innerHTML = `<span class="nav-t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:14px;color:var(--text-2)">${escapeHtml(h.textContent)}</span>`;
      s.querySelector('.nav-t').onclick = () => h.scrollIntoView({ behavior:'smooth', block:'start' }); nav.appendChild(s); });
  });
}
// One aggregated sidebar; each card tagged with its chapter and clicking scrolls to the passage. Reply /
// resolve / approve stay in the single-chapter view (v1) — creation + view + routing are the contract here.
function renderWholeComments(){
  const pane = document.getElementById('comments');
  const flat = mergeReviews(_reviews, _wholeUnits).filter(x => !RESOLVED_STATES.has(x.comment.status));
  const open = flat.filter(x => x.comment.status === 'open').length;
  pane.innerHTML = `<div class="lbl">COMMENTS<span style="margin-left:auto">${flat.length} · ${open} open</span></div>`;
  if (!flat.length){ pane.innerHTML += `<div style="font-size:12.5px;color:var(--text-3);padding:8px 2px">Select text in any ${escapeHtml(UNIT)} to leave a comment. Open a single ${escapeHtml(UNIT)} to reply or resolve.</div>`; return; }
  flat.forEach(({ chapterId, comment }) => pane.appendChild(buildWholeCard(chapterId, comment)));
}
function buildWholeCard(chapterId, c){
  const m = chMeta(chapterId);
  const card = document.createElement('div'); card.className = 'ccard'; card.dataset.id = c.id;
  card.innerHTML = `<div class="row">
      <span class="chip" style="background:var(--bg-3);color:var(--text-2)">${escapeHtml(UNITC)} ${m.n}</span>
      <span class="chip" style="background:var(--${c.tag}-bg);color:var(--${c.tag})">${c.kind==='suggestion'?'<i class="ti ti-pencil" style="font-size:11px;vertical-align:-1px;margin-right:2px"></i>':''}${escapeHtml(c.tag)}</span>
      ${c.status && c.status !== 'open' ? `<span class="status" style="margin-left:auto">${escapeHtml(c.status)}</span>` : ''}</div>
    <div class="snip">"${escapeHtml((c.anchor.quote||'').slice(0,52))}"${c.created_ts?`<span class="cmeta"> · ${fmtDate(c.created_ts)}</span>`:''}</div>
    ${c.body?`<div class="body">${escapeHtml(c.body)}</div>`:''}`;
  card.style.cursor = 'pointer';
  card.onclick = () => { const seg = document.getElementById('wd-' + chapterId);
    const mark = seg && seg.querySelector(`.cmark[data-id="${c.id}"], .cmark-el[data-cid="${c.id}"], figure[data-cid="${c.id}"]`);
    (mark || seg)?.scrollIntoView({ behavior:'smooth', block:'center' });
    if (mark){ mark.classList.add('flash'); setTimeout(() => mark.classList.remove('flash'), 1500); } };
  return card;
}
// Create a comment in the whole-doc view: mutate ONLY the owning chapter's review + persist to its file.
function createWholeComment(chapterId, fields){
  if (!chapterId){ flash(`Couldn't tell which ${UNIT} that selection is in — try again.`); return; }
  const rev = routeWrite(_reviews, chapterId, id => loadLocalReview(id));
  _reviews[chapterId] = addComment(rev, fields);
  localStorage.setItem('review:' + chapterId, JSON.stringify(_reviews[chapterId]));
  paintWholeHighlights(); buildNavWhole(); renderWholeComments();
  pushChapterReview(chapterId);
}
// Persist one chapter's review to reviews/<id>.json in isolation (mirrors syncUp but never touches the
// global current/review/reviewSha — so a whole-doc write can't disturb single-chapter sync state).
async function pushChapterReview(chapterId){
  const t = tok(); if (!t) return;
  for (let attempt = 0; attempt < 5; attempt++){
    try {
      const { json, sha } = await getJson(t, reviewPath(chapterId));
      _reviews[chapterId] = reconcileReview(_reviews[chapterId], json, false);
      localStorage.setItem('review:' + chapterId, JSON.stringify(_reviews[chapterId]));
      await putJson(t, reviewPath(chapterId), _reviews[chapterId], sha, 'review: ' + chapterId, false);
      return;
    } catch(e){ if (/\b409\b/.test(e.message) && attempt < 4){ await new Promise(r => setTimeout(r, 250*(attempt+1))); continue; } return; }
  }
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
  const decided = p.approved.length + p.rejected.length + p.revise.length;
  const applyLabel = decided ? `Apply ${decided} decision${decided>1?'s':''}` : 'Apply decisions';
  bar.innerHTML = `${left}${prevBtn}<button class="btn btn-primary" id="merge-approved" ${decided?'':'disabled'}>${applyLabel}</button>`;
  read.prepend(bar);
  bar.querySelector('#merge-approved').onclick = approveChapter;
  bar.querySelector('#preview-btn').onclick = () => togglePreview(current);
}
async function approveChapter(){
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  const p = partitionByDecision(review.comments);
  const decided = p.approved.length + p.rejected.length + p.revise.length;
  if (!decided){ flash('Decide on at least one edit (approve, reject, or revise) first.'); return; }
  const lines = [];
  if (p.approved.length) lines.push(`${p.approved.length} approved edit(s) will be merged.`);
  if (p.rejected.length) lines.push(`${p.rejected.length} rejected edit(s) will be discarded.`);
  if (p.revise.length)   lines.push(`${p.revise.length} edit(s) will be re-queued for revision.`);
  if (!confirm(`Apply ${decided} decision(s) in ${unitLabel(chMeta(current), UNIT)}?\n` + lines.join('\n'))) return;
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
  // A merge job publishes approved edits AND cleans up the review branch after rejections. Queue it
  // whenever anything is approved or rejected; a revise-only pass leaves it to the apply-edits re-run.
  const needsMerge = p.approved.length || p.rejected.length;
  if (needsMerge && !jobs.some(j => j.type==='merge' && j.chapter===current && j.status==='queued'))
    jobs.push({ id:'j_'+Date.now().toString(36), type:'merge', chapter:current, status:'queued', requested_ts:new Date().toISOString() });
  await putJson(t, 'jobs.json', jobs, js, `review: apply decisions for ${current}`);
  const parts = [];
  if (p.approved.length) parts.push(`${p.approved.length} to merge`);
  if (p.rejected.length) parts.push(`${p.rejected.length} rejected`);
  if (p.revise.length)   parts.push(`${p.revise.length} to revise`);
  flash(`Applying ${decided} decision(s) — ${parts.join(', ')}. Footnote is processing…`);
  watchApplyRun(t);
  } catch(e){ flash('Queue failed — your decisions are saved on this device; please retry. ' + e.message, 5000); }
}
// After decisions are queued, follow the apply.yml run so a job never silently looks dead. Polls the
// run status (up to ~6 min), flashes plain-English progress, and re-syncs the review when it finishes
// so approved edits merge / rejected branches clear in the UI without a manual reload.
let _applyWatchGen = 0;
async function watchApplyRun(t){
  const gen = ++_applyWatchGen;                 // a newer watcher supersedes this one
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let lastLabel = null;
  for (let i = 0; i < 45; i++){
    await wait(8000);
    if (gen !== _applyWatchGen) return;         // superseded — stop polling
    let run = null; try { run = await applyRun(t); } catch { continue; }
    const label = applyRunLabel(run);
    if (label && label !== lastLabel){ flash('Footnote — ' + label, 4000); lastLabel = label; }
    if (run && run.status === 'completed'){
      if (run.conclusion === 'success'){
        try { const { json } = await getJson(t, reviewPath(current)); if (json){ review = reconcileReview(review, json, true); save(); renderComments(); if (document.getElementById('doc')){ paintHighlights(); refreshStaged(); } } } catch {}
        flash('Footnote finished processing your decisions.', 4000);
      } else if (label){ flash('Footnote — ' + label, 6000); }
      return;
    }
  }
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
    if (!html && t){ const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('preview/'+ch+'.html')}?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' }); if (r.ok) html = await r.text(); }
    if (!html){ flash(`No preview built yet for this ${UNIT}; it builds when changes are staged.`); return; }
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
// Invite links carry the project's data repo (&data=owner/repo) so an advisor — who has no hub access —
// lands in the right project. Harmless in single-project mode (same data repo).
// The shared reviewer access key, cached locally when the owner seals it (in the email/settings wizard),
// so the copy-link can embed it as &k= — a working magic link. Empty until a key is set; then links just work.
const advKeyStoreKey = () => `footnote:advkey:${DATA_REPO}`;
const advisorKey = () => { try { return localStorage.getItem(advKeyStoreKey()) || ''; } catch (e) { return ''; } };
// The shared reviewer key ALSO lives in the PRIVATE data repo (advisor/access-key.json) so the copy-link
// works on ANY owner browser — not only the one it was set on. localStorage is a fast cache;
// loadReviewerKeyIntoCache back-fills it from the repo on panel open. Private repo → Matt-approved storage.
const REVIEWER_KEY_FILE = 'advisor/access-key.json';   // repo-level: one shared key for the whole data repo
async function _kfetch(url, opts, ms = 12000){
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(timer); }
}
async function saveReviewerKeyToRepo(t, key){
  if (!t || !key) return;
  const url = `https://api.github.com/repos/${DATA_REPO}/contents/${REVIEWER_KEY_FILE}`;
  const hdr = { Authorization:`Bearer ${t}`, Accept:'application/vnd.github+json' };
  let sha;
  try { const r = await _kfetch(`${url}?t=${Date.now()}`, { headers: hdr, cache:'no-store' }); if (r.ok) sha = (await r.json()).sha; } catch (e) {}
  try {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify({ key }, null, 2))));
    await _kfetch(url, { method:'PUT', headers:{ ...hdr, 'Content-Type':'application/json' }, body: JSON.stringify({ message:'set reviewer access key', content, sha }) });
  } catch (e) {}
}
async function loadReviewerKeyIntoCache(t){
  try {
    if (!t || advisorKey()) return;   // localStorage already has it — nothing to do
    const r = await _kfetch(`https://api.github.com/repos/${DATA_REPO}/contents/${REVIEWER_KEY_FILE}?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (!r || !r.ok) return;
    const j = await r.json();   // raw → the file's JSON object
    if (j && j.key) { try { localStorage.setItem(advKeyStoreKey(), j.key); } catch (e) {} }
  } catch (e) {}
}
const advisorUrl = (id, name) => advisorInviteUrl(portalBase(), { id, name, dataRepo: DATA_REPO, projectId: _CFG.dataPrefix ? _CFG.projectId : '', accessKey: advisorKey() });
// Standalone "set the reviewer access key" — no email setup required. Caches the key locally so the
// copy-link becomes a working magic link immediately, and (best-effort) seals it as the ADVISOR_KEY
// secret so emailed invites carry it too. If the owner's sign-in can't write secrets, the local cache
// still makes shareable links work and we say how to enable it for email.
function openAccessKeySheet(ownerTok, onSaved){
  const repo = dataRepoParts(_CFG).repo;
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" style="max-width:520px">
    <div style="font-size:16px;font-weight:600;margin-bottom:4px">Reviewer access key</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px;line-height:1.55">This is your <b>Reviewer key</b> — one shared token that every reviewer's link carries, so they click and they're in — no code to paste. It gets emailed, so it must be <b>least-privilege</b>: <b>not</b> your Owner key or account password. Create a <a href="https://github.com/settings/personal-access-tokens/new?name=Footnote%20reviewer%20key" target="_blank" rel="noopener">fine-grained token</a> with access to <b>only</b> your Review repo <code>${escapeHtml(repo)}</code> and <b>Contents: Read and write</b>. On that page, set the <b>Expiration</b> dropdown (near the top) to <b>No expiration</b> so your reviewers' links never stop working.</div>
    <input id="ak-input" type="password" placeholder="paste the reviewer access token" style="width:100%;box-sizing:border-box;padding:9px 10px;border:.5px solid var(--border);border-radius:8px;font:inherit;font-size:12.5px">
    <div id="ak-stat" style="font-size:12px;color:var(--text-3);margin-top:10px;min-height:16px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="ak-cancel">Cancel</button>
      <button class="btn btn-primary" id="ak-save">Save key</button>
    </div></div>`;
  document.body.appendChild(scrim);
  const $ = s => scrim.querySelector(s);
  const close = () => scrim.remove();
  scrim.onclick = e => { if (e.target === scrim) close(); };
  $('#ak-cancel').onclick = close;
  $('#ak-save').onclick = async () => {
    const val = ($('#ak-input').value || '').trim();
    const stat = $('#ak-stat');
    if (!val){ stat.textContent = 'Paste a token first.'; return; }
    try { localStorage.setItem(advKeyStoreKey(), val); } catch (e) {}   // 1) local cache → copy-link magic link
    saveReviewerKeyToRepo(ownerTok, val);                                // 2) durable: private-repo copy so any browser's copy-link works
    stat.textContent = 'Saving…';
    try {                                                               // 2) best-effort seal → email invites
      const pk = await getPublicKey(ownerTok);
      await putSecret(ownerTok, pk, sealToBase64, 'ADVISOR_KEY', val);
      stat.innerHTML = 'Saved. Reviewer links now sign reviewers in, and email invites carry the key.';
    } catch (e) {
      stat.innerHTML = isScopeError(e)
        ? 'Saved for shareable links. To also send it in <b>email</b> invites, connect email — that step uses a token that can write secrets.'
        : 'Saved for shareable links. (Couldn’t seal it for email: ' + escapeHtml((e && e.message) || 'error') + '.)';
    }
    setTimeout(() => { close(); if (onSaved) { try { onSaved(); } catch (e) {} } }, 2400);
  };
  setTimeout(() => { const i = $('#ak-input'); if (i) i.focus(); }, 30);
}
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
  menu.style.cssText = 'position:absolute;top:50px;right:52px;z-index:45;background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-md);box-shadow:0 10px 30px rgba(0,0,0,.16);padding:6px;min-width:248px;max-width:340px';
  const open = review.comments.filter(c => c.status === 'open').length;
  // The run-agents row lists the configured agents; cap the list so it never stretches the menu wide.
  const _rvAgents = _CFG.reviewAgents || [];
  const _rvLabel = _rvAgents.length > 5 ? `${_rvAgents.slice(0, 5).join(', ')} +${_rvAgents.length - 5} more` : _rvAgents.join(', ');
  // Which rows to show is gated by the master AI switch: when the assistant is OFF, sendMenuActions
  // returns ONLY 'export' — no Claude-dependent Apply-edits or Run-agents rows (the deterministic
  // apply-direct path stays on the per-comment pencil editor). When ON it adds apply-edits, and
  // run-agents only when the instance configures reviewAgents. Single source of truth in config.js.
  const rowFor = {
    'apply-edits': `<div class="smi" data-type="apply-edits"><i class="ti ti-git-pull-request"></i><div><div style="font-weight:500">Apply edits${open?` · ${open}`:''}</div><div class="smi-d">stage LaTeX edits on review-edits/${current}</div></div></div>`,
    'run-agents': `<div class="smi" data-type="run-agents"><i class="ti ti-robot-face"></i><div style="min-width:0"><div style="font-weight:500">Run review agents</div><div class="smi-d" style="overflow-wrap:anywhere">${escapeHtml(_rvLabel)} · read-only critique</div></div></div>`,
    'export': `<div class="smi" data-type="export"><i class="ti ti-file-export"></i><div><div style="font-weight:500">Export this ${UNIT}…</div><div class="smi-d">Word · Markdown, with comments</div></div></div>`,
  };
  // Cloud mode: a reopen entry for the live "Cloud activity" view, so closing it isn't a dead end —
  // the last cloud job id is remembered per project (localStorage) and survives a reload.
  const _lastCloud = processingMode(_CFG) === 'cloud' ? localStorage.getItem('footnote:lastcloud:' + (_projectId || DATA_REPO)) : null;
  const cloudRow = _lastCloud ? `<div class="smi" data-type="cloud-activity"><i class="ti ti-activity-heartbeat"></i><div><div style="font-weight:500">Cloud activity</div><div class="smi-d">watch / review the latest cloud job</div></div></div>` : '';
  menu.innerHTML = cloudRow + sendMenuActions(assistantOn(), _CFG.reviewAgents).map(a => rowFor[a]).join('');
  document.body.appendChild(menu);
  menu.querySelectorAll('.smi').forEach(el => { el.onmouseenter = () => el.style.background='var(--bg-3)'; el.onmouseleave = () => el.style.background='transparent';
    el.onclick = () => { menu.remove(); if (el.dataset.type === 'export') exportDialog(current); else if (el.dataset.type === 'cloud-activity') openCloudActivity(_lastCloud); else if (el.dataset.type === 'run-agents') agentPickerDialog(current); else sendJob(el.dataset.type); }; });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='btn-send' && !e.target.closest?.('#btn-send')){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
// Live "watch it work" view for a cloud review job. Polls <prefix>progress/<job>.jsonl every ~2.5s and
// renders a narrated, per-comment activity feed (the say lines are primary; a "details" toggle shows the
// raw machine fields). Stops on a terminal done/error event. Serverless — just the data-repo + token.
function openCloudActivity(jobId){
  if (!jobId) return;
  try { localStorage.setItem('footnote:lastcloud:' + (_projectId || DATA_REPO), jobId); } catch (e) {}   // reopenable later
  document.getElementById('cloud-activity')?.remove();
  const panel = document.createElement('div'); panel.id = 'cloud-activity';
  panel.style.cssText = 'position:fixed;top:0;right:0;height:100vh;width:min(460px,92vw);z-index:60;background:var(--bg);border-left:.5px solid var(--border-2);box-shadow:-14px 0 44px rgba(0,0,0,.14);display:flex;flex-direction:column';
  panel.innerHTML = `<div style="padding:13px 16px;border-bottom:.5px solid var(--border);display:flex;align-items:center;gap:9px">
      <i class="ti ti-robot-face" style="font-size:18px;flex-shrink:0"></i><b style="flex:1;white-space:nowrap">Cloud activity</b>
      <label style="font-size:11px;color:var(--text-3);display:flex;align-items:center;gap:4px"><input type="checkbox" id="ca-debug">details</label>
      <button class="btn" id="ca-stop" style="padding:3px 10px;color:var(--warn);border-color:var(--warn);display:inline-flex;align-items:center;gap:3px"><i class="ti ti-player-stop"></i>Stop</button>
      <button class="btn" id="ca-x" style="padding:3px 10px">Close</button></div>
    <div style="padding:9px 16px 8px;border-bottom:.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <div id="ca-head" style="flex:1;min-width:0;font-size:12.5px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Waiting for the cloud job to start…</div>
        <a id="ca-usage" href="https://claude.ai/settings/usage" target="_blank" rel="noopener" style="font-size:11px;color:var(--text-3);white-space:nowrap;flex-shrink:0;text-decoration:none"></a></div>
      <div id="ca-usagenote" style="font-size:10.5px;color:var(--text-3);margin-top:5px;display:none;line-height:1.4">Tokens are this run only. Your real remaining credits (5-hour / weekly) live in your <a href="https://claude.ai/settings/usage" target="_blank" rel="noopener" style="color:var(--accent,#2c64c4)">Claude usage settings ↗</a>.</div>
      <div id="ca-gauge" style="height:3px;border-radius:2px;background:var(--bg-3,#eef);margin-top:7px;display:none;overflow:hidden"><div id="ca-gaugefill" style="height:100%;width:0;background:var(--accent,#2c64c4);transition:width .35s ease"></div></div></div>
    <div id="ca-feed" style="flex:1;overflow:auto;padding:8px 12px"></div>`;
  document.body.appendChild(panel);
  let stop = false, debug = false, lastEvents = [], stopping = false;
  panel.querySelector('#ca-x').onclick = () => { stop = true; panel.remove(); };
  panel.querySelector('#ca-debug').onchange = e => { debug = e.target.checked; render(lastEvents); };
  panel.querySelector('#ca-stop').onclick = async () => {
    const btn = panel.querySelector('#ca-stop');
    if (!confirm('Stop this cloud job now? Work already staged is kept; anything in progress is cancelled.')) return;
    btn.disabled = true; btn.textContent = 'Stopping…'; stopping = true;
    try {
      const run = await applyRun(tok());
      if (run && (run.status === 'in_progress' || run.status === 'queued')) { await cancelRun(tok(), run.id); flash('Stopping the cloud job — this can take a few seconds.'); }
      else { flash('No running cloud job to stop (it may have already finished).'); }
    } catch(e){ flash(isScopeError(e) ? 'Your access token needs Actions access to stop a run.' : 'Couldn’t stop: ' + ((e && e.message) || 'error')); btn.disabled = false; btn.innerHTML = '<i class="ti ti-player-stop"></i>Stop'; stopping = false; }
  };
  if (!document.getElementById('ca-css')) {
    const st = document.createElement('style'); st.id = 'ca-css';
    st.textContent = '@keyframes caspin{to{transform:rotate(360deg)}}.ca-spin{display:inline-block;animation:caspin 1.1s linear infinite}';
    document.head.appendChild(st);
  }
  const dot = s => s === 'conflict' ? '<span style="color:var(--warn)">⚠</span>'
    : s === 'ok' ? '<span style="color:var(--success)">✓</span>'
    : '<span class="ca-spin" style="color:var(--accent,#2c64c4)">◜</span>';
  // job-level narration (opening line, budget stop, done) — a thin muted row
  const jobRow = e => `<div style="display:flex;gap:8px;padding:3px 2px;font-size:12px;color:${e.status === 'conflict' ? 'var(--warn)' : 'var(--text-3)'}">
      <span style="width:14px;text-align:center;flex-shrink:0">${e.phase === 'done' ? '✓' : e.status === 'conflict' ? '⚠' : '·'}</span>
      <span style="min-width:0">${escapeHtml(e.say || '')}</span></div>`;
  const fList = fs => !fs || !fs.length ? '' : `<div style="margin-top:6px;display:grid;gap:5px;padding-left:22px">${fs.map(f => `
      <div style="display:flex;gap:7px;font-size:11.5px;line-height:1.45">
        ${f.tag ? `<span style="flex-shrink:0;font-size:9px;text-transform:uppercase;letter-spacing:.04em;background:var(--bg-3,#eef);color:var(--text-3);padding:1px 6px;border-radius:5px;height:fit-content;margin-top:1px">${escapeHtml(f.tag)}</span>` : ''}
        <span style="color:var(--text-2)">${escapeHtml(f.text || '')}</span></div>`).join('')}</div>`;
  const editToggle = e => e.edit && (e.edit.before || e.edit.after) ? `<details style="margin:4px 0 0 22px"><summary style="cursor:pointer;color:var(--text-3);font-size:11px">show diff</summary><div style="font-family:var(--mono);font-size:11px;white-space:pre-wrap;margin-top:3px"><span style="color:var(--warn)">- ${escapeHtml(e.edit.before || '')}</span>\n<span style="color:var(--success)">+ ${escapeHtml(e.edit.after || '')}</span></div></details>` : '';
  const statusWord = g => g.status === 'running' ? 'working…' : g.status === 'conflict' ? 'flagged' : 'done';
  // one COLLAPSIBLE card per subject (agent or comment): the header is the <summary>; expand for the
  // findings (agents) or the narrated steps + diff (comments). Open by default so insight is visible; the
  // user can collapse a card once they've read it.
  const cardBody = g => g.kind === 'agent'
    ? (g.findings.length ? fList(g.findings)
       : `<div style="font-size:11.5px;color:var(--text-3);margin-top:3px;padding-left:22px">${escapeHtml((g.last && g.last.say) || (g.status === 'running' ? 'thinking…' : ''))}</div>`)
    : g.events.filter(e => e.phase !== 'read').map(e => `<div style="font-size:11.5px;color:var(--text-2);margin-top:3px;padding-left:22px">${e.agent ? `<b style="font-weight:600">${escapeHtml(e.agent)}</b> · ` : ''}${escapeHtml(e.say || '')}</div>${editToggle(e)}`).join('');
  const card = g => `<details ${g.status === 'running' ? 'open' : (g.findings.length || g.kind === 'comment' ? 'open' : '')} style="margin:7px 0;border:.5px solid var(--border);border-radius:10px;background:var(--bg);overflow:hidden">
      <summary style="list-style:none;cursor:pointer;padding:9px 11px;display:flex;gap:8px;align-items:center">
        <span style="width:14px;text-align:center;flex-shrink:0">${dot(g.status)}</span>
        <b style="font-size:12.5px">${escapeHtml(g.key)}</b>
        ${g.findings.length ? `<span style="font-size:10.5px;color:var(--text-3);background:var(--bg-3,#eef);border-radius:9px;padding:0 6px">${g.findings.length}</span>` : ''}
        <span style="font-size:10.5px;color:var(--text-3);margin-left:auto;text-transform:uppercase;letter-spacing:.03em">${statusWord(g)}</span></summary>
      <div style="padding:0 11px 9px">${cardBody(g)}
      ${debug ? `<div style="font-family:var(--mono);font-size:10px;color:var(--text-3);padding-left:22px;margin-top:4px">${escapeHtml(JSON.stringify(g.events.map(e => ({ seq: e.seq, phase: e.phase, status: e.status }))))}</div>` : ''}</div></details>`;
  function render(events){
    lastEvents = events;
    panel.querySelector('#ca-head').textContent = summaryLine(events) || 'Working…';
    const u = usageTotals(events), chip = panel.querySelector('#ca-usage'), note = panel.querySelector('#ca-usagenote');
    if (chip){ chip.textContent = usageLine(u); chip.title = usageCostNote(u); chip.style.color = (u && u.errors) ? 'var(--warn)' : 'var(--text-3)'; }
    if (note) note.style.display = u ? 'block' : 'none';
    const gg = usageGauge(u), bar = panel.querySelector('#ca-gauge'), fill = panel.querySelector('#ca-gaugefill');
    if (bar && fill){
      if (gg){ bar.style.display = 'block'; fill.style.width = gg.pct + '%'; fill.style.background = gg.level === 'high' ? 'var(--warn)' : gg.level === 'warn' ? '#c9a227' : 'var(--accent,#2c64c4)'; bar.title = `${gg.label} — the per-job budget cap (raise it in Settings)`; }
      else bar.style.display = 'none';
    }
    // Stop button: shown while the run is live; hidden once the job reaches a terminal event or is stopping
    const done = isTerminal(events), sbtn = panel.querySelector('#ca-stop');
    if (sbtn) sbtn.style.display = (done || stopping) ? 'none' : 'inline-flex';
    const g = groupStream(events);
    panel.querySelector('#ca-feed').innerHTML = g.jobEvents.map(jobRow).join('') + g.groups.map(card).join('');
  }
  async function poll(){
    if (stop) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('progress/' + jobId + '.jsonl')}?t=${Date.now()}`,
        { headers: { Authorization: `Bearer ${tok()}`, Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
      if (r.ok){ const evs = parseEvents(await r.text()); render(evs); if (isTerminal(evs)){ stop = true; return; } }
    } catch(e){}
    if (!stop) setTimeout(poll, 2500);
  }
  poll();
}

async function sendJob(type){
  const t = tok(); if (!t){ flash(`Add your access token first (click a ${UNIT} → connect).`); return; }
  try {
    await syncUp();
    const { json, sha } = await getJson(t, 'jobs.json');
    const jobs = Array.isArray(json) ? json : [];
    if (type === 'run-agents'){
      flash('Requesting agent review…');
      jobs.push({ id:'j_'+Date.now().toString(36), type:'run-agents', chapter:current,
        agents:_CFG.reviewAgents, field:(_CFG.doc && _CFG.doc.field) || '',
        status:'queued', requested_ts:new Date().toISOString() });
      await putJson(t, 'jobs.json', jobs, sha, 'review: agents '+current);
      flash(`Requested adversary review of ${unitLabel(chMeta(current), UNIT)}`);
      return;
    }
    const open = review.comments.filter(c => c.status === 'open');
    if (!open.length){ flash('No open comments to send.'); return; }
    flash('Sending…');
    const jid = 'j_'+Date.now().toString(36);
    jobs.push({ id:jid, type:'apply-edits', chapter:current,
      comment_ids: open.map(c => c.id), review_agents:_CFG.reviewAgents, field:(_CFG.doc && _CFG.doc.field) || '',
      status:'queued', requested_ts:new Date().toISOString() });
    await putJson(t, 'jobs.json', jobs, sha, 'review: queue '+current);
    open.forEach(c => { review = updateComment(review, c.id, { status:'queued' }); });
    save(); await syncUp(); renderComments(); buildNav(); paintHighlights();
    flash(`Queued ${open.length} comment${open.length>1?'s':''} → review-edits/${current}`);
    // Cloud mode: open the live "watch it work" view so the user sees the agents process each comment.
    if (processingMode(_CFG) === 'cloud') openCloudActivity(jid);
  } catch(e){ flash('Send failed: '+e.message); }
}
function flash(msg){ const t = document.createElement('div'); t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:9px 16px;border-radius:20px;font-size:13px;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.2)';
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
// Like flash, but with an Undo action that stays up longer so an accidental removal is recoverable.
function undoToast(msg, onUndo){
  document.getElementById('undo-toast')?.remove();
  const t = document.createElement('div'); t.id = 'undo-toast';
  t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:9px 10px 9px 16px;border-radius:20px;font-size:13px;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.2);display:flex;align-items:center;gap:10px';
  const label = document.createElement('span'); label.textContent = msg;
  const btn = document.createElement('button'); btn.textContent = 'Undo';
  btn.style.cssText = 'background:none;border:none;color:var(--bg);font:inherit;font-weight:600;text-decoration:underline;cursor:pointer;padding:2px 6px';
  btn.onclick = () => { t.remove(); onUndo(); };
  t.append(label, btn); document.body.appendChild(t);
  setTimeout(() => t.remove(), 8000);
}
// ---------- export: chapter / document -> Word · Markdown, with comments ----------
function exportDialog(scope){
  document.getElementById('expdlg')?.remove();
  const whole = scope === '__all__';
  const title = whole ? `the whole ${DOC}` : `${unitLabel(chMeta(scope), UNIT)} · ${escapeHtml(shortTitle(chMeta(scope).title))}`;
  const back = document.createElement('div'); back.id = 'expdlg';
  back.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center';
  back.innerHTML = `<div class="expcard" style="background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-lg);box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(460px,92vw);padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:3px">Export ${title}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Built by the real pipeline (pandoc + LaTeX) with comments and attribution. Runs in the cloud and appears under Downloads when ready.</div>
      <div class="exp-sec">Formats</div>
      <label class="exp-row"><input type="checkbox" class="exp-fmt" value="docx" checked> Word (.docx) — native comments + tracked changes</label>
      <label class="exp-row"><input type="checkbox" class="exp-fmt" value="md" checked> Markdown</label>
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

// Pick which review agents run over the CURRENT chapter (a subset of the configured reviewAgents), so
// you can target one critic instead of the whole panel. The engine already honors job.agents.
async function agentPickerDialog(scope){
  const agents = _CFG.reviewAgents || [];
  if (!agents.length){ flash('No review agents are configured for this project.'); return; }
  document.getElementById('agdlg')?.remove();
  const title = `${unitLabel(chMeta(scope), UNIT)} · ${escapeHtml(shortTitle(chMeta(scope).title))}`;
  const back = document.createElement('div'); back.id = 'agdlg';
  back.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center';
  const shell = rows => `<div class="expcard" style="background:var(--bg);border:.5px solid var(--border-2);border-radius:var(--r-lg);box-shadow:0 18px 50px rgba(0,0,0,.28);width:min(500px,94vw);max-height:88vh;display:flex;flex-direction:column;padding:20px 22px">
      <div style="font-size:16px;font-weight:600;margin-bottom:3px">Run review agents</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Read-only critique of ${title}. Each selected agent appends its findings as comments.</div>
      ${rows}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-shrink:0">
        <button class="btn" id="ag-cancel">Cancel</button>
        <button class="btn btn-primary" id="ag-go" disabled><i class="ti ti-robot-face"></i>Run selected</button></div>
      <div id="ag-stat" style="font-size:12px;color:var(--text-3);margin-top:8px;flex-shrink:0"></div></div>`;
  back.innerHTML = shell(`<div style="font-size:12px;color:var(--text-3);padding:14px 0">Loading agents…</div>`);
  document.body.appendChild(back);
  back.onclick = e => { if (e.target === back) back.remove(); };
  back.querySelector('#ag-cancel').onclick = () => back.remove();

  // Load the catalog so we can show real names/descriptions and only offer CLOUD-runnable critics —
  // doers (writer/…) and the user's local specialized agents can't run here (engine skips them).
  const catalog = await loadAgentCatalog(tok(), _CFG).catch(() => []);
  if (!document.body.contains(back)) return;                       // cancelled while loading
  const { runnable, localOnly } = splitAgentsForCloud(catalog, agents);

  const row = a => `<label class="ag-item" style="display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:.5px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer">
      <input type="checkbox" class="ag-a" value="${escapeHtml(a.id)}" checked style="margin-top:2px">
      <span style="flex:1;min-width:0">
        <span style="font-weight:600;font-size:12.5px">${escapeHtml(a.displayName)}</span>
        ${a.description ? `<span style="display:block;font-size:11px;color:var(--text-3);margin-top:2px;line-height:1.4">${escapeHtml(a.description)}</span>` : ''}
      </span></label>`;
  const localNote = localOnly.length
    ? `<div style="margin-top:12px;font-size:11px;color:var(--text-3);line-height:1.5;border-top:.5px solid var(--border);padding-top:10px">
        <i class="ti ti-device-laptop" style="font-size:12px;margin-right:3px"></i>${localOnly.length} agent${localOnly.length===1?'':'s'} run on your machine (local runner), not in the cloud, so ${localOnly.length===1?'it is':'they are'} not shown here: ${localOnly.map(a=>escapeHtml(a.displayName)).join(', ')}.</div>`
    : '';
  const body = runnable.length
    ? `<div style="display:flex;gap:8px;margin-bottom:8px;flex-shrink:0"><button class="btn" id="ag-all" style="padding:2px 8px;font-size:11px">All</button><button class="btn" id="ag-none" style="padding:2px 8px;font-size:11px">None</button><span id="ag-count" style="align-self:center;font-size:11px;color:var(--text-3);margin-left:auto"></span></div>
       <div style="display:grid;gap:6px;overflow:auto;min-height:0">${runnable.map(row).join('')}</div>${localNote}`
    : `<div style="font-size:12.5px;color:var(--text-2);padding:6px 0">None of this project's configured agents can run in the cloud.${localNote}</div>`;
  back.innerHTML = shell(body);
  back.onclick = e => { if (e.target === back) back.remove(); };
  const q = s => back.querySelector(s), boxes = () => [...back.querySelectorAll('.ag-a')];
  const refresh = () => { const n = boxes().filter(b=>b.checked).length; const c = q('#ag-count'); if (c) c.textContent = `${n} selected`; q('#ag-go').disabled = !n; };
  q('#ag-cancel').onclick = () => back.remove();
  if (q('#ag-all')) q('#ag-all').onclick = () => { boxes().forEach(b => b.checked = true); refresh(); };
  if (q('#ag-none')) q('#ag-none').onclick = () => { boxes().forEach(b => b.checked = false); refresh(); };
  boxes().forEach(b => b.onchange = refresh);
  refresh();
  q('#ag-go').onclick = async () => {
    const picked = boxes().filter(b => b.checked).map(b => b.value);
    if (!picked.length){ q('#ag-stat').textContent = 'Pick at least one agent.'; return; }
    q('#ag-stat').textContent = 'Queuing…'; q('#ag-go').disabled = true;
    try {
      const jid = await queueRunAgents(scope, picked);
      q('#ag-stat').textContent = `Queued ${picked.length} agent(s) ✓ — findings will appear as comments in a few minutes.`;
      flash(`Requested review of ${unitLabel(chMeta(scope), UNIT)} by ${picked.length} agent(s)`);
      back.remove();
      if (jid && processingMode(_CFG) === 'cloud') openCloudActivity(jid);   // watch it live + usage, like apply-edits
    } catch(e){ q('#ag-stat').textContent = 'Failed: ' + e.message; q('#ag-go').disabled = false; }
  };
}
async function queueRunAgents(scope, agents){
  const t = tok(); if (!t) throw new Error('add your access token first');
  await syncUp();
  const { json, sha } = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(json) ? json : [];
  const jid = 'j_'+Date.now().toString(36);
  jobs.push({ id:jid, type:'run-agents', chapter:scope,
    agents, field:(_CFG.doc && _CFG.doc.field) || '', status:'queued', requested_ts:new Date().toISOString() });
  await putJson(t, 'jobs.json', jobs, sha, `review: agents ${scope} (${agents.length})`);
  return jid;
}
// all export jobs (done + in-flight), newest first — for the home Downloads section
async function listExports(){
  const t = tok(); if (!t) return [];
  const { json } = await getJson(t, 'jobs.json').catch(() => ({ json:null }));
  return (Array.isArray(json) ? json : []).filter(j => j.type === 'export')
    .sort((a,b) => (b.requested_ts||'').localeCompare(a.requested_ts||''));
}
const _expOpen = new Set();   // which chapter groups are expanded (persists within the session)
const FMT_NAME = { docx:'Word', md:'Markdown' };   // pdf removed — export is docx/md only
// Home Downloads: grouped by chapter, collapsible, versioned, with pending state + delete.
async function renderHomeDownloads(){
  const box = document.getElementById('home-downloads'); if (!box) return;
  const jobs = await listExports();
  const header = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div class="home-allch" style="margin:0">DOWNLOADS</div>
      <button class="btn" id="dl-export-all" style="margin-left:auto;padding:5px 11px;font-size:12px"><i class="ti ti-file-export"></i>Export whole ${DOC}…</button></div>`;
  if (!jobs.length){ box.innerHTML = header + `<div style="font-size:12.5px;color:var(--text-3)">No exports yet. Use a ${UNIT}'s “…” menu → Export, or the button above.</div>`;
    box.querySelector('#dl-export-all').onclick = () => exportDialog('__all__'); return; }
  // group by scope (chapter id or __all__)
  const groups = {};
  for (const j of jobs){ (groups[j.chapter] ||= []).push(j); }
  const order = Object.keys(groups).sort((a,b) => (a==='__all__'?99:chMeta(a).n) - (b==='__all__'?99:chMeta(b).n));
  box.innerHTML = header + order.map(scope => {
    const list = groups[scope];
    const name = scope === '__all__' ? `Whole ${DOC}` : `${unitLabel(chMeta(scope), UNIT)} · ${escapeHtml(shortTitle(chMeta(scope).title))}`;
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
  try { const url = `https://api.github.com/repos/${DATA_REPO}/contents/${dpath(path)}?t=${Date.now()}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
    if (!r.ok) throw new Error('GitHub '+r.status);
    blob = await r.blob();
  } catch(e){ flash('Download failed: ' + e.message); return; }
  await saveBlob(blob, path.split('/').pop()); flash('Saved ✓');
}
function restoreCursor(){ if (review.cursor?.sec){ document.getElementById(review.cursor.sec)?.scrollIntoView(); } }

// ---------- home / chapter library ----------
const DEFENSE = _CFG.deadline ? _CFG.deadline.date : null;
const daysToDefense = () => Math.max(0, Math.ceil((new Date(DEFENSE) - new Date()) / 86400000));
function chapterStats(ch){
  const r = JSON.parse(localStorage.getItem('review:'+ch) || 'null');
  const p = readProgress(r);   // shared read-progress derivation (parity with reviewer cards)
  return { open: r ? r.comments.filter(c=>c.status==='open').length : 0,
           merged: r ? r.comments.filter(c=>c.status==='merged').length : 0,
           total: r ? r.comments.length : 0,
           checked: p.doneN, sec: p.secN, frac: p.frac, readDone: p.done };
}
function enterHome(){
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<a href="./index.html" title="Your projects" style="text-decoration:none;color:inherit;display:inline-flex;align-items:center;gap:8px"><svg width="20" height="20" viewBox="0 0 52 52" style="flex:0 0 auto"><rect x="3" y="3" width="46" height="46" rx="12" fill="${_CFG.brand.accent}"/><line x1="19" y1="14" x2="19" y2="38" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="26" y1="18" x2="38" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><line x1="26" y1="26" x2="38" y2="26" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="19" cy="26" r="4.6" fill="#fff"/></svg><strong style="font-size:16px;font-weight:600">${escapeHtml(_CFG.brand.name)}</strong></a>
     ${_CFG.deadline ? `<span style="margin-left:auto;font-size:12.5px;color:var(--text-2);display:inline-flex;align-items:center;gap:6px"><i class="ti ti-flag"></i>${escapeHtml(_CFG.deadline.label || 'deadline')} in ${daysToDefense()} days</span>` : ''}
     <button class="btn" id="btn-outline" style="padding:6px 12px${_CFG.deadline?'':';margin-left:auto'}" title="Proposed outline (what reviewers see)"><i class="ti ti-list-tree"></i>Outline</button>
     <button class="btn" id="btn-export-menu" style="padding:6px 12px" title="Take your reviewers' comments to Overleaf, or into a response letter"><i class="ti ti-file-export"></i>Export<i class="ti ti-chevron-down" style="margin-left:3px;font-size:13px;color:var(--text-3)"></i></button>
     <button class="btn" id="btn-releases" style="padding:6px 12px"><i class="ti ti-users"></i>Reviewers</button>
     <button class="btn" id="btn-settings-h" style="padding:6px 12px"><i class="ti ti-settings"></i>Settings</button>
     <button class="icbtn" id="btn-tour" title="Take the tour"><i class="ti ti-help-circle"></i></button>
     <a class="icbtn" href="./index.html" title="Back to dashboard"><i class="ti ti-layout-dashboard"></i></a>
     <button class="icbtn" id="btn-theme"><i class="ti ti-moon"></i></button>`;
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-releases').onclick = openReleasePanel;
  document.getElementById('btn-settings-h').onclick = () => openSettingsPage();
  document.getElementById('btn-export-menu').onclick = openExportMenu;
  document.getElementById('btn-outline').onclick = loadOwnerOutline;
  document.getElementById('btn-tour').onclick = openTourMenu;
  read.innerHTML = homeHtml();
  read.querySelectorAll('.chcard[data-ch], .btn[data-ch]').forEach(el => el.onclick = () => enterChapter(el.dataset.ch));
  const imp = document.getElementById('import-doc');
  if (imp) imp.onclick = () => localStorage.getItem('ghpat') ? importDocument() : openSettingsPage('access');
  refreshInbox();
  renderHomeDownloads();
  refreshSetup();
  refreshEmptyState();
}
// ---------- take reviewer feedback back to Overleaf ----------
function ensureOverleafPanel(){
  let ov = document.getElementById('ovl-back');
  if (ov) return ov;
  ov = document.createElement('div'); ov.id = 'ovl-back'; ov.className = 'ovl-back'; ov.hidden = true;
  ov.innerHTML = `<div class="ovl-panel" role="dialog" aria-label="Take to Overleaf">
    <div class="ovl-head">
      <b>Take reviewer feedback to Overleaf</b>
      <div class="ovl-actions">
        <button class="btn" id="ovl-copy" style="padding:5px 10px;font-size:12px"><i class="ti ti-copy"></i>Copy all as Markdown</button>
        <button class="btn" id="ovl-download" style="padding:5px 10px;font-size:12px"><i class="ti ti-download"></i>Download .md</button>
        <button class="btn" id="ovl-print" style="padding:5px 10px;font-size:12px"><i class="ti ti-printer"></i>Print</button>
        <button class="icbtn" id="ovl-close" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
    </div>
    <p class="ovl-sub">Each item shows where to edit in your <code>.tex</code> and what to change. Search the quoted text in Overleaf; tick items off as you go.</p>
    <div id="ovl-body" class="ovl-body"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.hidden = true; });
  document.getElementById('ovl-close').onclick = () => { ov.hidden = true; };
  document.getElementById('ovl-copy').onclick = async () => {
    const md = ov.dataset.md || '';
    try { await navigator.clipboard.writeText(md); flash('Worklist copied to clipboard ✓'); }
    catch { const ta = document.createElement('textarea'); ta.value = md; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); flash('Worklist copied ✓'); }
  };
  document.getElementById('ovl-download').onclick = () => {
    const md = ov.dataset.md || ''; const stamp = new Date().toISOString().slice(0, 10);
    const base = (_CFG.doc && _CFG.doc.title) || (_CFG.brand && _CFG.brand.name) || 'document';
    const name = `${base.replace(/[^\w-]+/g, '-').toLowerCase()}-overleaf-worklist-${stamp}.md`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  document.getElementById('ovl-print').onclick = () => window.print();
  document.getElementById('ovl-body').addEventListener('change', onOverleafToggle);
  return ov;
}

async function onOverleafToggle(e){
  const cb = e.target.closest('.ovl-cb'); if (!cb) return;
  const item = cb.closest('.ovl-item'); const cid = item.dataset.cid, ch = item.dataset.ch;
  const actioned = cb.checked; item.classList.toggle('done', actioned);
  try {
    const t = tok();
    const { json, sha } = await getJson(t, reviewPath(ch));
    if (!json) throw new Error('review not found');
    const next = updateComment(json, cid, { actioned });
    await putJson(t, reviewPath(ch), next, sha, `worklist: ${actioned ? 'actioned' : 'reopened'} ${cid} in ${ch}`, false);
    await openOverleafPanel();   // rebuild from source of truth so counts + copyable Markdown stay in sync
  } catch (err) {
    cb.checked = !actioned; item.classList.toggle('done', !actioned);
    flash('Could not save: ' + err.message);
  }
}

async function openOverleafPanel(){
  const t = tok(); const ov = ensureOverleafPanel();
  const body = document.getElementById('ovl-body');
  body.innerHTML = `<div class="ovl-empty">Loading…</div>`;
  ov.hidden = false;
  const chapters = CHAPTERS || [];
  const reviews = {};
  await Promise.all(chapters.map(async ch => {
    try { const { json } = await getJson(t, reviewPath(ch.id)); if (json) reviews[ch.id] = json; }
    catch(e){ /* missing review file for a chapter is normal; skip */ }
  }));
  const wl = buildWorklist(chapters, reviews, _CFG);
  const body2 = document.getElementById('ovl-body');
  body2.innerHTML = wl.length ? worklistToHtml(wl, escapeHtml) : `<div class="ovl-empty">No open comments — you're all caught up.</div>`;
  ov.dataset.md = worklistToMarkdown(wl, { docTitle: (_CFG.doc && _CFG.doc.title) || (_CFG.brand && _CFG.brand.name) || 'document', generatedTs: new Date().toISOString() });
}

// ---------- proposed outline (read-only view of what advisors see) ----------
async function loadOwnerOutline(){
  current = '__outline__'; review = loadLocalReview('__outline__'); localStorage.setItem('lastChapter', '__outline__');
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = '';
  document.getElementById('topbar').innerHTML = `<button class="icbtn" id="ol-back" title="Home"><i class="ti ti-arrow-left"></i></button>
    <strong style="font-size:15px;font-weight:600;margin-left:4px">Proposed outline</strong>
    <button class="btn btn-primary" id="btn-send" style="margin-left:auto">${assistantOn() ? '<i class="ti ti-send"></i>Send to Claude' : '<i class="ti ti-git-pull-request"></i>Review actions'}</button>
    <span class="pm-pill" title="${processingMode(_CFG) === 'cloud' ? 'Click to watch cloud activity' : 'Review processing: local'}" style="align-self:center;margin-left:8px;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;${processingMode(_CFG) === 'cloud' ? 'background:var(--accent,#2c64c4);color:#fff;cursor:pointer' : 'background:var(--bg-3,#eef);color:var(--text-3)'}">${modePill(_CFG.processingMode).label}${processingMode(_CFG) === 'cloud' ? ' ◵' : ''}</span>
    <button class="icbtn" id="btn-refresh" title="Refresh — keeps your place"><i class="ti ti-refresh"></i></button>
    <button class="icbtn" id="btn-theme"><i class="ti ti-moon"></i></button>`;
  document.getElementById('ol-back').onclick = enterHome;
  document.getElementById('btn-send').onclick = openSendMenu;   // structure comments → apply-edits on review-edits/__outline__ (parity with chapters)
  document.getElementById('btn-theme').onclick = toggleTheme;
  read.innerHTML = `<div class="empty">Loading outline…</div>`;
  let data = null; const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  try {
    if (dev){ const r = await fetch('./outline.json'); if (r.ok) data = await r.json(); }
    if (!data){ const t = tok(); if (t){ const got = await getJson(t, 'outline.json'); data = got.json; } }
  } catch(e){}
  if (!data){ read.innerHTML = `<div class="empty">Couldn't load the outline. Open a ${UNIT} once to connect your token, then retry.</div>`; return; }
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
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:16px">This is what reviewers and lab reviewers see. Comment on any node to leave yourself a note; their outline comments land in your inbox. Edit the structure by updating <code>outline.json</code>.</div>${chapters}</div>`;
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
    if (!advs.length){ flash('No reviewer comments to export yet.'); return; }
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
        return `<h3>${unitLabel(chMeta(g.ch), UNIT)} — ${escapeHtml(shortTitle(chMeta(g.ch).title))}</h3>
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
    chip('user-exclamation', advTotal, 'new reviewer comment'+(advTotal!==1?'s':''), 'var(--accent)', firstAdv?.ch),
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
      <div class="mxrow mxhead"><span class="mxname"></span><span class="mx">open</span><span class="mx">staged</span><span class="mx">reviewer</span><span class="mx">merged</span></div>
      ${rows}
    </div>`;
  panel.querySelectorAll('[data-ch]').forEach(el => el.onclick = () => enterChapter(el.dataset.ch));
}
// ---------- import: parse the author's document → chapters.json (no hardcoded chapters) ----------
// Fetch one raw file from a source repo (adopter's own repo + token; never a Footnote-held credential).
async function ghRaw(src, path, t){
  const r = await fetch(`https://api.github.com/repos/${src}/contents/${path}?t=${Date.now()}`,
    { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github.raw' }, cache:'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
}
// Detect chapters from the configured LaTeX source repo: read the entry .tex, resolve its \include/\input
// files, then parse. Two-pass so parseLatexChapters gets a synchronous resolver.
async function detectFromRepo(src, entry, t){
  const sp = _CFG.srcPrefix || '';   // workspace mode: source lives under <id>/source/
  const main = await ghRaw(src, sp + entry, t);
  const includes = [...main.matchAll(/\\(?:include|input)\s*\{([^}]+)\}/g)].map(m => m[1].trim().replace(/\.tex$/, ''));
  const map = {};
  await Promise.all(includes.map(async p => { try { map[p] = await ghRaw(src, `${sp}${p}.tex`, t); } catch { map[p] = null; } }));
  const resolve = p => map[p] ?? null;
  return { chapters: parseLatexChapters(main, resolve), level: detectUnitLevel(main, resolve) };
}
async function saveChapters(chs, t){
  let sha = null; try { const cur = await getJson(t, 'chapters.json'); sha = cur.sha; } catch {}
  await putJson(t, 'chapters.json', chs, sha, `import: ${chs.length} ${UNIT}s from document`);
}
// Write the source-generated "Proposed outline" tree to outline.json (a true extraction of main.tex,
// replacing any hand-authored/drifted one). Best-effort — never blocks the import.
async function saveOutline(outline, t){
  let sha = null; try { const cur = await getJson(t, 'outline.json'); sha = cur.sha; } catch {}
  await putJson(t, 'outline.json', outline, sha, `import: outline from document (${outline.chapters.length} chapters)`);
}
function importDocument(){
  const t = localStorage.getItem('ghpat'); if (!t){ openSettingsPage('access'); return; }
  const src = _CFG.sourceRepo;
  let detected = [];
  let detectedLevel = null; // 'chapter' | 'section' from the parsed LaTeX; null for Word/no-parse (keeps current noun)
  let pendingTex = null;    // { name, text } — a single .tex we'll commit as main.tex
  let pendingFiles = null;  // [{ path, isText, text?, base64? }] — a whole project folder
  const suggestion = src || sourceRepoSuggestion(_CFG.projectName || DOC, _CFG.owner);
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" style="max-width:560px">
    <div style="font-size:16px;font-weight:600;margin-bottom:4px">Import your ${escapeHtml(DOC)}</div>
    <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px">Footnote parses your source to find ${escapeHtml(UNIT)}s — nothing is hardcoded.</div>
    ${src ? `<button class="btn" id="imp-repo" style="width:100%;margin-bottom:10px"><i class="ti ti-brand-github"></i> Detect from <code>${escapeHtml(src)}</code></button>` : ''}
    <label class="btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;margin-bottom:8px"><i class="ti ti-folder"></i> Upload your whole project folder<input id="imp-folder" type="file" webkitdirectory directory multiple style="display:none"></label>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px;text-align:center">Recommended — brings your <code>figures/</code> and <code>.bib</code> so nothing breaks.</div>
    <label class="btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer"><i class="ti ti-upload"></i> Or a single .tex / .docx<input id="imp-file" type="file" accept=".tex,.docx" style="display:none"></label>
    <div id="imp-srcwrap" style="display:none;margin-top:12px">
      <div style="font-size:12px;color:var(--text-2);margin-bottom:5px" id="imp-srchelp">Save the uploaded LaTeX into this source repo <span style="color:var(--text-3)">— created if it doesn't exist.</span></div>
      <input id="imp-src" value="${escapeHtml(suggestion)}" spellcheck="false" style="width:100%;box-sizing:border-box;padding:8px 10px;border:.5px solid var(--border);border-radius:8px;font:inherit;font-size:12.5px">
    </div>
    <div id="imp-status" style="font-size:12px;color:var(--text-3);margin-top:10px;min-height:16px"></div>
    <div id="imp-preview" style="margin-top:6px;max-height:230px;overflow:auto"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="imp-cancel">Cancel</button>
      <button class="btn btn-primary" id="imp-save" disabled>Save ${escapeHtml(UNIT)}s</button>
    </div></div>`;
  document.body.appendChild(scrim);
  const $ = s => scrim.querySelector(s);
  const status = m => { $('#imp-status').textContent = m; };
  const preview = list => {
    detected = list;
    $('#imp-preview').innerHTML = list.length
      ? `<div style="font-size:11px;color:var(--text-3);margin:4px 0 6px">Detected ${list.length} ${escapeHtml(UNIT)}${list.length!==1?'s':''}:</div>` +
        list.map(c => `<div style="font-size:12.5px;padding:4px 0;border-bottom:.5px solid var(--border)"><b>${c.n}.</b> ${escapeHtml(c.title)} <span style="color:var(--text-3)">· ${escapeHtml(c.id)}${c.sourceFile?` · ${escapeHtml(c.sourceFile)}`:''}</span></div>`).join('')
      : `<div style="font-size:12.5px;color:var(--warn)">No ${escapeHtml(UNIT)}s found. For a multi-file LaTeX project, use "Detect from source repo" so \\include'd files resolve.</div>`;
    $('#imp-save').disabled = !list.length;
  };
  const close = () => scrim.remove();
  scrim.onclick = e => { if (e.target === scrim) close(); };
  $('#imp-cancel').onclick = close;
  const showSrc = (help) => { $('#imp-srchelp').innerHTML = help; $('#imp-srcwrap').style.display = 'block'; };
  if (src) $('#imp-repo').onclick = async () => {
    pendingTex = null; pendingFiles = null; $('#imp-srcwrap').style.display = 'none';   // detecting from the repo: nothing to commit
    const entry = prompt('Entry .tex file in the source repo:', 'main.tex'); if (!entry) return;
    status(`Reading ${entry} from ${src}…`);
    try { const r = await detectFromRepo(src, entry.trim(), t); detectedLevel = r.level; preview(r.chapters); status(''); }
    catch (e){ status('Could not read the source: ' + e.message); }
  };
  $('#imp-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    pendingFiles = null;
    status(`Parsing ${f.name}…`);
    try {
      if (importFormat(f.name) === 'docx') {
        pendingTex = null; detectedLevel = null; $('#imp-srcwrap').style.display = 'none';   // Word → keep the current unit noun
        preview(parseDocxChapters(await docxToXml(await f.arrayBuffer())));
      } else {
        const text = await f.text();
        pendingTex = { name: f.name, text };                       // stage for commit into the source repo
        detectedLevel = detectUnitLevel(text, () => null);
        showSrc(`Footnote commits this as <code>main.tex</code> into this source repo <span style="color:var(--text-3)">— created if it doesn't exist. A single file won't carry figures/refs; use the folder upload for a full project.</span>`);
        preview(parseLatexChapters(text, () => null));
      }
      status('');
    } catch (err){ status('Could not parse ' + f.name + ': ' + err.message); }
  };
  // Whole-folder upload: read every file (source as text, figures as bytes), find the entry .tex, parse it
  // with the other .tex files as the include resolver, and stage all files to commit preserving structure.
  $('#imp-folder').onchange = async e => {
    const picked = [...e.target.files]; if (!picked.length) return;
    pendingTex = null;
    status(`Reading ${picked.length} files…`);
    try {
      const MAX = 40 * 1024 * 1024; let skipped = 0;
      const files = [];
      for (const f of picked) {
        const rel = stripTopFolder(f.webkitRelativePath || f.name);
        if (/(^|\/)\./.test(rel)) continue;                        // skip dotfiles / .git
        if (f.size > MAX) { skipped++; continue; }
        if (isTextPath(rel)) files.push({ path: rel, isText: true, text: await f.text() });
        else {
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          files.push({ path: rel, isText: false, base64: btoa(bin) });
        }
      }
      const entry = pickEntryTex(files.filter(f => f.isText));
      if (!entry) { status('No .tex file found in that folder.'); return; }
      pendingFiles = files;
      const map = {};
      for (const f of files) if (/\.tex$/i.test(f.path)) map[f.path.replace(/\.tex$/i, '')] = f.text;
      const entryText = files.find(f => f.path === entry).text;
      detectedLevel = detectUnitLevel(entryText, p => (p in map ? map[p] : null));
      const nfig = files.filter(f => !f.isText).length;
      showSrc(`Commit this project (<b>${files.length}</b> files${nfig ? `, ${nfig} figure${nfig!==1?'s':''}` : ''}${skipped ? `; ${skipped} skipped >40&nbsp;MB` : ''}) into this source repo, entry <code>${escapeHtml(entry)}</code> <span style="color:var(--text-3)">— created if it doesn't exist.</span>`);
      preview(parseLatexChapters(entryText, p => (p in map ? map[p] : null)));
      status('');
    } catch (err){ status('Could not read the folder: ' + err.message); }
  };
  $('#imp-save').onclick = async () => {
    $('#imp-save').disabled = true;
    try {
      if (pendingFiles || pendingTex) {
        const repo = $('#imp-src').value.trim();
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter a source repo as owner/name.');
        const sp = p => (_CFG.srcPrefix || '') + p;   // workspace mode nests source under <id>/source/
        status(`Preparing ${repo}…`);        await ensureRepo(t, repo);
        if (await repoFileSha(repo, sp('main.tex'), t).catch(() => null)) {
          if (!confirm(`main.tex already exists in ${repo}${_CFG.srcPrefix ? '/' + _CFG.srcPrefix : ''}. Overwrite it with this upload?`)) { status('Cancelled.'); $('#imp-save').disabled = false; return; }
        }
        if (pendingFiles) {   // whole folder: commit every file preserving structure
          let i = 0;
          for (const f of pendingFiles) {
            status(`Committing ${++i}/${pendingFiles.length} · ${f.path}…`);
            if (f.isText) await commitSourceFile(repo, sp(f.path), f.text, t, `Footnote import: ${sp(f.path)}`);
            else await commitSourceBinary(repo, sp(f.path), f.base64, t, `Footnote import: ${sp(f.path)}`);
          }
        } else {              // single .tex
          status(`Committing main.tex to ${repo}…`);
          await commitSourceFile(repo, sp('main.tex'), pendingTex.text, t, 'Footnote import: main.tex');
        }
        // Persist the source repo on the project (multi-project mode writes projects.json).
        if (_projectId && _CFG.hubRepo) { try { await writeProjectPatch(_CFG, _projectId, { sourceRepo: repo }, t); } catch (e) { console.warn('sourceRepo persist:', e.message); } }
        _CFG.sourceRepo = repo; setConfig(_CFG);
      }
      // Adopt the detected unit level (chapter/section) AND the LaTeX \title from the uploaded source, so
      // the reviewer's labels and header match the document. Never clobber a custom noun or an owner title
      // override (doc.titleManual). Capture the title from the entry .tex + its \input resolver. Persist once.
      let _entryText = '', _resolveInc = () => null;
      if (pendingTex) { _entryText = pendingTex.text || ''; }
      else if (pendingFiles) {
        const _texts = pendingFiles.filter(f => f.isText);
        const _entry = pickEntryTex(_texts); const _map = {};
        for (const f of _texts) _map[f.path.replace(/\.tex$/i, '')] = f.text;
        _entryText = ((_texts.find(f => f.path === _entry)) || {}).text || '';
        _resolveInc = p => (p in _map ? _map[p] : null);
      }
      const parsedTitle = parseDocTitle(_entryText, _resolveInc);
      const titleUpd = !!(parsedTitle && !_CFG.doc.titleManual && parsedTitle !== _CFG.doc.title);
      const nextNoun = resolveUnitNoun(_CFG.doc.unitNoun, detectedLevel);
      if (nextNoun !== _CFG.doc.unitNoun || titleUpd) {
        _CFG.doc = { ..._CFG.doc, unitNoun: nextNoun, ...(titleUpd ? { title: parsedTitle } : {}) }; setConfig(_CFG);
        UNIT = nextNoun; UNITC = UNIT.charAt(0).toUpperCase() + UNIT.slice(1);   // refresh the live labels this session
        if (_projectId && _CFG.hubRepo) { try { await writeProjectPatch(_CFG, _projectId, { doc: _CFG.doc }, t); } catch (e) { console.warn('doc persist:', e.message); } }
      }
      status('Saving…');
      await saveChapters(detected, t);
      // Generate the Proposed outline from the same source (nested structure + source-derived synopses).
      try { const outline = parseLatexOutline(_entryText, _resolveInc); if (outline.chapters.length) await saveOutline(outline, t); } catch (e) { console.warn('outline gen:', e.message); }
      flash(`Imported ${detected.length} ${UNIT}s`); close();
      CHAPTERS = await loadChapters(t); enterHome();
    }
    catch (e){ status('Save failed: ' + e.message); $('#imp-save').disabled = false; }
  };
}

// Creator credit + contact for the reviewer home (mirrors the launcher footer; Footnote's own authorship).
const CREDIT_FOOTER = `<div style="margin-top:48px;padding-top:16px;border-top:.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--text-3)">
  <span>Footnote · Built by <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener" style="color:var(--text-2);text-decoration:none;font-weight:500">@mattlmccoy</a></span>
  <span style="display:flex;align-items:center;gap:4px">
    <a href="mailto:mail@matthewmccoy.info" title="Email" aria-label="Email" style="width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-3)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></a>
    <a href="https://github.com/mattlmccoy" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub profile" style="width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-3)"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
    <a href="https://github.com/mattlmccoy/footnote/issues" target="_blank" rel="noopener" title="Report an issue" aria-label="Report an issue" style="width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-3)"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/></svg></a>
  </span>
</div>`;
// Per-project setup checklist — makes "what's left before this is usable" legible for a new adopter.
// Source + parsed are known synchronously; "reading view built" is filled async by refreshSetup (ghTree).
function _setupStep(ok, label, detail){
  return `<div style="display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--text-2)">
    <i class="ti ${ok ? 'ti-circle-check' : 'ti-circle-dashed'}" style="font-size:17px;flex:0 0 auto;color:${ok ? 'var(--success)' : 'var(--text-3)'}"></i>
    <span>${escapeHtml(label)}${detail ? ` <span style="color:var(--text-3)">· ${detail}</span>` : ''}</span></div>`;
}
function setupChecklistHtml(){
  const parsed = CHAPTERS.length > 0;
  // Source is "connected" if the project names an external sourceRepo OR units are already parsed — because
  // parsing requires reading a source. This covers legacy/migrated projects (source wired via a SOURCE_REPO
  // Actions var, no project field) and uploaded projects (source lives in the workspace), which have no
  // _CFG.sourceRepo but are clearly connected.
  const src = !!(_CFG.sourceRepo) || parsed;
  // Both source + units present → likely fully set up; render hidden and let refreshSetup() reveal it only
  // if the reading view isn't built yet (avoids a flash on ready projects).
  const hide = src && parsed;
  return `<div id="setup-strip" style="border:.5px solid var(--border);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:24px;background:var(--bg-2)${hide ? ';display:none' : ''}">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px">Project setup</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(() => { const sl = sourceLabel(_CFG, parsed); return _setupStep(src, 'Source connected', sl.repo ? escapeHtml(sl.repo) : sl.text); })()}
        ${_setupStep(parsed, 'Document parsed', parsed ? `${CHAPTERS.length} ${UNIT}${CHAPTERS.length !== 1 ? 's' : ''}` : `import your ${DOC}`)}
        <div id="setup-render">${_setupStep(false, 'Reading view built', 'checking…')}</div>
      </div></div>`;
}
async function refreshSetup(){
  const strip = document.getElementById('setup-strip'); if (!strip) return;
  const line = document.getElementById('setup-render'); const t = tok();
  const parsed = CHAPTERS.length > 0; let built = 0;
  if (t && parsed){
    try { const set = new Set(await ghTree(t));
      // ghTree() already strips this project's dataPrefix, so match the bare repo-relative path (no dpath()).
      built = CHAPTERS.filter(c => set.has('content/' + c.id + '.html')).length; } catch(e){}
  }
  const allBuilt = parsed && built >= CHAPTERS.length;
  const detail = !parsed ? `import your ${DOC} first`
    : allBuilt ? `all ${CHAPTERS.length} ${UNIT}${CHAPTERS.length !== 1 ? 's' : ''} rendered`
    : built > 0 ? `${built} of ${CHAPTERS.length} rendered — building the rest`
    : 'not built yet — renders once your source is in place';
  if (line) line.innerHTML = _setupStep(allBuilt, 'Reading view built', detail);
  strip.style.display = allBuilt ? 'none' : '';   // all units rendered ⟹ source+parsed done → hide the strip
}
// No chapters on the home can mean two very different things: the document was never imported, OR the
// app can't READ the data repo (a dropped GitHub-App repo permission / narrowed token — a private repo
// returns 404 for both). The access case used to masquerade as the import gate and looked like the whole
// document vanished. Now it says so plainly and links the fix, so a permissions slip self-diagnoses.
async function refreshEmptyState(){
  if (CHAPTERS.length) return;
  const box = document.getElementById('home-empty'); if (!box) return;
  const t = tok(); if (!t) return;                       // no token → existing "Add token" copy is correct
  let state; try { state = await dataRepoReadable(t); } catch { return; }
  if (state !== 'no-access') return;                     // readable-but-empty is a genuine import case
  box.innerHTML = `<i class="ti ti-lock-off" style="font-size:30px;color:var(--danger)"></i>
    <div style="font-size:17px;font-weight:600;margin:12px 0 6px">Can't read your Review repo</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-3);margin-bottom:18px">Footnote can't read <code>${escapeHtml(DATA_REPO)}</code> with your current access. Your ${escapeHtml(UNIT)}s are safe: this is a permissions gap, not lost data. Give the Footnote GitHub App access to that repo (github.com/settings/installations, then Footnote, Repository access), then reload.</div>
    <a class="btn btn-primary" href="https://github.com/settings/installations" target="_blank" rel="noopener" style="padding:8px 16px;text-decoration:none">Open GitHub App settings</a>`;
}
function homeHtml(){
  const last = localStorage.getItem('lastChapter');
  const lm = last && chMeta(last);
  const lr = last ? JSON.parse(localStorage.getItem('review:'+last) || 'null') : null;
  const cont = lm ? `<div style="border:.5px solid var(--accent);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:26px;display:flex;align-items:center;gap:14px">
      <i class="ti ti-player-play" style="font-size:22px;color:var(--accent)"></i>
      <div style="min-width:0">
        <div style="font-size:11.5px;color:var(--text-2)">Continue where you left off</div>
        <div style="font-size:14px;font-weight:500">${last==='__whole__' ? `Whole ${escapeHtml(DOC)}` : `${unitLabel(lm, UNIT)} · ${shortTitle(lm.title)}`}</div>
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
        <div style="font-size:11.5px;color:var(--text-3)">${unitLabel(c, UNIT)}</div>
        <div style="font-size:14px;font-weight:500;line-height:1.35;margin:3px 0 11px;min-height:38px">${shortTitle(c.title)}</div>
        <div style="height:5px;border-radius:4px;background:var(--bg-3);overflow:hidden;margin-bottom:8px"><div style="width:${done?100:pct}%;height:100%;background:${bar}"></div></div>
        <div style="font-size:11px;color:var(--text-2);display:flex"><span>${status}</span><span style="margin-left:auto">${right}</span></div></div>`;
  }).join('');
  const hasTok = !!localStorage.getItem('ghpat');
  // No chapters yet → the document hasn't been imported. Show an import call-to-action, not a blank grid.
  const empty = `<div id="home-empty" style="border:1px dashed var(--border-2);border-radius:var(--r-lg);padding:40px 28px;text-align:center;max-width:520px;margin:6vh auto 0">
      <i class="ti ti-file-import" style="font-size:30px;color:var(--accent)"></i>
      <div style="font-size:17px;font-weight:600;margin:12px 0 6px">Import your ${DOC}</div>
      <div style="font-size:13px;line-height:1.6;color:var(--text-3);margin-bottom:18px">Point Footnote at your LaTeX source (<code>main.tex</code>) or a Word <code>.docx</code>. Footnote parses it to find your ${UNIT}s — nothing is hardcoded.${hasTok ? '' : ' Add your access token first.'}</div>
      <button class="btn btn-primary" id="import-doc" style="padding:8px 16px">${hasTok ? `Import ${DOC}` : 'Add token'}</button></div>`;
  const wholeBtn = CHAPTERS.length
    ? `<button class="btn" data-ch="__whole__" style="display:flex;align-items:center;gap:9px;width:100%;justify-content:flex-start;padding:12px 15px;margin-bottom:16px;border:.5px solid var(--border);border-radius:var(--r-lg);cursor:pointer">
         <i class="ti ti-book" style="font-size:19px;color:var(--accent)"></i>
         <span style="text-align:left"><span style="display:block;font-size:14px;font-weight:600">Read the whole ${escapeHtml(DOC)}</span>
         <span style="display:block;font-size:11.5px;color:var(--text-3)">Every ${escapeHtml(UNIT)} as one continuous read — comment anywhere</span></span></button>`
    : '';
  const allCh = CHAPTERS.length
    ? `<div class="home-allch" style="margin-bottom:13px">ALL ${UNIT.toUpperCase()}S</div>
       ${wholeBtn}
       <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px">${cards}</div>`
    : empty;
  return `<div id="home-wrap" style="max-width:900px;margin:0 auto;padding:28px 24px 90px">
      ${setupChecklistHtml()}
      ${cont}
      ${allCh}
      <div id="inbox-panel" class="ibx" style="display:none;margin-top:28px;margin-bottom:0"></div>
      <div id="home-downloads" style="margin-top:36px"></div>
      ${CREDIT_FOOTER}</div>`;
}

// ---------- history / version timeline (data repo content commits — readable with the data-repo token) ----------
const HIST_REPO = DATA_REPO;
async function ghApi(t, path){
  const r = await fetch('https://api.github.com/' + path, { headers:{ Authorization:`Bearer ${t}`, Accept:'application/vnd.github+json' } });
  if (!r.ok) throw new Error('HTTP '+r.status); return r.json();
}
async function showHistory(){
  const t = tok();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  if (!t){ read.innerHTML = `<div class="empty"><div style="font-size:15px;font-weight:500">History needs your access token</div><div style="font-size:13px;color:var(--text-2);margin-top:6px">Open a ${UNIT} and add your data-repo token first.</div></div>`; return; }
  if (!current){ read.innerHTML = `<div class="empty">Open a ${UNIT} first, then view its history.</div>`; return; }
  read.innerHTML = `<div class="empty">Loading history…</div>`;
  const file = `content/${current}.html`;
  try {
    const commits = await ghApi(t, `repos/${HIST_REPO}/commits?path=${encodeURIComponent(file)}&per_page=20`);
    if (!commits.length){ read.innerHTML = `<div class="empty">No revision history recorded for this ${UNIT} yet.</div>`; return; }
    renderHistoryShell(commits, file); selectCommit(commits[0].sha, file);
  } catch(e){ read.innerHTML = `<div class="empty">Couldn't load history (${e.message}).</div>`; }
}
function renderHistoryShell(commits, file){
  const m = chMeta(current);
  read.innerHTML = `<div style="height:100%;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:.5px solid var(--border);background:var(--bg-2)">
        <i class="ti ti-history"></i><strong style="font-weight:600">History · ${unitLabel(m, UNIT)}</strong>
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
      <div style="font-size:12px;color:var(--text-3);margin-top:16px;border-top:.5px solid var(--border);padding-top:12px">Diff of the ${UNIT}'s published text; figure/image swaps show as a single line. The reading view above always reflects the latest published version.</div>`;
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

// ---------- global search (across the ${DOC}) ----------
let searchIndex = null;
async function loadIndex(){
  if (searchIndex) return searchIndex;
  const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (dev){ try { const r = await fetch('./search_index.json'); if (r.ok){ searchIndex = await r.json(); return searchIndex; } } catch(e){} }
  const t = tok(); if (!t) return null;
  try { const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('search_index.json')}`,
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
  p.innerHTML = `<div style="font-size:11px;color:var(--text-3);padding:6px 10px">${hits.length} result${hits.length!==1?'s':''} across the ${DOC} for "${escapeHtml(q)}"</div>` +
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
const SHORTCUTS = [['j / k','next / previous comment'],['↵ on a comment','jump to its place in the text'],['f','focus (distraction-free) mode'],['[ / ]','collapse left nav / comments rail'],['/',`search this ${UNIT}`],[`${MOD}\\`,`search the whole ${DOC}`],[`${MOD}↵`,'open the Send menu'],['⌥1–5 (in popover)','pick a tag'],['Esc','close popover / overlay'],['?','show this help']];
const BUTTONS = [
  ['ti-layout-grid',`Home · the ${UNIT} library`],
  ['ti-book-2',`${UNITC} switcher`],
  ['ti-search',`Search this ${UNIT} (${MOD}\\ = whole ${DOC})`],
  ['ti-arrows-diagonal-minimize-2','Focus mode — hide both side panes'],
  ['ti-history',`Version history & diffs for this ${UNIT}`],
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
    ${BUTTONS.map(([ic,d]) => `<div class="help-row"><span class="help-ic"><i class="ti ${ic}"></i></span><span>${ic==='ti-send' && !assistantOn() ? 'Review actions — stage, approve &amp; merge, plus Export' : d}</span></div>`).join('')}
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
  const olLinked = isOverleafLinked(_CFG);
  menu.innerHTML = `
    <div class="mmi" data-act="release"><i class="ti ti-users"></i>Reviewers…</div>
    ${olLinked ? `<div class="mmi" data-act="overleaf"><i class="ti ti-refresh"></i>Refresh from Overleaf</div>` : ''}
    <div class="mmi" data-act="help"><i class="ti ti-keyboard"></i>Buttons & shortcuts</div>
    <div class="mmi" data-act="token"><i class="ti ti-key"></i>Owner key${hasTok?' <span style="color:var(--success);font-size:11px;margin-left:auto">connected</span>':' <span style="color:var(--warn);font-size:11px;margin-left:auto">not set</span>'}</div>
    <div class="mmi" data-act="tour"><i class="ti ti-help-circle"></i>Take the setup tour</div>
    <div class="mmi" data-act="tourchapter"><i class="ti ti-book-2"></i>Reviewing a chapter (demo)</div>
    <div class="mmi" data-act="tourtoggle"><i class="ti ti-${autoOff?'eye-off':'eye-check'}"></i>Auto-show tour: ${autoOff?'off — turn on':'on — turn off'}</div>
    <div class="mmi" data-act="assistant"><i class="ti ti-settings"></i>AI assistant: ${assistantOn()?'on':'off'} — in Settings</div>
    <div class="mmi" data-act="dash"><i class="ti ti-layout-dashboard"></i>Back to dashboard</div>`;
  document.body.appendChild(menu);
  const acts = { release: openReleasePanel, help: toggleHelp, token: () => openSettingsPage('access'), dash: () => location.href = './index.html', tour: launchOwnerTour, tourchapter: launchOwnerChapterTour,
    tourtoggle: () => { if (tourSeen('tour-owner-v1')){ localStorage.removeItem('tour-owner-v1'); flash('Auto-tour turned on — it\'ll show on next load.'); }
      else { markTourSeen('tour-owner-v1'); flash('Auto-tour turned off.'); } },
    // Both the access token and the AI master switch now live on the dedicated Settings page.
    assistant: () => openSettingsPage('ai'), overleaf: refreshFromOverleaf };
  menu.querySelectorAll('.mmi').forEach(el => { el.onmouseenter = () => el.style.background='var(--bg-3)'; el.onmouseleave = () => el.style.background='transparent';
    el.onclick = () => { menu.remove(); acts[el.dataset.act](); }; });
  setTimeout(() => document.addEventListener('click', function h(e){ if (!menu.contains(e.target) && e.target.id!=='btn-more' && !e.target.closest?.('#btn-more')){ menu.remove(); document.removeEventListener('click', h); } }), 0);
}
// Toggle the optional AI assistant. OFF is the default and the deterministic review flow needs nothing.
// Turning it on explains that the AI round-trip runs on the user's OWN setup and must be configured.
function toggleAssistant(){
  if (assistantOn()){
    // Explicit per-user OFF (localStorage '0'), which overrides a shipped reviewAgents list too — the agent
    // catalog says which agents are available, not that AI must stay on. The deterministic flow is unaffected.
    localStorage.setItem(ASSIST_KEY, '0'); flash('AI assistant off. “Review actions” (stage → approve → merge) still works.');
  } else {
    localStorage.setItem(ASSIST_KEY, '1');
    alert('AI assistant enabled.\n\nThe core review flow — comment → stage edit → approve → merge — always works WITHOUT AI. Turning this on adds “Send to Claude”, which dispatches queued edits and agent reviews through your OWN Review repo’s GitHub Actions and Claude credentials. Nothing runs until you configure that (agent list + secrets). See the setup docs.');
  }
  if (document.getElementById('btn-send')) renderTopbar();   // refresh the top-bar button label
}
// Shared modal used by Settings dialogs (and, later, agent authoring). Stacks; ESC / backdrop-click
// closes the topmost. `body` is an HTMLElement; `actions` is [{label, primary?, onClick(close)}].
let _modalStack = [];
let _onModalEsc = null;
function openModal(title, body, actions = []) {
  const id = 'm_' + (_modalStack.length + 1);
  _modalStack = modalReducer(_modalStack, { type:'open', id });
  const back = document.createElement('div'); back.className = 'modal-backdrop'; back.dataset.mid = id;
  const foot = actions.map((a, i) => `<button class="btn${a.primary?' btn-primary':''}" data-i="${i}">${a.label}</button>`).join('');
  back.innerHTML = `<div class="modal-box"><div class="modal-head">${title}<button class="modal-x" aria-label="Close">×</button></div>
    <div class="modal-body"></div>${actions.length?`<div class="modal-foot">${foot}</div>`:''}</div>`;
  back.querySelector('.modal-body').appendChild(body);
  const close = () => { back.remove(); _modalStack = modalReducer(_modalStack, { type:'close' });
    if (_onModalEsc && !_modalStack.length){ document.removeEventListener('keydown', _onModalEsc); _onModalEsc = null; } };
  back.querySelector('.modal-x').onclick = close;
  back.onclick = e => { if (e.target === back) close(); };
  actions.forEach((a, i) => { const b = back.querySelector(`.modal-foot [data-i="${i}"]`); if (b) b.onclick = () => a.onClick(close); });
  document.body.appendChild(back);
  if (!_onModalEsc){ _onModalEsc = e => { if (e.key === 'Escape'){ const top = document.querySelector(`.modal-backdrop[data-mid="${topModal(_modalStack)}"]`); top?.querySelector('.modal-x')?.click(); } };
    document.addEventListener('keydown', _onModalEsc); }
  return close;
}
// Dedicated Settings page (Project A). In-place view like openReleasePanel: swaps topbar + main area,
// renders a left-nav (settingsSections model) + a detail pane. `section` deep-links a starting section.
let _setSection = null;
async function openSettingsPage(section) {
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<strong style="font-size:16px;font-weight:600"><i class="ti ti-settings" style="margin-right:7px"></i>Settings</strong>
     <button class="btn" id="set-close" style="margin-left:auto"><i class="ti ti-arrow-left"></i>Back to ${UNIT}s</button>`;
  document.getElementById('set-close').onclick = enterHome;
  let claudeConnected = false, emailConfigured = false;
  try { claudeConnected = claudeConnectionStatus(await listSecretNames(t)).claude; } catch {}
  try { const r = await loadAdvisorsRegistry(t); emailConfigured = r.reg?.email_configured === true; } catch {}
  const state = { aiOn: assistantOn(), claudeConnected, emailConfigured, hasToken: !!t, hasTitle: !!(_CFG.doc && _CFG.doc.title) };
  const secs = settingsSections(_CFG, state);
  _setSection = resolveSection(secs, section || _setSection);
  const nav = secs.map(s => `<div class="set-item${s.id===_setSection?' active':''}${s.muted?' muted':''}" data-s="${s.id}">
      <span>${escapeHtml(s.label)}</span>${s.glyph?`<span class="set-g ${s.glyph}">${s.glyph==='ok'?'✓':'●'}</span>`:''}</div>`).join('');
  read.innerHTML = `<div class="set-wrap"><div class="set-nav">${nav}</div><div class="set-pane" id="set-pane"></div></div>`;
  read.querySelectorAll('.set-item').forEach(el => el.onclick = () => { _setSection = el.dataset.s; openSettingsPage(_setSection); });
  renderSettingsSection(_setSection, t);
}
function renderSettingsSection(id, t) {
  const pane = document.getElementById('set-pane'); if (!pane) return;
  if (id === 'document') return renderSettingsDocument(pane, t);
  if (id === 'email')  return renderSettingsEmail(pane, t);
  if (id === 'access') return renderSettingsAccess(pane, t);
  if (id === 'agents') return renderSettingsAgents(pane, t);
  if (id === 'ai')     return renderSettingsAI(pane, t);
}
// Document section: the title reviewers see. Auto-captured from the LaTeX \title at import; the owner can
// override it here. titleManual stops a later import from clobbering the manual value. Persists to
// projects.json in workspace mode; takes effect in-session immediately either way.
function renderSettingsDocument(pane, t) {
  const cur = (_CFG.doc && _CFG.doc.title) || '';
  const manual = !!(_CFG.doc && _CFG.doc.titleManual);
  pane.innerHTML = `
    <div class="set-card">
      <h4>Document title</h4>
      <div class="set-status">${cur ? `<span class="ok">✓</span> ${escapeHtml(cur)}` : '<span class="warn">●</span> No title yet — auto-detected from the LaTeX \\title on import.'}</div>
      <div style="font-size:11.5px;color:var(--text-3);margin:8px 0 6px">Shown in the reviewer header. ${manual ? 'Set manually.' : 'Auto-detected from your source — edit to override.'}</div>
      <div style="display:flex;gap:8px">
        <input id="set-title" type="text" value="${escapeHtml(cur)}" placeholder="Document title" style="flex:1;font:inherit;font-size:13px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <button class="btn btn-primary" id="set-title-save" style="padding:5px 12px">Save</button>
        ${manual ? '<button class="btn" id="set-title-auto" style="padding:5px 12px" title="Clear the override; re-detect from the source on next import">Auto</button>' : ''}
      </div>
      <div id="set-title-stat" style="font-size:11.5px;color:var(--text-3);margin-top:6px"></div>
    </div>`;
  const save = async (title, isManual) => {
    const stat = pane.querySelector('#set-title-stat'); stat.textContent = 'Saving…';
    _CFG.doc = { ..._CFG.doc, title, titleManual: isManual }; setConfig(_CFG);
    try {
      if (_projectId && _CFG.hubRepo) await writeProjectPatch(_CFG, _projectId, { doc: _CFG.doc }, t);
      stat.textContent = 'Saved — reviewers see this title.'; setTimeout(() => openSettingsPage('document'), 700);
    } catch (e) { stat.textContent = 'Failed: ' + e.message; }
  };
  pane.querySelector('#set-title-save').onclick = () => { const v = pane.querySelector('#set-title').value.trim(); if (!v){ pane.querySelector('#set-title-stat').textContent = 'Enter a title.'; return; } save(v, true); };
  pane.querySelector('#set-title-auto')?.addEventListener('click', () => save(cur, false));
  // Backfill: projects imported before title-capture have no doc.title. Detect it from the LaTeX source now,
  // fill the field, and persist (non-manual) so it shows everywhere without a re-import.
  if (!cur && t) {
    const stat = pane.querySelector('#set-title-stat'); stat.textContent = 'Detecting from your LaTeX source…';
    _detectTitleFromSource(t).then(async det => {
      const inp = pane.querySelector('#set-title');
      if (!det) { stat.textContent = 'No \\title found in source/main.tex — enter one above.'; return; }
      if (inp && !inp.value.trim()) inp.value = det;
      _CFG.doc = { ..._CFG.doc, title: det, titleManual: false }; setConfig(_CFG);
      try { if (_projectId && _CFG.hubRepo) await writeProjectPatch(_CFG, _projectId, { doc: _CFG.doc }, t); stat.textContent = 'Detected from your LaTeX source ✓'; }
      catch (e) { stat.textContent = 'Detected — not saved: ' + e.message; }
    }).catch(() => { stat.textContent = ''; });
  }
}
// Read the uploaded LaTeX source (data-repo source/main.tex, same file the reviewer parses) and return its
// \title via parseDocTitle. '' when the source isn't in the data repo (e.g. an external source repo) or has none.
async function _detectTitleFromSource(t) {
  try {
    const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${dpath('source/main.tex')}?t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
    if (!r.ok) return '';
    return parseDocTitle(await r.text());
  } catch (e) { return ''; }
}
// Temporary placeholders — replaced in Tasks 4–7.
// Email section: the "Notify me" digest (a personal preference) lives here, stored in notify_config.json.
// The invite-email SMTP connection stays on the Reviewers page — it's part of inviting reviewers (writes
// invite secrets, re-renders the reviewer list) — so this section just points there for it.
async function renderSettingsEmail(pane, t) {
  pane.innerHTML = '<div class="set-card">Loading…</div>';
  let notifyEmail = '', notifyFreq = 'daily', emailConfigured = false;
  try { const { json } = await getJson(t, 'notify_config.json'); if (json){ notifyEmail = json.author_email || ''; notifyFreq = json.frequency || 'daily'; } } catch {}
  try { const r = await loadAdvisorsRegistry(t); emailConfigured = r.reg?.email_configured === true; } catch {}
  pane.innerHTML = `
    <div class="set-card">
      <h4>Notify me</h4>
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">A digest of reviewer activity, emailed to you.</div>
      <div style="display:flex;gap:8px">
        <input id="set-notify-email" type="email" value="${escapeHtml(notifyEmail)}" placeholder="you@example.com" style="flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
        <select id="set-notify-freq" style="font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">
          <option value="daily"${notifyFreq==='daily'?' selected':''}>Daily</option>
          <option value="weekly"${notifyFreq==='weekly'?' selected':''}>Weekly</option>
          <option value="off"${notifyFreq==='off'?' selected':''}>Off</option>
        </select>
        <button class="btn" id="set-notify-save" style="padding:5px 12px">Save</button>
        <span id="set-notify-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
    </div>
    <div class="set-card">
      <h4>Invite email</h4>
      <div class="set-status">${emailConfigured?'<span class="ok">✓</span> Set up — reviewer invites send automatically.':'<span class="warn">●</span> Not set up — reviewers get portal links you copy yourself.'}</div>
      <div style="font-size:11.5px;color:var(--text-3);margin-top:8px">Invite email sends your reviewers their invitations. <a href="#" id="set-email-toreviewers">${emailConfigured?'Change or re-test email →':'Set up invite email →'}</a></div>
    </div>`;
  pane.querySelector('#set-notify-save').onclick = async () => {
    const stat = pane.querySelector('#set-notify-stat');
    const val = pane.querySelector('#set-notify-email').value.trim();
    const f = pane.querySelector('#set-notify-freq').value;
    stat.style.color = 'var(--text-3)'; stat.textContent = 'Saving…';
    try {
      const { json, sha } = await getJson(t, 'notify_config.json').catch(() => ({ json:null, sha:null }));
      const cfg = json && typeof json === 'object' ? json : {};
      cfg.author_email = val; cfg.frequency = f;
      await putJson(t, 'notify_config.json', cfg, sha, 'notify: set author email + frequency');
      stat.style.color = 'var(--success)';
      stat.textContent = !val ? 'Cleared — no digest emails.' : f === 'off' ? 'Saved — digests off.' : `Saved — ${f} digest.`;
    } catch(e){ stat.style.color = 'var(--warn)'; stat.textContent = 'Failed: ' + e.message; }
  };
  pane.querySelector('#set-email-toreviewers').onclick = (e) => { e.preventDefault(); openReleasePanel({ openEmail: true }); };
}
// Access section: the browser PAT (read/write on the data repo) + the optional source-repo token
// (only when the paper's LaTeX lives in a separate repo). Replaces the old ⋯ prompt() flow.
// Access & tokens — ONE view listing every credential (Owner key / Reviewer key / Source key / Claude
// token) with what it's for, which repo it touches, the exact scope, live status, and a create link. Uses
// the standardized vocabulary. The Reviewer key is DISPLAYED here but managed on the Reviewers page (its
// SMTP-invite coupling stays there by design); Claude is also reachable from the AI section.
async function renderSettingsAccess(pane, t) {
  const has = !!tok();
  // Source is "external" when it's a SEPARATE repo — either named in the project config OR recorded only in
  // the committed source.json marker (the rfam case: phd-dissertation, separate from the Review repo). The
  // browser used to look only at project.sourceRepo, so a marker-only source read as "not needed". Fetch the
  // marker (best-effort) and resolve the same way the cloud does. `owned` = the Owner key already reaches it.
  let markerRepo = '';
  if (t) { try { const { json } = await getJson(t, dataPath(_CFG, 'source.json')); markerRepo = sourceMarkerRepo(json); } catch {} }
  const srcInfo = resolveSourceInfo(_CFG, markerRepo);
  const sourceExternal = srcInfo.external;
  const byId = Object.fromEntries(CREDENTIALS.map(c => [c.id, c]));
  const OWNER_URL = classicTokenUrl(), FG_URL = fineGrainedUrl('Footnote');
  const g = st => st.glyph === 'ok' ? '<span class="ok">✓</span>' : st.glyph === 'warn' ? '<span class="warn">●</span>' : '<span style="color:var(--text-3)">○</span>';
  const meta = c => `<div style="font-size:11px;color:var(--text-3);margin:2px 0 8px"><b>Touches:</b> ${escapeHtml(c.repo)}<br><b>Scope:</b> ${escapeHtml(c.scope)}</div>`;
  const inp = 'flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)';

  // one probe of the Review repo's Actions secrets → status for source/reviewer/claude + the owner scope
  let names = null, ownerScopeOk = null;
  if (t) { try { names = await listSecretNames(t); ownerScopeOk = true; } catch (e) { if (e && e.code === 'NOSCOPE') ownerScopeOk = false; } }
  const nameSet = new Set(names || []);
  const st = (id, extra) => credentialStatus(id, extra);
  const ownerSt = st('owner', { hasOwnerKey: has, ownerScopeOk });
  const revSt = st('reviewer', { reviewerSet: nameSet.has('ADVISOR_KEY') });
  const srcSt = st('source', { sourceExternal, sourceOwned: srcInfo.owned, sourceSet: nameSet.has('SOURCE_TOKEN') });
  const claudeSt = st('claude', { claudeConnected: claudeConnectionStatus(names || []).claude });

  pane.innerHTML = `
    <details class="set-card" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600;font-size:13px">How Footnote uses your repos</summary>
      <div style="margin-top:8px">${repoExplainerHtml({ compact: true })}</div></details>

    <div class="set-card">
      <h4>${escapeHtml(byId.owner.label)}</h4>
      <div class="set-status">${g(ownerSt)} ${escapeHtml(ownerSt.text)}</div>
      <div style="font-size:11.5px;color:var(--text-3);margin:6px 0 2px">${escapeHtml(byId.owner.forWhat)}</div>
      ${meta(byId.owner)}
      <div style="display:flex;gap:8px;margin-top:6px">
        <input id="set-pat" type="password" placeholder="ghp_… or github_pat_… — the Owner key" style="${inp}">
        <button class="btn btn-primary" id="set-pat-save" style="padding:5px 12px">Save</button>
        ${has?'<button class="btn" id="set-pat-clear" style="padding:5px 12px">Remove</button>':''}
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px">Create one: <a href="${OWNER_URL}" target="_blank" rel="noopener">classic token</a> (recommended · one click, correctly scoped) or a <a href="${FG_URL}" target="_blank" rel="noopener">fine-grained token</a> (least privilege — set the permissions above by hand).</div>
    </div>

    <div class="set-card">
      <h4>${escapeHtml(byId.reviewer.label)}</h4>
      <div class="set-status">${g(revSt)} ${escapeHtml(revSt.text)}</div>
      <div style="font-size:11.5px;color:var(--text-3);margin:6px 0 2px">${escapeHtml(byId.reviewer.forWhat)}</div>
      ${meta(byId.reviewer)}
      <button class="btn btn-primary" id="set-rev-manage" style="padding:5px 12px;margin-top:2px">${nameSet.has('ADVISOR_KEY') ? 'Update Reviewer key' : 'Set Reviewer key'}</button>
    </div>

    <div class="set-card">
      <h4>${escapeHtml(byId.source.label)} <span style="font-weight:400;color:var(--text-3)">— only for a separate Source repo</span></h4>
      <div class="set-status">${g(srcSt)} ${escapeHtml(srcSt.text)}</div>
      ${sourceExternal ? `<div style="font-size:11.5px;color:var(--text-2);margin:6px 0 2px">Your source of truth is a separate repo: <code>${escapeHtml(srcInfo.repo)}</code>${srcInfo.owned ? ' (you own it).' : ' (a repo you don’t own).'}</div>` : ''}
      <div style="font-size:11.5px;color:var(--text-3);margin:6px 0 2px">${escapeHtml(byId.source.forWhat)}</div>
      ${meta(byId.source)}
      ${sourceExternal ? `<div style="display:flex;gap:8px;margin-top:6px">
        <input id="set-srctok" type="password" placeholder="fine-grained PAT · Contents: read/write on ${escapeHtml(srcInfo.repo)}" style="${inp}">
        <button class="btn" id="set-srctok-save" style="padding:5px 12px">Save</button>
        <span id="set-srctok-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px">${srcInfo.owned ? 'Optional — your Owner key already reaches this repo. Add one only to use a narrower, source-only token. ' : ''}<a href="${FG_URL}" target="_blank" rel="noopener">Create a fine-grained token →</a> on <code>${escapeHtml(srcInfo.repo)}</code>.</div>` : ''}
    </div>

    <div class="set-card">
      <h4>${escapeHtml(byId.claude.label)}</h4>
      <div class="set-status">${g(claudeSt)} ${escapeHtml(claudeSt.text)}</div>
      <div style="font-size:11.5px;color:var(--text-3);margin:6px 0 2px">${escapeHtml(byId.claude.forWhat)}</div>
      ${meta(byId.claude)}
      <button class="btn" id="set-claude-manage" style="padding:5px 12px;margin-top:2px">Connect / manage Claude</button>
    </div>`;

  pane.querySelector('#set-pat-save').onclick = () => {
    const v = pane.querySelector('#set-pat').value.trim();
    if (!v){ flash('Paste a token first.'); return; }
    localStorage.setItem('ghpat', v); flash('Owner key saved.'); openSettingsPage('access');
  };
  const clr = pane.querySelector('#set-pat-clear');
  if (clr) clr.onclick = () => { if (confirm('Remove the saved Owner key from this browser?')){ localStorage.removeItem('ghpat'); flash('Owner key removed.'); openSettingsPage('access'); } };
  pane.querySelector('#set-rev-manage').onclick = () => openAccessKeySheet(t, () => openSettingsPage('access'));
  pane.querySelector('#set-claude-manage').onclick = () => openClaudeDialog(t);
  const srcBtn = pane.querySelector('#set-srctok-save');
  if (srcBtn) srcBtn.onclick = async () => {
    const v = pane.querySelector('#set-srctok').value.trim(); const stat = pane.querySelector('#set-srctok-stat');
    if (!v){ stat.textContent = 'Paste a token first.'; return; }
    stat.style.color = 'var(--text-3)'; stat.textContent = 'Sealing…';
    try { await setAiSecrets(t, sealToBase64, { sourceToken: v }); stat.style.color = 'var(--success)'; stat.textContent = 'Saved Source key (SOURCE_TOKEN).'; pane.querySelector('#set-srctok').value = ''; }
    catch(e){ stat.style.color = 'var(--warn)'; stat.textContent = isScopeError(e) ? 'Your Owner key lacks Secrets write — re-create it with the full scope.' : 'Failed: ' + e.message; }
  };
}
// Agents section. B1 (the catalog) lands here later; for now it carries the existing comma-separated
// reviewAgents list so the current capability isn't lost. Only reachable when AI is on.
function renderSettingsAgents(pane, t) {
  const editable = !!(_projectId && _CFG.hubRepo);
  const inp = 'width:100%;font:inherit;font-size:12.5px;padding:6px 8px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box';
  pane.innerHTML = `<div class="set-card">
    <h4>Review agents</h4>
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">Tick the agents to run. Read-only critics comment on your draft; “doer” / “local” agents run through the local runner on your machine. Only shown while AI is on.</div>
    <div id="set-agent-catalog" style="font-size:11.5px;color:var(--text-3)">Loading the agent catalog…</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn" id="set-agents-save" ${editable?'':'disabled title="Set in this instance’s config"'} style="padding:5px 12px">Save selection</button>
      <span id="set-agents-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
    </div>
    <div id="set-agent-drafts" style="margin-top:14px"></div>
    ${editable ? `<div style="margin-top:14px;padding-top:12px;border-top:.5px solid var(--border)">
      <h4 style="margin:0 0 4px">Describe a new agent</h4>
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">Say what it should review or do. Claude drafts it on <b>your own</b> credentials; you review it here before it can run.</div>
      <input id="set-agent-name" placeholder="Name — e.g. Citation Checker" style="${inp};margin-bottom:6px">
      <textarea id="set-agent-brief" rows="3" placeholder="What should it do? e.g. Flag every claim that asserts a number or comparison with no supporting citation." style="${inp};margin-bottom:6px;resize:vertical"></textarea>
      <label style="display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--text-2);margin-bottom:6px"><input type="checkbox" id="set-agent-tools"> may run tools on my machine (a local agent, not a read-only critic)</label>
      <input id="set-agent-cwd" placeholder="working directory (optional — only for a local agent)" style="${inp};margin-bottom:6px">
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" id="set-agent-create" style="padding:5px 12px">Describe → draft it</button>
        <span id="set-agent-create-stat" style="font-size:11.5px;color:var(--text-3)"></span>
      </div></div>` : ''}
    </div>`;
  const box = pane.querySelector('#set-agent-catalog');
  const draftsBox = pane.querySelector('#set-agent-drafts');
  const badge = (label, color) => `<span style="font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;padding:1px 5px;border-radius:4px;background:${color};color:#fff;margin-left:6px">${escapeHtml(label)}</span>`;

  const renderDrafts = (drafts) => {
    if (!drafts.length) return '';
    const cards = drafts.map(d => `<div class="draft-card" data-id="${escapeHtml(d.id)}" style="border:.5px solid var(--border);border-radius:7px;padding:9px 10px;margin-top:6px;background:var(--bg)">
        <div style="font-weight:600;font-size:12px">${escapeHtml(d.displayName||d.id)}${badge(d.category||'critic', d.category==='doer'?'var(--text-3)':'var(--accent,#2c64c4)')}${d.execution==='local'?badge('local','#8a6d3b'):''}</div>
        <div style="font-size:11px;color:var(--text-3);margin:2px 0 6px">${escapeHtml(d.description||'')}</div>
        <textarea class="draft-prompt" rows="4" ${editable?'':'disabled'} style="${inp};font-size:11.5px;resize:vertical">${escapeHtml(d.systemPrompt||'')}</textarea>
        <div style="font-size:11px;color:var(--text-3);margin:4px 0">tools: ${escapeHtml((d.tools||[]).join(', ')||'none')}${d.cwd?` · cwd: ${escapeHtml(d.cwd)}`:''}</div>
        ${editable?`<div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-primary draft-approve" data-id="${escapeHtml(d.id)}" style="padding:4px 11px;font-size:11.5px">Approve</button>
          <button class="btn draft-delete" data-id="${escapeHtml(d.id)}" style="padding:4px 11px;font-size:11.5px">Delete</button>
          <span class="draft-stat" style="font-size:11.5px;color:var(--text-3)"></span></div>`:''}
      </div>`).join('');
    return `<h4 style="margin:0 0 2px">Drafts — review before they run</h4>
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:2px">Claude drafted these from your descriptions. Edit the prompt if needed, then Approve to make it runnable.</div>${cards}`;
  };

  const refresh = async () => {
    try {
      const catalog = await loadAgentCatalog(t, _CFG);
      const { active, drafts } = partitionCatalog(catalog);
      box.innerHTML = agentCatalogHtml(agentCatalogView(active, _CFG.reviewAgents || []), { editable });
      draftsBox.innerHTML = renderDrafts(drafts);
      wireDrafts();
    } catch(e){ box.textContent = 'Could not load the agent catalog: ' + e.message; }
  };

  const wireDrafts = () => {
    draftsBox.querySelectorAll('.draft-approve').forEach(btn => btn.onclick = async () => {
      const card = btn.closest('.draft-card'); const id = btn.dataset.id || card.dataset.id;
      const prompt = card.querySelector('.draft-prompt').value; const stat = card.querySelector('.draft-stat');
      stat.style.color='var(--text-3)'; stat.textContent='Approving…';
      try { await writeAgentsJson(_CFG, t, list => approveAuthored(editAuthored(list, id, { systemPrompt: prompt }), id));
        await refresh(); } catch(e){ stat.style.color='var(--warn)'; stat.textContent='Failed: '+e.message; }
    });
    draftsBox.querySelectorAll('.draft-delete').forEach(btn => btn.onclick = async () => {
      const card = btn.closest('.draft-card'); const id = card.dataset.id; const stat = card.querySelector('.draft-stat');
      stat.style.color='var(--text-3)'; stat.textContent='Deleting…';
      try { await writeAgentsJson(_CFG, t, list => deleteAuthored(list, id)); await refresh(); }
      catch(e){ stat.style.color='var(--warn)'; stat.textContent='Failed: '+e.message; }
    });
  };

  refresh();

  const save = pane.querySelector('#set-agents-save');
  if (save && editable) save.onclick = async () => {
    const stat = pane.querySelector('#set-agents-stat');
    const list = [...box.querySelectorAll('input[data-agent]:checked')].map(el => el.dataset.agent);
    stat.style.color='var(--text-3)'; stat.textContent='Saving…';
    try { await writeProjectPatch(_CFG, _projectId, { reviewAgents: list }, t); _CFG = { ..._CFG, reviewAgents: list };
      stat.style.color='var(--success)'; stat.textContent = list.length?`Saved ${list.length} agent(s).`:'Cleared.';
      if (document.getElementById('btn-send')) renderTopbar();
    } catch(e){ stat.style.color='var(--warn)'; stat.textContent='Failed: '+e.message; }
  };

  const create = pane.querySelector('#set-agent-create');
  if (create && editable) create.onclick = async () => {
    const stat = pane.querySelector('#set-agent-create-stat');
    const name = pane.querySelector('#set-agent-name').value;
    const brief = pane.querySelector('#set-agent-brief').value;
    if (!brief.trim()) { stat.style.color='var(--warn)'; stat.textContent='Describe what it should do first.'; return; }
    const job = buildAuthorJob(name, brief, { cwd: pane.querySelector('#set-agent-cwd').value.trim(), wantsTools: pane.querySelector('#set-agent-tools').checked });
    create.disabled = true; stat.style.color='var(--text-3)'; stat.textContent='Queuing…';
    try {
      const { json, sha } = await getJson(t, 'jobs.json'); const jobs = Array.isArray(json) ? json : [];
      jobs.push({ id:'j_'+Date.now().toString(36), ...job, status:'queued', requested_ts:new Date().toISOString() });
      await putJson(t, 'jobs.json', jobs, sha, 'agents: author-agent request');
      try { await ensureApplyEngine(DATA_REPO, t); await dispatchApply(t, _CFG.dataPrefix ? _projectId : ''); } catch(_){}
      pane.querySelector('#set-agent-name').value=''; pane.querySelector('#set-agent-brief').value=''; pane.querySelector('#set-agent-cwd').value=''; pane.querySelector('#set-agent-tools').checked=false;
      stat.style.color='var(--success)'; stat.textContent='Queued — Claude is drafting it on your Actions. Reopen this panel in a minute to review the draft.';
    } catch(e){ stat.style.color='var(--warn)'; stat.textContent='Failed: '+e.message; }
    finally { create.disabled = false; }
  };
}
// Claude / AI section. OFF: an understated card + the master toggle, nothing else (not AI-forward).
// ON: status card (connected via <secret> / not connected) + Connect / Manage → dialog, + Run apply.
// Local/Cloud review-processing toggle (lives in the Claude/AI settings section). Writes the mode to
// projects.json AND commits <prefix>mode.json — the exact marker the CI engine's hard gate reads — so
// flipping it mechanically works: Local makes cloud apply inert, Cloud arms it (experimental until parity).
function pmToggleCard() {
  const isCloud = processingMode(_CFG) === 'cloud';
  return `<div class="set-card">
    <style>.pm-seg{display:inline-flex;border:.5px solid var(--border);border-radius:8px;overflow:hidden}
      .pm-b{border:none;background:var(--bg);padding:6px 13px;cursor:pointer;font:inherit;font-size:12.5px;color:var(--text);border-right:.5px solid var(--border)}
      .pm-b:last-child{border-right:none}.pm-b.on{background:var(--accent,#2c64c4);color:#fff}</style>
    <h4>Review processing</h4>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Where queued review work runs. <b>Local</b> (default): you run it on your machine (<code>process_reviews.py</code> + Claude Code) — the trusted route. <b>Cloud</b>: GitHub Actions runs it — experimental, not yet at local parity.</div>
    <div class="pm-seg" id="pm-seg">
      <button type="button" class="pm-b${isCloud ? '' : ' on'}" data-mode="local">Local · Claude Code</button>
      <button type="button" class="pm-b${isCloud ? ' on' : ''}" data-mode="cloud">Cloud · Actions</button>
    </div>
    <div id="pm-stat" style="font-size:11.5px;color:var(--text-3);margin-top:8px"></div>
  </div>`;
}
function wirePmToggle(pane, t) {
  const seg = pane.querySelector('#pm-seg'); if (!seg) return;
  seg.querySelectorAll('.pm-b').forEach(b => b.onclick = async () => {
    const mode = b.dataset.mode;
    if (mode === processingMode(_CFG)) return;
    const stat = pane.querySelector('#pm-stat'); stat.style.color = 'var(--text-3)'; stat.textContent = 'Switching…';
    try {
      if (_projectId && _CFG.hubRepo) await writeProjectPatch(_CFG, _projectId, processingModePatch(mode), t);
      _CFG.processingMode = mode;
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(modeMarker(mode), null, 2))));
      await putFile(t, dataPath(_CFG, 'mode.json'), content, `mode: switch to ${mode} processing`);
      seg.querySelectorAll('.pm-b').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
      stat.style.color = 'var(--success)';
      stat.textContent = mode === 'cloud'
        ? 'Cloud mode — GitHub Actions will process reviews (experimental).'
        : 'Local mode — run process_reviews.py to process; cloud CI is inert.';
      if (document.getElementById('btn-send')) renderTopbar();   // refresh the Send-to-Claude pill
    } catch (e) { stat.style.color = 'var(--warn)'; stat.textContent = 'Failed: ' + escapeHtml((e && e.message) || 'error'); }
  });
}

async function renderSettingsAI(pane, t) {
  const on = assistantOn();
  if (!on) {
    pane.innerHTML = pmToggleCard() + `<div class="set-card">
      <h4>AI assistant</h4>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Off by default. The core review flow — comment → stage → approve → merge — works fully without AI. Turn on to send comments to Claude on your own GitHub Actions + credentials.</div>
      <button class="btn" id="set-ai-toggle" style="padding:5px 14px">Turn on</button>
    </div>`;
    wirePmToggle(pane, t);
    pane.querySelector('#set-ai-toggle').onclick = () => { toggleAssistant(); openSettingsPage('ai'); };
    return;
  }
  pane.innerHTML = pmToggleCard() + `<div class="set-card"><div id="set-ai-conn" class="set-status">Checking…</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="set-ai-connect" style="padding:5px 12px">Connect / manage Claude</button>
        <button class="btn" id="set-ai-run" style="padding:5px 12px"><i class="ti ti-player-play"></i>Run apply now</button>
        <span id="set-ai-run-stat" style="font-size:11.5px;color:var(--text-3);align-self:center"></span>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:10px"><i class="ti ti-git-branch"></i> Every Claude edit stages on a <code>review-edits/&lt;${escapeHtml(UNIT)}&gt;</code> branch for you to approve — nothing reaches your document without your say-so.</div>
      <div style="margin-top:10px"><button class="btn" id="set-ai-off" style="padding:4px 11px;font-size:11.5px;color:var(--text-3)">Turn AI assistant off</button></div>
    </div>` + modelBudgetCard();
  wireModelBudget(pane, t);
  const conn = pane.querySelector('#set-ai-conn');
  try { const s = claudeConnectionStatus(await listSecretNames(t));
    conn.innerHTML = s.claude ? `<span class="ok">✓</span> Claude connected via <code>${s.via}</code> — every paper in ${escapeHtml(DATA_REPO)} is set.` : '<span class="warn">●</span> Not connected — add your Claude Code token.';
  } catch(e){ conn.innerHTML = (e && e.code === 'NOSCOPE')
      ? '<span class="warn">●</span> Can’t verify from here — your access token can’t list secrets. If you connected Claude before, it still works. To connect or change it, use <b>Connect / manage Claude</b> below with a token that has <b>Secrets + Actions</b> access.'
      : 'Couldn’t check connection: ' + escapeHtml((e && e.message) || 'error'); }
  pane.querySelector('#set-ai-connect').onclick = () => openClaudeDialog(t);
  pane.querySelector('#set-ai-run').onclick = async () => {
    const stat = pane.querySelector('#set-ai-run-stat'); stat.style.color='var(--text-3)'; stat.textContent='Ensuring engine…';
    try { await ensureApplyEngine(DATA_REPO, t); stat.textContent='Dispatching…'; await dispatchApply(t, _CFG.dataPrefix ? _projectId : '');
      stat.style.color='var(--success)'; stat.textContent='Apply run started — watch your repo’s Actions tab.'; }
    catch(e){ stat.style.color='var(--warn)'; stat.textContent = (e.message==='workflow-scope'||isScopeError(e)) ? 'Your Owner key needs Actions + Workflows access to run apply — update it under Access &amp; tokens (or use a classic repo+workflow token).' : 'Failed: '+escapeHtml((e && e.message)||'error'); }
  };
  const off = pane.querySelector('#set-ai-off'); if (off) off.onclick = () => { toggleAssistant(); openSettingsPage('ai'); };
  wirePmToggle(pane, t);
}

// The cloud model + per-job budget cap — all GitHub Actions variables the engine reads (CLAUDE_MODEL,
// AGENT_MODELS, COST_CAP_USD, MAX_CLAUDE_CALLS). The DEFAULT model runs EVERYTHING (writer + every agent)
// unless a specific agent is overridden below — so "Opus for everything" is one setting, and cost-cutting
// a light agent to Sonnet is a per-agent choice. Model values are Claude Code CLI aliases (opus/sonnet/
// haiku) that resolve to the LATEST of each tier, so the list stays current as new models ship. Only
// relevant in Cloud mode (local runs use your own Claude Code).
function _modelOptions(selected, includeInherit) {
  const opts = includeInherit ? [{ value: AI_INHERIT, label: 'Default (use the model above)' }] : [];
  for (const m of AI_MODELS) opts.push({ value: m.value, label: m.label });
  const sel = String(selected == null ? '' : selected).trim();
  if (sel && !opts.some(o => o.value === sel)) opts.push({ value: sel, label: sel });   // pinned legacy id
  return opts.map(o => `<option value="${escapeHtml(o.value)}"${o.value === sel ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}
function modelBudgetCard() {
  const inp = 'width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)';
  return `<div class="set-card" id="set-mb">
    <h4>Cloud model &amp; budget</h4>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">What the <b>cloud</b> review runs use. The default model runs <b>everything</b> — the writer and every review agent — unless you override an individual agent below. For a dissertation, leaving the default on <b>Opus</b> uses the best model throughout; drop a light, high-volume agent to Sonnet to trim cost. (Local runs use your own Claude Code and ignore these.)</div>
    <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Default model <span style="font-weight:400;color:var(--text-3)">— used by everything unless overridden</span></label>
    <select id="mb-model" style="${inp};margin-bottom:12px">${_modelOptions(AI_DEFAULT_MODEL, false)}</select>
    <details style="margin-bottom:12px"><summary style="cursor:pointer;font-size:12px;font-weight:600">Per-agent overrides <span style="font-weight:400;color:var(--text-3)">— optional</span></summary>
      <div id="mb-agents" style="margin-top:8px;font-size:11.5px;color:var(--text-3)">Loading your review agents…</div></details>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <label style="flex:1;min-width:120px;font-size:12px;font-weight:600">Cost cap (USD / job)
        <input id="mb-cost" type="number" min="0" step="0.5" placeholder="off" style="${inp};margin-top:4px;font-weight:400"></label>
      <label style="flex:1;min-width:120px;font-size:12px;font-weight:600">Max Claude calls / job
        <input id="mb-calls" type="number" min="1" step="1" placeholder="100" style="${inp};margin-top:4px;font-weight:400"></label>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-top:8px">A job stops as soon as either cap is hit and tells you in Cloud Activity. Cost cap blank = off; calls default 100.</div>
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="btn btn-primary" id="mb-save" style="padding:5px 14px">Save</button><span id="mb-stat" style="font-size:11.5px;color:var(--text-3)"></span></div>
  </div>`;
}
async function wireModelBudget(pane, t) {
  const sel = pane.querySelector('#mb-model'), cost = pane.querySelector('#mb-cost'),
        calls = pane.querySelector('#mb-calls'), stat = pane.querySelector('#mb-stat'),
        agentsBox = pane.querySelector('#mb-agents');
  if (!sel) return;
  let agentModels = {};   // {agentId: alias} loaded from the AGENT_MODELS variable
  // best-effort prefill from the current variables (a scope-limited token just leaves defaults)
  try {
    const [m, am, c, n] = await Promise.all([
      getVariable(t, 'CLAUDE_MODEL').catch(() => null),
      getVariable(t, 'AGENT_MODELS').catch(() => null),
      getVariable(t, 'COST_CAP_USD').catch(() => null),
      getVariable(t, 'MAX_CLAUDE_CALLS').catch(() => null)]);
    if (m) { sel.innerHTML = _modelOptions(m, false); }   // reflect the saved default (adds a pinned id if legacy)
    if (am) { try { const p = JSON.parse(am); if (p && typeof p === 'object') agentModels = p; } catch {} }
    if (c && Number(c) > 0) cost.value = c;
    if (n && Number(n) > 0) calls.value = n;
  } catch {}
  // Per-agent overrides: one dropdown per cloud-runnable review agent (defaults to "inherit the default").
  try {
    const catalog = await loadAgentCatalog(t, _CFG);
    const { runnable } = splitAgentsForCloud(catalog, _CFG.reviewAgents || []);
    if (agentsBox) {
      agentsBox.innerHTML = runnable.length
        ? runnable.map(a => `<label style="display:flex;align-items:center;gap:8px;margin:6px 0">
            <span style="flex:1;min-width:0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(a.displayName || a.id)}">${escapeHtml(a.displayName || a.id)}</span>
            <select data-agent-model="${escapeHtml(a.id)}" style="flex:0 0 auto;font:inherit;font-size:11.5px;padding:4px 6px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">${_modelOptions(agentModels[a.id] || AI_INHERIT, true)}</select></label>`).join('')
        : 'No cloud review agents configured yet — add some in the Agents section.';
    }
  } catch (e) { if (agentsBox) agentsBox.textContent = 'Could not load your review agents: ' + ((e && e.message) || 'error'); }
  pane.querySelector('#mb-save').onclick = async () => {
    stat.style.color = 'var(--text-3)'; stat.textContent = 'Saving…';
    // Build the per-agent map from the dropdowns; only non-inherit choices are persisted.
    const map = {};
    pane.querySelectorAll('[data-agent-model]').forEach(s => { if (s.value && s.value !== AI_INHERIT) map[s.dataset.agentModel] = s.value; });
    try {
      await setVariable(t, 'CLAUDE_MODEL', sel.value);
      await setVariable(t, 'AGENT_MODELS', Object.keys(map).length ? JSON.stringify(map) : '');
      await setVariable(t, 'COST_CAP_USD', String(Number(cost.value) > 0 ? Number(cost.value) : 0));
      await setVariable(t, 'MAX_CLAUDE_CALLS', String(Number(calls.value) > 0 ? Math.round(Number(calls.value)) : 100));
      stat.style.color = 'var(--success)'; stat.textContent = 'Saved ✓ — applies to the next cloud run.';
    } catch(e){
      stat.style.color = 'var(--warn)';
      stat.textContent = isScopeError(e) ? 'Your access token needs Actions access to set these (Connect Claude with a capable token).' : 'Failed: ' + escapeHtml((e && e.message) || 'error');
    }
  };
}
// Connect Claude dialog: primary = paste the `claude setup-token` value (CLAUDE_CODE_OAUTH_TOKEN);
// Advanced = Anthropic API key fallback. Save seals via setAiSecrets + self-heals the engine.
function openClaudeDialog(t) {
  const box = document.createElement('div');
  box.innerHTML = `
    <div style="font-size:12.5px;margin-bottom:8px">On your computer run <code>claude setup-token</code>, sign in, and paste the token it prints (recommended — no API bill; counts against your Claude plan).</div>
    <input id="set-claude-tok" type="password" placeholder="CLAUDE_CODE_OAUTH_TOKEN" style="width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);margin-bottom:8px">
    <details style="margin-bottom:8px"><summary style="cursor:pointer;color:var(--text-3);font-size:11.5px">Prefer an Anthropic API key? (billed per token)</summary>
      <input id="set-claude-key" type="password" placeholder="sk-ant-… (ANTHROPIC_API_KEY)" style="width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);margin-top:8px"></details>
    <input id="set-claude-etok" type="password" placeholder="GitHub token with Secrets + Actions access (only if the saved one can’t)" style="display:none;width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:.5px solid var(--warn);border-radius:6px;background:var(--bg);color:var(--text);margin-bottom:8px">
    <div id="set-claude-stat" style="font-size:11.5px;color:var(--text-3)"></div>`;
  openModal('<i class="ti ti-robot-face" style="margin-right:7px"></i>Connect Claude', box, [
    { label:'Save & connect', primary:true, onClick: async (close) => {
      const stat = box.querySelector('#set-claude-stat');
      const values = { claudeCodeToken: box.querySelector('#set-claude-tok').value, anthropicKey: box.querySelector('#set-claude-key')?.value || '' };
      if (!values.claudeCodeToken.trim() && !values.anthropicKey.trim()){ stat.textContent='Paste your Claude Code token (or an API key) first.'; return; }
      const etok = (box.querySelector('#set-claude-etok').value || '').trim() || t;   // elevated one-time token if the saved login can't write secrets
      stat.style.color='var(--text-3)'; stat.textContent='Sealing…';
      try { const names = await setAiSecrets(etok, sealToBase64, values);
        if (!names.length){ stat.textContent='Paste your Claude Code token (or an API key) first.'; return; }
        try { await ensureApplyEngine(DATA_REPO, etok); } catch {}
        close(); flash('Saved ' + names.join(' + ') + ' to your Review repo.'); openSettingsPage('ai');
      } catch(e){
        if (isScopeError(e)){ const ef = box.querySelector('#set-claude-etok'); if (ef){ ef.style.display='block'; ef.focus(); } stat.style.color='var(--warn)'; stat.textContent='Your saved access token can’t write secrets. Paste a token with Secrets + Actions access (fine-grained) or a classic repo+workflow token above, then Save again.'; }
        else { stat.style.color='var(--warn)'; stat.textContent='Failed: '+escapeHtml((e && e.message)||'error'); }
      }
    } },
  ]);
}
// ---------- release gate: control which chapters each advisor's portal shows ----------
async function openReleasePanel(opts){
  const openEmailOnLoad = !!(opts && opts.openEmail === true);   // Settings→Email deep-link opens the wizard directly
  const t = tok(); if (!t){ flash('Add your access token first.'); return; }
  stopOwnerLiveSync();
  document.getElementById('nav').style.display = 'none';
  document.getElementById('comments').style.display = 'none';
  document.getElementById('topbar').innerHTML =
    `<strong style="font-size:16px;font-weight:600"><i class="ti ti-users" style="margin-right:7px"></i>Reviewers</strong>
     <button class="btn" id="rel-close" style="margin-left:auto"><i class="ti ti-arrow-left"></i>Back to ${UNIT}s</button>`;
  document.getElementById('rel-close').onclick = enterHome;
  read.innerHTML = `<div class="rel-page"><div id="rel-body" style="color:var(--text-3)">Loading…</div></div>`;
  let rel, sha;
  try { const r = await getJson(t, 'release.json'); rel = r.json || {}; sha = r.sha; }
  catch(e){ document.getElementById('rel-body').textContent = 'Could not load release.json ('+e.message+').'; return; }
  if (!rel.general) rel.general = { name:'General reviewers', released:[] };   // shared lab-reviewer gate
  const advs = Object.keys(rel).filter(k => k !== '_comment');                 // gating rows + portal links
  const base = location.origin + location.pathname.replace(/[^/]+$/, '');
  const { reg: advReg, sha: advSha } = await loadAdvisorsRegistry(t);
  await loadReviewerKeyIntoCache(t);   // back-fill the reviewer key from the private repo so the copy-link works on any browser
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
        ${assistantOn() ? `<button class="btn rel-sendall" data-a="${a}" style="padding:2px 9px;font-size:11.5px;margin-left:6px" ${unread?'disabled title="Read every comment from this reviewer first"':''}><i class="ti ti-send"></i>Send unsent</button>` : ''}
        <button class="rel-del" data-a="${a}" data-count="${items.length}" title="Remove this reviewer's comments from your inbox" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:none;background:none;color:var(--text-3);cursor:pointer;font-size:13px;margin-left:2px;opacity:0;transition:opacity .12s"><i class="ti ti-trash"></i></button></div>
        <div style="font-size:11.5px;color:var(--text-3);margin:-1px 0 8px">${assistantOn() ? 'Reply, suggest edits, and send to Claude from the comment itself' : 'Reply, suggest edits, and record resolutions from the comment itself'} — click <b>Open in context</b>.</div>${
      items.length ? items.map(({chapter, c}) => cmtRow(a, chapter, c)).join('') : `<div style="font-size:12.5px;color:var(--text-3);padding:6px 2px">No comments submitted yet.</div>` }</div>`;
  }).join('');
  document.getElementById('rel-body').innerHTML = `
    <div class="rel-sec">Access — which ${UNIT}s each reviewer sees</div>
    <table class="rel-tbl"><thead><tr><th>${UNITC}</th>${advs.map(a => `<th>${escapeHtml(a)}<div style="font-weight:400;font-size:10px;color:var(--text-3)">${escapeHtml(rel[a].name||a)}</div></th>`).join('')}</tr></thead><tbody>${rows}<tr style="border-top:2px solid var(--border-2)"><td>Release responses<div style="font-weight:400;font-size:10px;color:var(--text-3)">let them see how you addressed their comments</div></td>${advs.map(a => `<td style="text-align:center"><input type="checkbox" data-resp="${a}" ${rel[a].responses_released?'checked':''}></td>`).join('')}</tr></tbody></table>
    <div style="display:flex;gap:8px;margin:14px 0 6px;align-items:center"><button class="btn btn-primary" id="rel-save">Save &amp; publish</button><span id="rel-stat" style="font-size:12px;color:var(--text-3)"></span></div>
    <div class="rel-links">${advs.map(a => {
        // Legacy committee members have dedicated pages; the shared lab pool uses review-lab.html;
        // everyone added through the Advisors feature uses the generic advisor.html?a=<id> portal.
        const _d = `data=${encodeURIComponent(DATA_REPO)}`;
        const url = a === 'general' ? `${base}review-lab.html?${_d}`
          : (a === 'CJS' || a === 'CCS') ? `${base}${a}.html?${_d}`
          : advisorUrl(a, rel[a].name);
        return `<div><b>${escapeHtml(rel[a].name||a)}</b> → <code>${escapeHtml(url)}</code></div>`;
      }).join('')}</div>
    <div class="rel-sec" style="margin-top:26px">People</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Add a reviewer to create their portal and (with an email) send them an invite with their link + access key. The access key can read released ${UNIT}s and write only review comments; keep it private.</div>
    <div class="advadd" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:center;margin-bottom:12px">
      <input id="adv-name" placeholder="Full name" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <input id="adv-email" type="email" placeholder="Email (to send the invite)" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <input id="adv-title" placeholder="Title (optional)" style="font:inherit;font-size:13px;padding:7px 9px;border:.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);outline:none">
      <button class="btn btn-primary" id="adv-add"><i class="ti ti-user-plus"></i>Add &amp; invite</button>
    </div>
    <div id="adv-list"></div>
    <div id="adv-stat" style="font-size:12px;color:var(--text-3);margin:6px 0 18px"></div>
    <div id="adv-email-banner"></div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3);border:.5px solid var(--border);border-radius:8px;padding:8px 11px;margin:0 0 12px">
      <i class="ti ti-key"></i> Reviewer key: ${advisorKey() ? 'set' : 'not set'} — carried in every reviewer invite link.
      <button id="adv-key-tosettings" class="btn" style="padding:3px 10px;font-size:11px;margin-left:auto">Manage in Settings</button></div>
    <div id="rel-board"></div>
    <div class="rel-sec" style="margin-top:26px">Inbox — comments received</div>${inboxHtml}
    <div id="rel-preflight" style="margin-top:26px"></div>`;
  const refresh = () => openReleasePanel();
  // panel is overview-only: read-gate + batch send + open-in-context. All in-place (no full re-fetch).
  const syncAdvHeader = a => {
    const box = document.querySelector(`.rel-inbox[data-adv="${a}"]`); if (!box) return;
    const unread = unreadOf(a);
    box.querySelector('.rel-unread').innerHTML = advHeadHtml(a);
    const send = box.querySelector('.rel-sendall'); if (send){ send.disabled = unread > 0; send.title = unread > 0 ? 'Read every comment from this reviewer first' : ''; }
    wireHeader(box, a);
  };
  function wireHeader(box, a){
    const ra = box.querySelector('.rel-readall'); if (ra) ra.onclick = async () => {
      ra.disabled = true; ra.textContent = 'Marking…';
      try { for (const {chapter, c} of (inbox[a]||[])) if (!c.read){ await markAdvisorRead(a, chapter, c.id); c.read = true; }
        box.querySelectorAll('.rel-row').forEach(r => { r.classList.add('is-read'); const cb = r.querySelector('.rel-readbox'); if (cb) cb.checked = true; }); syncAdvHeader(a); }
      catch(e){ ra.textContent = 'Failed'; }
    };
    const sa = box.querySelector('.rel-sendall'); if (sa) sa.onclick = async () => {   // absent when AI off
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
      ? `Delete all ${n} comment${n!==1?'s':''} from ${label}? This removes them from your inbox permanently (recoverable only from the Review repo's git history). The reviewer stays on your list and can still comment again later.`
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
  // Default Reviewers view for email is a one-line pointer to Settings (the coupled SMTP wizard stays
  // here in code but is entered from Settings → Email, which deep-links via openReleasePanel({openEmail:true})).
  const renderEmailPointer = () => {
    const box = document.getElementById('adv-email-banner'); if (!box) return;
    const ok = emailConfigured();
    box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3);border:.5px solid var(--border);border-radius:8px;padding:8px 11px;margin-bottom:12px">
      <i class="ti ti-${ok?'circle-check':'mail'}" style="color:var(--${ok?'success':'text-3'})"></i> Email invites: ${ok?'set up':'not set up'}.
      <button id="adv-email-manage" class="btn" style="padding:3px 10px;font-size:11px;margin-left:auto">Manage in Settings</button></div>`;
    const mb = document.getElementById('adv-email-manage'); if (mb) mb.onclick = () => openSettingsPage('email');
  };
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
    const dataRepo = DATA_REPO;   // where the invite workflow + secrets live
    box.innerHTML = `
      <div style="border:.5px solid var(--warn);background:var(--warn-bg);border-radius:9px;padding:11px 13px;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <i class="ti ti-alert-triangle" style="color:var(--warn);font-size:15px;margin-top:1px"></i>
          <div style="font-size:12.5px;line-height:1.5;color:var(--text)">
            <b>Email invites aren't set up yet.</b> You can still add reviewers and open their portals — but no invite email is sent automatically. Connect email once and future invites go out on their own; until then, copy each reviewer's portal link and send it yourself.
            <div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap">
              <button id="adv-email-connect" class="btn btn-primary" style="padding:4px 11px;font-size:11.5px"><i class="ti ti-plug"></i>Connect email</button>
              <button id="adv-email-toggle" class="btn" style="padding:4px 10px;font-size:11.5px"><i class="ti ti-book"></i>Set it up manually</button>
            </div>
          </div>
        </div>
        <div id="adv-email-guide" style="display:none;margin:11px 0 2px;padding-top:11px;border-top:.5px solid var(--warn);font-size:12px;line-height:1.6;color:var(--text-2)">
          <div style="font-weight:600;color:var(--text);margin-bottom:5px">One-time setup — you don't have to use Gmail</div>
          Invites are sent by a GitHub Action in your Review repo (<code>${dataRepo}</code>), using any SMTP mail server. Pick whichever you like:
          <ul style="margin:7px 0 7px 16px;padding:0">
            <li><b>Institutional / work email</b> — ask IT for the SMTP host, port, and whether an app password is needed (e.g. Georgia Tech, Outlook/Office 365: <code>smtp.office365.com</code> port <code>587</code>).</li>
            <li><b>Gmail</b> — turn on 2-Step Verification, then create an <i>App Password</i> (Google Account → Security → App passwords). Host <code>smtp.gmail.com</code>, port <code>465</code>. Note: some Google Workspace accounts (incl. some GT accounts) disable app passwords — use a transactional service or institutional SMTP instead.</li>
            <li><b>Transactional service</b> (no personal inbox needed) — Resend, SendGrid, Mailgun, Postmark. They give you an SMTP host, port, username, and key.</li>
          </ul>
          <div style="font-weight:600;color:var(--text);margin:8px 0 4px">Add these in the Review repo</div>
          <div style="margin-bottom:3px">Settings → Secrets and variables → Actions, in <code>${dataRepo}</code>:</div>
          <div style="font-size:11.5px;margin-left:2px">
            <b>Secrets</b> — <code>SMTP_USER</code> (login / from-address), <code>SMTP_PASS</code> (password, app password, or API key), <code>ADVISOR_KEY</code> (the access key reviewers paste). Optional: <code>SMTP_HOST</code>, <code>SMTP_PORT</code> (default Gmail <code>smtp.gmail.com</code>:<code>465</code>), <code>SMTP_FROM_NAME</code>.<br>
            <b>Variables</b> — <code>AUTHOR_NAME</code> (shown in the invite), <code>PORTAL_BASE</code> (your site URL, e.g. <code>${portalBase()}</code>), <code>DOC_NOUN</code> (the word for your document, e.g. <code>${DOC}</code>).
          </div>
          <div style="margin-top:8px">Or with the GitHub CLI:</div>
          <pre style="background:var(--bg);border:.5px solid var(--border);border-radius:7px;padding:8px 10px;margin:5px 0;font-size:11px;overflow-x:auto;white-space:pre">gh secret set SMTP_USER --repo ${dataRepo}
gh secret set SMTP_PASS --repo ${dataRepo}
gh secret set ADVISOR_KEY --repo ${dataRepo}
# optional non-Gmail server:
gh secret set SMTP_HOST --repo ${dataRepo}    # e.g. smtp.office365.com
gh secret set SMTP_PORT --repo ${dataRepo}    # e.g. 587
gh variable set AUTHOR_NAME --repo ${dataRepo}
gh variable set PORTAL_BASE --repo ${dataRepo}
gh variable set DOC_NOUN --repo ${dataRepo}    # e.g. ${DOC}</pre>
          Once set, add a reviewer (or hit <b>Resend</b>) — the invite goes out and this notice clears.
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
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=' + encodeURIComponent(_CFG.brand.name + ' email setup');
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  // The elevated token must do THREE things: write secrets (getPublicKey), and read+dispatch Actions
  // (latestRun proxies Actions access). Checking only secrets let a Secrets-but-not-Actions token
  // through, then latestRun 403'd ("Failed: runs 403"). Returns the public key when fully capable,
  // null when a permission is missing, and rethrows genuine/transient errors.
  const checkAccess = async (token) => {
    let pk;
    try { pk = await getPublicKey(token); }      catch(e){ if (isScopeError(e)) return null; throw e; }
    // Repo-level Actions probe — NOT the invite workflow (which may not be seeded yet), so a missing
    // invite.yml can't be misread as "token lacks Actions". ensureInvitePipeline seeds it before dispatch.
    try { await checkActionsAccess(token); }     catch(e){ if (isScopeError(e)) return null; throw e; }
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
           <label style="font-size:12px">From address reviewers will see<div style="font-size:11px;color:var(--text-3);font-weight:400;margin:2px 0 3px">Your real, verified sender email (add it under Senders in Brevo).</div>
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
          if (P.separateLogin && !S.from.trim()){ $('ce-stat').textContent = 'Enter the From address reviewers will see (your verified sender).'; return; }
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
            else stat.innerHTML = 'Connected, but the app can\'t reach your Review repo yet — make sure the GitHub App is <b>installed on your Review repo</b>, then try again.';
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
           <label style="font-size:12px">Reviewer access key <span style="color:var(--text-3);font-weight:400">(the token reviewers paste to read ${UNIT}s + comment)</span>
             <div style="font-size:11px;color:var(--text-3);font-weight:400;margin:3px 0 4px;line-height:1.5">This is your <b>Reviewer key</b> — a <b>least-privilege</b> GitHub token, <b>not</b> your Owner key or account PAT (it gets emailed to every reviewer). Create a <a href="https://github.com/settings/personal-access-tokens/new?name=Footnote%20reviewer%20key" target="_blank" rel="noopener">fine-grained token</a> with access to <b>only</b> your Review repo <code>${dataRepoParts(_CFG).repo}</code> and <b>Contents: Read and write</b>, and set <b>Expiration → No expiration</b> so it never needs rotating. Leave blank to keep the current one.</div>
             <input id="ce-advkey" type="password" value="${escapeHtml(S.advkey)}" placeholder="paste the reviewer access token (or leave blank)" style="${inputCss}"></label>
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
    // A read/write permission gap. If we're on the saved LOGIN token (which can read but often can't write
    // secrets/variables/workflows), route to the one-time-token step so a capable token is actually used —
    // that's the real unblock. If a pasted token still lacks a permission, name exactly which one to add.
    const onScopeError = (e) => {
      if (!S.needToken){
        S.needToken = true; S.savedPk = null; S.step = 'token'; render();
        const st = document.getElementById('ce-stat');
        if (st) st.innerHTML = 'Your GitHub sign-in can read your repo but can\'t <b>save these settings</b>. Paste a one-time token below — use the <b>Generate token</b> link (keep <b>repo</b> and <b>workflow</b> checked). It\'s used once and never stored.';
        return;
      }
      const perm = permissionFromError(e && e.message);
      const repo = escapeHtml(dataRepoParts(_CFG).repo);
      stat.innerHTML = perm
        ? `That token is missing <b>${perm}: Read and write</b> on <code>${repo}</code>. Easiest fix: click <b>Generate token</b> (a classic <b>repo</b> + <b>workflow</b> token) — it covers Secrets, Variables, Actions, and Workflows in one.`
        : 'That token was rejected: ' + escapeHtml((e && e.message) || 'unknown');
    };
    stat.textContent = 'Checking access…';
    let pk;
    try { pk = (S.needToken || !S.savedPk) ? await checkAccess(etok) : S.savedPk; }
    catch(e){ stat.textContent = 'Access check failed: ' + e.message; return; }
    if (!pk){
      if (!S.needToken){ onScopeError(new Error('login')); return; }   // login can't read → get a capable token
      stat.innerHTML = `That token can't read <b>Secrets</b> or <b>Actions</b> on <code>${escapeHtml(dataRepoParts(_CFG).repo)}</code> — click <b>Generate token</b> (a classic <b>repo</b> + <b>workflow</b> token).`;
      return;
    }
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
      // token, never the owner's account PAT. Also cached locally (below) so the copy-link embeds it as &k=.
      if ((S.advkey || '').trim()) {
        await putSecret(etok, pk, sealToBase64, 'ADVISOR_KEY', S.advkey.trim());
        try { localStorage.setItem(advKeyStoreKey(), S.advkey.trim()); } catch (e) {}   // copy-link magic link
        saveReviewerKeyToRepo(etok, S.advkey.trim());   // durable private-repo copy → copy-link works on any browser
      }
      if (name) await putSecret(etok, pk, sealToBase64, 'SMTP_FROM_NAME', name);
      if (name) await setVariable(etok, 'AUTHOR_NAME', name);
      // Also persist the typed name to release.json (reviewer-readable) so the reviewer Home can show it
      // when the author's GitHub profile has no name. AUTHOR_NAME above is an Actions var reviewers can't read.
      if (name) try { const _t = tok(); const _g = await getJson(_t, 'release.json').catch(() => ({ json:null, sha:null })); const _rel = (_g.json && typeof _g.json === 'object') ? _g.json : {}; if (_rel.author_name !== name){ _rel.author_name = name; await putJson(_t, 'release.json', _rel, _g.sha, 'author: display name for reviewer Home'); } } catch (e) {}
      await setVariable(etok, 'PORTAL_BASE', portalBase());
      await setVariable(etok, 'DOC_NOUN', DOC);   // keeps the invite/notify emails document-agnostic (e.g. "paper", "proposal")
      // Ensure the invite/notify workflow exists in the data repo before dispatching it. A workspace repo
      // seeded render-only has no invite.yml, which otherwise 404s the dispatch. Idempotent (writes only
      // what's missing). Any permission block ('workflow-scope' etc.) bubbles to the catch → onScopeError.
      await ensureInvitePipeline(DATA_REPO, etok);
      // Email IS configured the moment the SMTP secrets are sealed — persist it NOW, reliably, instead of
      // gating it on reading a flaky workflow result. The CI's own advisors.json write kept not landing
      // (stale seed, timing, "no status change"), so email_configured kept reverting to unset. This app
      // write is the source of truth; the test send below stays a separate delivery confidence check.
      try { await mutateAdvisors(reg => { reg.email_configured = true; }, 'email: SMTP configured'); advReg.email_configured = true; } catch (e) {}
      stat.textContent = 'Sending a test email…';
      let _beforeTestTs = ''; try { const { json } = await getJson(tok(), 'advisors.json'); _beforeTestTs = json?.email_test?.ts || ''; } catch(e){}
      const before = (await latestRun(etok))?.id || 0;
      await dispatchInvite(etok, testTo);
      // Poll with etok (the capable token) — the saved login may lack Actions:read, which used to
      // 403 here AFTER a successful dispatch and mislead with "Actions not enabled".
      const deadline = Date.now() + 180000; let run = null;   // GitHub can queue a cold runner for a minute+
      while (Date.now() < deadline){
        await new Promise(r => setTimeout(r, 4000));
        run = await latestRun(etok);
        if (run && run.id !== before && run.status === 'completed') break;
        if (run && run.id !== before) stat.textContent = 'Sending… GitHub is running the send (this can take a minute).';
      }
      if (!run || run.status !== 'completed'){ stat.innerHTML = 'Saved, but the test run didn\'t finish in time. Check back in a minute and reopen.'; return; }
      // The run finished — but the workflow's email_test result (written to advisors.json) can lag the run's
      // "completed" status by a few seconds (commit propagation + raw-content CDN). Poll for a FRESH result so
      // a green run is never misreported as a failure (the "run concluded: success" bug).
      let et = null;
      for (let i = 0; i < 8; i++){
        const { json } = await getJson(tok(), 'advisors.json').catch(() => ({ json:null }));
        if (json){ advReg.email_configured = json.email_configured; if (json.email_test) et = json.email_test; }
        if (et && (et.ts || '') !== _beforeTestTs) break;   // a fresh result arrived
        await new Promise(r => setTimeout(r, 2500));
      }
      const _outcome = emailTestOutcome({ conclusion: run.conclusion, emailTest: et, beforeTs: _beforeTestTs });
      if (!_outcome.failed){
        advReg.email_configured = true;
        // Persist it ourselves — a green run means the send worked, and we can't rely on the CI's own
        // advisors.json write (a stale seeded CI / workspace-prefix quirk can leave email_configured blank
        // on the project file, so the health check kept saying "not set up" even after a successful test).
        try { await mutateAdvisors(reg => { reg.email_configured = true; reg.email_test = et || { ok:true, ts:new Date().toISOString(), error:null }; }, 'email: mark configured (test passed)'); } catch (e) {}
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
        stat.innerHTML = 'Test send failed: <code>' + escapeHtml(_outcome.error) + '</code><br>' + authHint(S.provider, _outcome.error);
      }
    } catch(e){
      if (isScopeError(e) || (e && e.message === 'workflow-scope')) onScopeError(e);
      else stat.textContent = 'Failed: ' + e.message;
    }
  };
  const renderAdvList = () => {
    renderEmailPointer();   // default email view is a one-line Settings pointer; the wizard is entered from Settings
    const box = document.getElementById('adv-list'); if (!box) return;
    if (!advReg.advisors.length){ box.innerHTML = `<div style="font-size:12.5px;color:var(--text-3)">No added reviewers yet.</div>`; return; }
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
          <button class="adv-del" data-id="${escapeHtml(a.id)}" title="Remove reviewer" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:var(--text-3);font-size:13px;opacity:0;transition:opacity .12s"><i class="ti ti-trash"></i></button></div>`;
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
  // One-click "invite a reviewer" (Lane D): name (+ optional email) → add to advisors.json → register
  // in release.json → the push-triggered invite workflow sends the magic-link email. Model A: the link
  // carries the SHARED access key; there is NO per-reviewer GitHub grant. inviteReadiness (pure, TDD'd)
  // validates + supplies the exact copy; ensureInvitePipeline self-heals a workspace/legacy repo whose
  // invite.yml was never seeded so the send actually fires; permissionFromError names any scope gap.
  const addAdvisor = async () => {
    const name = document.getElementById('adv-name').value.trim();
    const email = document.getElementById('adv-email').value.trim();
    const title = document.getElementById('adv-title').value.trim();
    const stat = document.getElementById('adv-stat');
    const ready = inviteReadiness({ name, email, emailConfigured: emailConfigured() });
    if (!ready.ok){ stat.textContent = ready.message; return; }
    const id = `${slugify(name)}-${rand4()}`;
    const entry = { id, name, email, title, added_ts:new Date().toISOString(), invited:false, invited_ts:null, invite_error:null };
    const btn = document.getElementById('adv-add'); if (btn) btn.disabled = true;
    stat.textContent = ready.willSend ? 'Adding reviewer and queuing their invite…' : 'Adding reviewer…';
    try {
      // Register the release-gate entry BEFORE pushing advisors.json. Pushing advisors.json fires the
      // push-triggered invite email; if the reviewer clicked before release.json held their id, the gate
      // (which treats an absent id as revoked) would falsely tell them "this link is no longer active".
      const { json:relNow, sha:relSha } = await getJson(t, 'release.json');
      relNow[id] = { name, released: [], responses_released: false };
      await putJson(t, 'release.json', relNow, relSha, `release: register ${name}`);
      // Guarantee invite.yml exists before the advisors.json push relies on the trigger to email them.
      // Idempotent; a missing workflow/contents scope throws and is named below instead of silently not sending.
      if (ready.willSend){ try { await ensureInvitePipeline(DATA_REPO, t); } catch(e){ ready._pipeErr = e; } }
      await mutateAdvisors(reg => reg.advisors.push(entry), `advisors: add ${name}`);   // last: fires the invite email
      const link = `<code>${escapeHtml(advisorUrl(id, name))}</code>`;
      const scope = ready._pipeErr ? permissionFromError(ready._pipeErr.message) : null;
      stat.innerHTML = scope
        ? `Added, but the invite couldn’t be queued — your token is missing <b>${escapeHtml(scope)}</b> access. Copy this portal link and send it yourself for now: ${link}`
        : `${escapeHtml(ready.message)} ${link}`;
      document.getElementById('adv-name').value = document.getElementById('adv-email').value = document.getElementById('adv-title').value = '';
      renderAdvList();
    } catch(e){
      const scope = permissionFromError(e.message);
      stat.textContent = scope ? `Failed — your token is missing ${scope} access.` : 'Failed: ' + e.message;
    } finally { if (btn) btn.disabled = false; }
  };
  const resendInvite = async (id) => {
    try { await mutateAdvisors(reg => { const a = reg.advisors.find(x=>x.id===id); if (a){ a.invited=false; a.invited_ts=null; a.invite_error=null; } }, `advisors: resend invite ${id}`);
      flash(emailConfigured() ? 'Invite re-queued — it will send shortly.' : 'Re-queued, but email isn\'t set up yet — no email will send until you configure it above.'); renderAdvList(); }
    catch(e){ flash('Failed: ' + e.message); }
  };
  // intentionally high-friction: must type the advisor's exact name. Removes them from the list +
  // release gate (their portal stops showing chapters); their already-submitted comments are kept.
  // Soft-delete: capture a tombstone (advisor entry + their release gate) so an accidental removal is
  // recoverable via an undo toast (restoreAdvisorPlan, pure + TDD'd). Non-destructive to comments.
  const restoreAdvisor = async (tomb) => {
    try {
      await mutateAdvisors(reg => { const p = restoreAdvisorPlan(tomb, reg, {}); reg.advisors = p.advisors; }, `advisors: restore ${tomb.advisor.name}`);
      const { json:relNow, sha:relSha } = await getJson(t, 'release.json');
      const plan = restoreAdvisorPlan(tomb, { advisors: [] }, relNow || {});
      await putJson(t, 'release.json', plan.release, relSha, `release: restore ${tomb.advisor.name}`);
      flash(`Restored ${tomb.advisor.name}.`); openReleasePanel();
    } catch(e){ flash('Restore failed: ' + e.message); }
  };
  // In-page confirm modal (replaces a native prompt()): the Remove button stays disabled until the
  // typed name matches, so the confirm gate survives but the UX matches the rest of the owner panel.
  const removeAdvisor = (id) => {
    const a = advReg.advisors.find(x => x.id === id); if (!a) return;
    const doRemove = async () => {
      let relEntry = null;
      try {
        await mutateAdvisors(reg => { const i = reg.advisors.findIndex(x=>x.id===id); if (i>=0) reg.advisors.splice(i,1); }, `advisors: remove ${a.name}`);
        try { const { json:relNow, sha:relSha } = await getJson(t, 'release.json');
          if (relNow && relNow[id]){ relEntry = relNow[id]; delete relNow[id]; await putJson(t, 'release.json', relNow, relSha, `release: remove ${a.name}`); } } catch(e){}
        const tomb = { advisor: a, release: relEntry || { name: a.name, released: [], responses_released: false } };
        undoToast(`Removed ${a.name}.`, () => restoreAdvisor(tomb));
        renderAdvList();
      } catch(e){ flash('Failed: ' + e.message); }
    };
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" style="max-width:460px">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Remove ${escapeHtml(a.name)}?</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px;line-height:1.55">This takes them off your reviewer list and revokes their ${escapeHtml(UNIT)} access. Comments they already submitted are kept — and you can undo right after.</div>
      <label style="font-size:12px;color:var(--text-2)">Type their full name to confirm
        <input id="rm-confirm" autocomplete="off" placeholder="${escapeHtml(a.name)}" style="width:100%;box-sizing:border-box;margin-top:5px;padding:8px 10px;border:.5px solid var(--border);border-radius:8px;font:inherit;font-size:12.5px"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn" id="rm-cancel">Cancel</button>
        <button class="btn" id="rm-go" style="background:var(--danger,#c0362c);color:#fff;border-color:transparent" disabled>Remove</button>
      </div></div>`;
    document.body.appendChild(scrim);
    const $ = s => scrim.querySelector(s);
    const close = () => scrim.remove();
    scrim.onclick = e => { if (e.target === scrim) close(); };
    $('#rm-cancel').onclick = close;
    const inp = $('#rm-confirm'), go = $('#rm-go');
    const match = () => inp.value.trim() === a.name.trim();
    inp.oninput = () => { go.disabled = !match(); };
    inp.onkeydown = e => { if (e.key === 'Enter' && match()){ e.preventDefault(); go.click(); } };
    go.onclick = () => { if (!match()) return; close(); doRemove(); };
    setTimeout(() => inp.focus(), 30);
  };
  document.getElementById('adv-add').onclick = addAdvisor;
  { const sk = document.getElementById('adv-key-tosettings'); if (sk) sk.onclick = () => openSettingsPage('access'); }
  renderAdvList();
  if (openEmailOnLoad) openConnectForm();   // Settings → Email deep-link opens the SMTP wizard directly

  // ---- Reviewer status board (Lane D feature 3) — per reviewer: units released, comments submitted,
  // last activity, invite state. Purely from data we already loaded (advReg/rel/inbox/pres); no invented
  // "opened the link" signal. reviewerStatus is pure + TDD'd.
  const renderStatusBoard = () => {
    const box = document.getElementById('rel-board'); if (!box) return;
    const named = new Set(advReg.advisors.map(a => a.id));
    const rows = reviewerStatus({ advisors: advReg.advisors, release: rel, inbox, presence: pres });
    if (!rows.length){ box.innerHTML = ''; return; }
    const chip = (bg, fg, txt) => `<span class="chip" style="background:var(--${bg});color:var(--${fg})">${txt}</span>`;
    const inviteChip = s => s === 'invited' ? chip('success-bg','success','invited')
      : s === 'failed' ? chip('warn-bg','warn','invite failed')
      : s === 'pending' ? chip('warn-bg','warn','invite pending')
      : chip('bg-3','text-3','no email');
    box.innerHTML = `<div class="rel-sec" style="margin-top:22px">Reviewer status</div>
      <table class="rel-tbl" style="margin-top:2px"><thead><tr>
        <th style="text-align:left">Reviewer</th><th>${UNITC}s shared</th><th>Comments</th><th>Last active</th><th>Status</th></tr></thead><tbody>${
      rows.map(r => `<tr>
        <td style="text-align:left"><b>${escapeHtml(r.name)}</b>${r.email?`<div style="font-weight:400;font-size:10.5px;color:var(--text-3)">${escapeHtml(r.email)}</div>`:''}</td>
        <td style="text-align:center">${r.releasedCount}${r.responsesReleased?' <span title="responses released" style="color:var(--success)">✓</span>':''}</td>
        <td style="text-align:center">${r.commentCount}${r.draftCount?` <span style="color:var(--text-3)" title="unsubmitted drafts">(+${r.draftCount})</span>`:''}</td>
        <td style="text-align:center;font-size:11.5px;color:var(--text-3)">${r.lastActive?escapeHtml(relTime(r.lastActive)):'—'}</td>
        <td style="text-align:center">${r.active ? chip('success-bg','success','active') : inviteChip(r.inviteStatus)}</td></tr>`).join('') }</tbody></table>`;
  };
  renderStatusBoard();

  // ---- Configuration health check / preflight (Lane D feature 2) — one at-a-glance green/amber panel.
  // Signals that need a live probe (render-built, token-write) are fetched async; the rest come from
  // state we already have. healthSignals is pure + TDD'd; each amber row names the exact next step.
  // Deploy checklist lives at the BOTTOM now, collapsible + dismissable (dismissal persisted per
  // project so a set-up project doesn't nag). Defaults collapsed once every signal is green.
  const _relPid = DATA_REPO + ':' + (_projectId || 'root');
  const renderPreflight = async () => {
    const box = document.getElementById('rel-preflight'); if (!box) return;
    if (isChecklistDismissed(localStorage, _relPid)){
      box.innerHTML = `<div style="text-align:right"><button id="rel-cl-show" style="background:none;border:0;color:var(--text-3);cursor:pointer;font:inherit;font-size:11.5px"><i class="ti ti-checklist"></i> Show deploy checklist</button></div>`;
      const sh = box.querySelector('#rel-cl-show'); if (sh) sh.onclick = () => { restoreChecklist(localStorage, _relPid); renderPreflight(); };
      return;
    }
    let renderBuilt = false, tokenCanWrite = null;
    try {
      const paths = await ghTree(t);   // ghTree already strips this project's dataPrefix → match BARE paths (dpath() here double-prefixed → preflight was always amber for workspace projects)
      const builtUnitIds = CHAPTERS.map(c => c.id).filter(id => paths.includes('content/'+id+'.html'));
      const releasedUnitIds = [...new Set(Object.keys(rel).filter(k => k !== '_comment').flatMap(k => rel[k].released || []))];
      renderBuilt = renderBuiltStatus({ allUnitIds: CHAPTERS.map(c => c.id), releasedUnitIds, builtUnitIds });
    } catch(e){}
    try { await checkActionsAccess(t); await getPublicKey(t); tokenCanWrite = true; } catch(e){ tokenCanWrite = isScopeError(e) ? false : null; }   // Actions read AND Secrets write (email/AI/key seal all need the latter)
    const anyReleased = Object.keys(rel).some(k => k !== '_comment' && (rel[k].released||[]).length > 0);
    const signals = healthSignals({
      keySet: !!advisorKey(), emailConfigured: emailConfigured(),
      renderBuilt, anyReleased, tokenCanWrite, unitNoun: UNIT,
    });
    const greens = signals.filter(s => s.status === 'green').length;
    const allGreen = greens === signals.length;
    const collapsed = allGreen;   // once everything is green, default to collapsed
    box.innerHTML = `<div style="border:.5px solid var(--border);border-radius:11px;padding:14px 16px;background:var(--bg-2)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <i class="ti ti-${allGreen?'circle-check':'alert-triangle'}" style="font-size:16px;color:var(--${allGreen?'success':'warn'})"></i>
        <b style="font-size:13.5px">${allGreen?'Ready to share with reviewers':`Deploy checklist — ${greens}/${signals.length} ready`}</b>
        <button id="rel-cl-toggle" title="Collapse / expand" style="margin-left:auto;background:none;border:0;color:var(--text-3);cursor:pointer;padding:2px"><i class="ti ti-chevron-${collapsed?'down':'up'}"></i></button>
        <button id="rel-cl-dismiss" title="Dismiss checklist" style="background:none;border:0;color:var(--text-3);cursor:pointer;padding:2px"><i class="ti ti-x"></i></button></div>
      <div id="rel-cl-body" style="${collapsed?'display:none':''}">${signals.map(s => `<div style="display:flex;align-items:flex-start;gap:9px;padding:4px 0;font-size:12.5px">
        <i class="ti ti-${s.status==='green'?'circle-check':'circle'}" style="font-size:14px;margin-top:1px;color:var(--${s.status==='green'?'success':'warn'})"></i>
        <div><span style="color:var(--text)">${escapeHtml(s.label)}</span>${s.status==='amber'?`<div style="color:var(--text-3);font-size:11.5px;margin-top:1px">${escapeHtml(s.next)}</div>`:''}</div></div>`).join('')}</div></div>`;
    const tg = box.querySelector('#rel-cl-toggle'); const bd = box.querySelector('#rel-cl-body');
    if (tg && bd) tg.onclick = () => { const hid = bd.style.display === 'none'; bd.style.display = hid ? '' : 'none'; tg.querySelector('i').className = 'ti ti-chevron-' + (hid ? 'up' : 'down'); };
    const dm = box.querySelector('#rel-cl-dismiss'); if (dm) dm.onclick = () => { dismissChecklist(localStorage, _relPid); renderPreflight(); };
  };
  renderPreflight();
  // (Notify-me digest + AI setup moved to the dedicated Settings page.)
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
async function sendAdvisorToClaude(advisorId, ch, c, note){
  const t = tok();
  const { json, sha } = await getJson(t, `reviews/${ch}.json`).catch(() => ({ json:null, sha:null }));
  let review = json || newReview(ch, '');
  // idempotent: if this advisor comment was already copied in (e.g. the jobs.json PUT failed and we're retrying), reuse it
  let nc = review.comments.find(x => x.from_advisor && x.from_advisor.id === advisorId && x.from_advisor.cid === c.id);
  if (!nc){
    review = addComment(review, { anchor:c.anchor, kind:c.kind, tag:c.edit?'edit':(c.tag||'wording'), body:c.body, edit:c.edit||null });
    nc = review.comments[review.comments.length-1];
    nc.from_advisor = { id:advisorId, cid:c.id, name: ADVISOR_NAME[advisorId] || c.author || advisorId }; nc.status = 'queued';
    if (note && note.trim()) nc.thread = [...(nc.thread||[]), { author:'you', text:note.trim(), ts:new Date().toISOString() }];
    await putJson(t, `reviews/${ch}.json`, review, sha, `review: incorporate ${advisorId} comment ${c.id}`);
  }
  const jr = await getJson(t, 'jobs.json').catch(() => ({ json:null, sha:null }));
  const jobs = Array.isArray(jr.json) ? jr.json : [];
  // idempotent: don't double-queue a still-open job for the same advisor comment
  const dup = jobs.find(j => j.from_advisor && j.from_advisor.id === advisorId && j.from_advisor.cid === c.id && j.status !== 'done' && j.status !== 'merged');
  if (!dup){
    jobs.push(buildAdvisorClaudeJob({ id:'j_'+Date.now().toString(36), chapter:ch, commentId:nc.id, advisorId, cid:c.id, note, ts:new Date().toISOString() }));
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
// The Cloud pill doubles as the entry to the live activity view: click it (in cloud mode) to open/reopen
// the latest cloud job's narrated console — the affordance most people reach for first.
document.addEventListener('click', e => {
  if (!(e.target.closest && e.target.closest('.pm-pill'))) return;
  if (typeof processingMode !== 'function' || processingMode(_CFG) !== 'cloud') return;
  const j = localStorage.getItem('footnote:lastcloud:' + (_projectId || DATA_REPO));
  if (j) openCloudActivity(j); else flash('No cloud job yet — use “Send to Claude” to start one.');
});
(() => { const r = sessionStorage.getItem('_resume'); if (r){ sessionStorage.removeItem('_resume'); enterChapter(r); } else enterHome(); })();   // a refresh returns you to where you were
document.addEventListener('mouseover', e => { const c = e.target.closest?.('.chcard'); if (c) c.style.borderColor='var(--border-2)'; });
document.addEventListener('mouseout', e => { const c = e.target.closest?.('.chcard'); if (c) c.style.borderColor='var(--border)'; });

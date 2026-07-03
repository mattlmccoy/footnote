// Dependency-free spotlight tour: dims the page, highlights one element at a time with a tooltip
// (Back / Next / Skip + "N of M"). Pure DOM overlay — no network, no data access. Safe to run anytime.

// Pure helpers (unit-tested). dir is -1 | +1 | 'skip'. Returns the next index, or -1 when finished.
export function nextIndex(i, dir, len){
  if (dir === 'skip') return -1;
  if (dir === -1) return Math.max(0, i - 1);
  return i + 1 >= len ? -1 : i + 1;
}
const LS = () => (typeof localStorage !== 'undefined' ? localStorage : null);
export function tourSeen(key, store = LS()){ try { return !!(store && store.getItem(key)); } catch { return false; } }
export function markTourSeen(key, store = LS()){ try { store && store.setItem(key, '1'); } catch {} }

// Run a tour. steps: [{ sel, title, body, side?, before? }]. opts: { storageKey, onDone? }.
export async function startTour(steps, opts = {}){
  const { storageKey, onDone } = opts;
  let i = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `<div class="tour-cut"></div><div class="tour-tip" role="dialog">
    <div class="tour-tip-title"></div><div class="tour-tip-body"></div>
    <div class="tour-tip-bar"><span class="tour-tip-prog"></span>
      <span><button class="btn tour-skip">Skip</button>
      <button class="btn tour-back">Back</button>
      <button class="btn btn-primary tour-next">Next</button></span></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('tour-active');   // lets CSS lift any popup the user opens above the dim
  const $ = s => overlay.querySelector(s);
  const cut = $('.tour-cut'), tip = $('.tour-tip');

  const finish = () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey); overlay.remove(); document.body.classList.remove('tour-active');
    if (storageKey) markTourSeen(storageKey); if (onDone) onDone(); };

  function place(){
    const step = steps[i]; const el = step && document.querySelector(step.sel);
    if (!el){ return advance(+1); }
    const r = el.getBoundingClientRect(); const pad = 6;
    Object.assign(cut.style, { left:`${r.left-pad}px`, top:`${r.top-pad}px`, width:`${r.width+2*pad}px`, height:`${r.height+2*pad}px` });
    $('.tour-tip-title').textContent = step.title || '';
    $('.tour-tip-body').innerHTML = step.body || '';
    $('.tour-tip-prog').textContent = `${i+1} of ${steps.length}`;
    $('.tour-back').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('.tour-next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    const tw = 300;
    // step.pin fixes the tooltip to a screen corner so it never covers a popup that opens on the
    // highlighted element (e.g. the comment box that appears when you select text).
    if (step.pin){
      const m = 16, th = tip.offsetHeight || 150;
      const P = { tl:[m,74], tr:[window.innerWidth-tw-m,74], bl:[m,window.innerHeight-th-m], br:[window.innerWidth-tw-m,window.innerHeight-th-m] };
      const [px,py] = P[step.pin] || P.bl;
      Object.assign(tip.style, { left:`${Math.max(8,px)}px`, top:`${Math.max(8,py)}px`, width:`${tw}px` });
      return;
    }
    let left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let top = r.bottom + 10; if (top + 140 > window.innerHeight) top = Math.max(8, r.top - 150);
    Object.assign(tip.style, { left:`${left}px`, top:`${top}px`, width:`${tw}px` });
  }
  async function advance(dir){
    const ni = nextIndex(i, dir, steps.length);
    if (ni === -1) return finish();
    i = ni; const step = steps[i];
    if (step.before){ try { await step.before(); await new Promise(r => setTimeout(r, 120)); } catch {} }
    const el = document.querySelector(step.sel);
    if (!el){ return advance(dir === -1 ? -1 : +1); }
    el.scrollIntoView({ block:'center', behavior:'smooth' }); setTimeout(place, 160);
  }
  const onKey = e => { if (e.key === 'Escape') finish(); };
  $('.tour-next').onclick = () => advance(+1);
  $('.tour-back').onclick = () => advance(-1);
  $('.tour-skip').onclick = () => finish();
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey);
  const s0 = steps[0]; if (s0 && s0.before){ try { await s0.before(); await new Promise(r => setTimeout(r, 120)); } catch {} }
  place();
}

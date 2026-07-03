// SyncTeX coordinates are in "small points" (sp); 65536 sp = 1 pt. We index every
// horizontal/box record (h/x/v/g/[/( ) with its page, link (file,line) and bbox, then
// return the smallest enclosing (or nearest) box for a query point in pt.
export function parseSyncTeX(text){
  const files = {}; const boxes = []; let page = 0;
  const reFile = /^Input:(\d+):(.+)$/;
  const reRec = /^[\[\(hvxgk]?(\d+),(\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+)(?:,(-?\d+))?$/;
  for (const raw of text.split('\n')){
    const line = raw.trim();
    const mf = line.match(reFile); if (mf){ files[+mf[1]] = mf[2]; continue; }
    if (line[0] === '{' || line[0] === '!'){ const p = parseInt(line.slice(1)); if(!isNaN(p)) page = p; continue; }
    const m = line.match(reRec); if (!m) continue;
    const [ , fileId, ln, x, y, w, h ] = m.map(Number);
    boxes.push({ page, file:files[fileId], line:ln,
      x:x/65536, y:y/65536, w:Math.abs(w/65536), h:Math.abs(h/65536) });
  }
  return { files, boxes };
}
const norm = f => (f||'').replace(/^\//,'');
export function lookup(idx, page, xPt, yPt){
  const cand = idx.boxes.filter(b => b.page===page);
  let best=null, bestD=Infinity;
  for (const b of cand){
    const within = xPt>=b.x-b.w && xPt<=b.x+b.w && yPt>=b.y-b.h && yPt<=b.y+b.h;
    const cx=b.x, cy=b.y; const d=(cx-xPt)**2+(cy-yPt)**2;
    if (within && d<bestD){ bestD=d; best=b; }
  }
  if (!best){ for (const b of cand){ const d=(b.x-xPt)**2+(b.y-yPt)**2; if(d<bestD){bestD=d;best=b;} } }
  return best ? { file:norm(best.file), line:best.line } : { file:null, line:null };
}

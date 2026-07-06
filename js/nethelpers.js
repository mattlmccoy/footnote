// Reliability helpers for the network-bound GitHub I/O paths (Lane C).
// Pure-ish + injectable-fetch so the timeout/retry/classify/cache/orphan logic is unit-testable.

// --- fetchWithTimeout / retry ---------------------------------------------
// Every GitHub fetch should have a bounded wait (a hung request must not hang the portal forever)
// and a single automatic retry on a TRANSPORT failure (network drop / abort). A real HTTP response
// — even 403/404/500 — is returned as-is for the caller to classify; only thrown errors retry.
export async function fetchWithTimeout(url, opts = {}, cfg = {}){
  const timeoutMs = cfg.timeoutMs ?? 15000;
  const retries   = cfg.retries   ?? 1;
  const backoffMs = cfg.backoffMs ?? 400;
  const fetchImpl = cfg.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch implementation available');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++){
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : { signal: undefined, abort(){} };
    let timed = false;
    const timer = setTimeout(() => { timed = true; try { ctrl.abort(); } catch(e){} }, timeoutMs);
    try {
      const r = await fetchImpl(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      return r;                                  // a real response (any status) — caller's to handle
    } catch(e){
      clearTimeout(timer);
      lastErr = timed ? new Error(`GitHub request timed out after ${timeoutMs}ms`) : e;
      if (attempt < retries){ if (backoffMs) await new Promise(res => setTimeout(res, backoffMs*(attempt+1))); continue; }
    }
  }
  throw lastErr;
}

// --- rate-limit classification (F2) ---------------------------------------
// GitHub signals a rate limit as 429, OR a 403 with x-ratelimit-remaining:0, OR a 403 carrying
// Retry-After (the abuse/secondary limit). A plain 403 with budget left is a permissions error.
const hget = (h, k) => { try { return h && typeof h.get === 'function' ? h.get(k) : (h ? (h[k] ?? h[k.toLowerCase()]) : null); } catch(e){ return null; } };
export function isRateLimited(status, headers){
  if (status === 429) return true;
  if (status !== 403) return false;
  const remaining = hget(headers, 'x-ratelimit-remaining');
  if (remaining != null && Number(remaining) === 0) return true;
  if (hget(headers, 'retry-after') != null) return true;
  return false;
}
// Classify a thrown error (status+headers attached, or parsed from its message) into flags.
export function classifyGitHubError(e){
  const msg = (e && e.message) || '';
  let status = (e && typeof e.status === 'number') ? e.status : null;
  if (status == null){ const m = msg.match(/\b(4\d\d|5\d\d)\b/); if (m) status = Number(m[1]); }
  const headers = e && e.headers;
  return {
    status,
    auth: status === 401,
    rateLimited: status != null && isRateLimited(status, headers),
    headers,
  };
}
// How long to back off, from Retry-After (seconds) or x-ratelimit-reset (epoch seconds). Default 60s.
export function retryAfterMs(headers, nowMs){
  const now = nowMs ?? Date.now();
  const ra = hget(headers, 'retry-after');
  if (ra != null && !isNaN(Number(ra))) return Math.max(0, Number(ra) * 1000);
  const reset = hget(headers, 'x-ratelimit-reset');
  if (reset != null && !isNaN(Number(reset))) return Math.max(0, Number(reset) * 1000 - now);
  return 60000;
}

// --- short-TTL in-memory cache (request thrift) ---------------------------
// De-dupes hot GitHub reads within a window so a solo reviewer refreshing doesn't burn the shared budget.
export class TTLCache {
  constructor(ttlMs = 8000, nowFn){ this.ttl = ttlMs; this._now = nowFn || (() => Date.now()); this._m = new Map(); }
  get(k){ const e = this._m.get(k); if (!e) return undefined; if (this._now() - e.t > this.ttl){ this._m.delete(k); return undefined; } return e.v; }
  has(k){ return this.get(k) !== undefined; }
  set(k, v){ this._m.set(k, { v, t: this._now() }); return v; }
  delete(k){ this._m.delete(k); }
  clear(){ this._m.clear(); }
}

// --- orphaned-comment detection (F6) --------------------------------------
// A text comment whose quote no longer appears in the re-rendered doc can't paint and silently vanishes.
// Given `isPresent(normalizedQuote) -> bool` (the same match the painter uses), return the comments that
// are anchorable-but-lost so the UI can surface them instead of dropping them. Figures/resolved skip.
const FINAL_ORPHAN = new Set(['merged','declined','answered','resolved']);
export function orphanComments(comments, isPresent){
  const out = [];
  for (const c of comments || []){
    if (!c || c.kind === 'figure') continue;                 // figures anchor by image/caption, handled elsewhere
    if (FINAL_ORPHAN.has(c.status) || (c.resolution && c.resolution.state && FINAL_ORPHAN.has(c.resolution.state))) continue;
    const q = ((c.anchor && c.anchor.quote) || '').replace(/\s+/g,' ').trim();
    if (q.length < 4) continue;                              // too short to anchor anyway
    if (!isPresent(q)) out.push(c);
  }
  return out;
}

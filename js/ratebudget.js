// Proactive rate-limit budget guard.
//
// Until now the app only reacted AFTER the limit was hit (429 / 403 with remaining 0), by which point
// every request fails. GitHub reports the budget on EVERY response — including a free 304 — via headers
// CORS explicitly exposes (X-RateLimit-Limit / -Remaining / -Reset). Reading them lets the polling loops
// ease off while there is still budget left, so heavy use degrades gracefully instead of falling off a
// cliff. This matters because the limit is per USER: the owner's 5,000/hr is shared with every reviewer
// on the magic-link key.
//
// Honesty rule: "I have not measured it" is NOT "healthy". Until a real header is seen the snapshot is
// { known:false } and the level is 'unknown', which deliberately does not throttle — ignorance must
// neither slow the app down nor be reported as a clean bill of health.

let _snap = { known: false, limit: null, remaining: null, reset: null, at: null };

export function resetBudget(){ _snap = { known: false, limit: null, remaining: null, reset: null, at: null }; }

// Record the budget from any response (2xx, 304 or error). Headers-less / non-GitHub responses are
// ignored so the last real reading survives.
export function observeBudget(headers, now = Date.now()){
  if (!headers || typeof headers.get !== 'function') return;
  const rem = headers.get('x-ratelimit-remaining');
  if (rem == null || rem === '') return;
  const lim = headers.get('x-ratelimit-limit');
  const rst = headers.get('x-ratelimit-reset');
  _snap = {
    known: true,
    limit: Number(lim) > 0 ? Number(lim) : 5000,
    remaining: Number(rem),
    reset: rst ? Number(rst) * 1000 : null,     // GitHub sends epoch SECONDS; expose ms
    at: now,
  };
}

export function budgetSnapshot(){ return { ..._snap }; }

const LOW = 0.20, CRITICAL = 0.05, REFILL_SOON_MS = 120_000;

export function budgetLevel(snap = _snap, now = Date.now()){
  if (!snap || !snap.known || snap.remaining == null) return 'unknown';
  // A window that has rolled over (or is about to) has effectively refilled — throttling then would
  // punish the user for a reading that no longer applies.
  if (snap.reset != null && snap.reset - now <= REFILL_SOON_MS) return 'ok';
  const share = snap.remaining / (snap.limit || 5000);
  if (share <= CRITICAL) return 'critical';
  if (share <= LOW) return 'low';
  return 'ok';
}

// Multiplier applied to a polling interval. Never below 1, never NaN — this feeds a timer.
const FACTORS = { ok: 1, unknown: 1, low: 3, critical: 8 };
export function budgetFactor(level){
  const f = FACTORS[level];
  return Number.isFinite(f) && f >= 1 ? f : 1;
}

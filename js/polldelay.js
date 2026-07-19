// Polling cadence policy, shared by both portals. Pure (time is passed in) so the ramp is testable.
//
// Every poll that finds nothing new is a wasted GitHub request, and the REST rate limit is per USER —
// the owner's 5,000/hr is shared by their own tabs AND every reviewer using the magic-link key. So an
// idle loop must get cheaper over time while a session that is actually changing stays responsive.
// Term-neutral: safe for advisor.js to import.

// Live comment sync. Stays at the base cadence while anything is happening; each poll that sees no
// change widens the gap, and any change (or the tab regaining focus) resets the caller's idle counter.
export function livePollDelay({ idlePolls = 0, base = 20000, max = 60000, rateLimitedUntil = 0, now = Date.now() } = {}){
  if (rateLimitedUntil > now) return Math.max(5000, rateLimitedUntil - now);   // wait out the limit, re-check near reset
  const ramp = [1, 1.5, 2.25, 3];                                             // 20s → 30s → 45s → 60s
  return Math.min(max, Math.round(base * ramp[Math.min(idlePolls, ramp.length - 1)]));
}

// Cloud job progress. A job takes minutes but the user only stares at the first few seconds, so keep the
// fast cadence for a ~30s window, then ramp. A hidden tab drops straight to the slowest cadence — it keeps
// polling (so a finished job still resolves the panel) but stops burning quota on a view nobody is reading.
const SNAPPY_POLLS = 12;                                                       // 12 × 2.5s ≈ 30s
export function jobPollDelay({ polls = 0, hidden = false, base = 2500, max = 15000 } = {}){
  if (hidden) return max;
  const over = Math.max(0, polls - SNAPPY_POLLS);
  return Math.min(max, Math.round(base * Math.pow(1.5, over)));
}

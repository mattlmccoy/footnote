// Lane D — owner admin pure helpers. No DOM, no fetch: every function is a pure transform so the
// decision logic (invite readiness, config health, status-board aggregation, soft-delete restore)
// is unit-testable. app.js wires these to the release panel and the data-repo I/O.

// Loose email sanity check — not RFC-perfect, just enough to catch an obvious typo before we add a
// reviewer whose invite would silently bounce.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- 1. One-click invite -------------------------------------------------
// Given the form + current email config, decide what "Invite" will actually do and the exact copy to
// show. Model A: adding a reviewer with an email to advisors.json triggers the invite workflow, whose
// magic link carries the shared key — there is NO per-reviewer GitHub grant.
export function inviteReadiness({ name, email, emailConfigured } = {}) {
  const nm = (name || '').trim();
  const em = (email || '').trim();
  if (!nm) return { ok: false, message: 'Name is required.' };
  if (em && !EMAIL_RE.test(em)) return { ok: false, message: 'That email doesn’t look right — check it and try again.' };
  if (!em) {
    return { ok: true, willSend: false, needsEmailSetup: false,
      message: 'Added. No email given — copy their portal link and send it yourself.' };
  }
  if (!emailConfigured) {
    return { ok: true, willSend: false, needsEmailSetup: true,
      message: 'Added, but email sending isn’t set up yet — no invite was sent. Copy their portal link and send it, or set up email invites in Settings.' };
  }
  return { ok: true, willSend: true, needsEmailSetup: false,
    message: 'Added — an invite email with their private link will send shortly.' };
}

// ---- 2. Config health check ----------------------------------------------
// Turn the raw preflight state into green/amber rows, each amber row naming the exact next step. A
// null/undefined signal is treated as "unknown" → amber (never a false green). Order is stable so the
// panel renders deterministically.
export function healthSignals(state = {}) {
  const g = v => v === true;
  const row = (key, label, ok, next) => ({ key, label, status: ok ? 'green' : 'amber', next: ok ? '' : next });
  return [
    row('keySet', 'Reviewer access key', g(state.keySet),
      'Set a reviewer access key in Settings so invite links sign reviewers in automatically.'),
    row('emailConfigured', 'Email invites', g(state.emailConfigured),
      'Connect email in Settings so reviewers get their invite automatically (or share links by hand).'),
    row('renderBuilt', 'Reading view built', g(state.renderBuilt),
      'Open a released unit once to build the reading view, or run Build reading view.'),
    row('anyReleased', 'At least one unit released', g(state.anyReleased),
      'Release at least one ' + (state.unitNoun || 'unit') + ' to a reviewer in the release matrix below.'),
    row('tokenCanWrite', 'Token can write secrets & Actions', g(state.tokenCanWrite),
      'Your token can’t manage Actions/secrets — regenerate it with the repo + workflow scopes.'),
  ];
}

// "Reading view built" for the preflight: EVERY unit the reviewer could see must be rendered — a
// partial render must NOT show a false green. Basis = released units when any are released, else all
// units (so a fully-rendered-but-not-yet-released doc still reads as built). builtUnitIds = the unit
// ids that have rendered HTML. Returns false when there's nothing to build.
export function renderBuiltStatus({ allUnitIds = [], releasedUnitIds = [], builtUnitIds = [] } = {}) {
  const built = new Set(builtUnitIds);
  const basis = releasedUnitIds.length ? releasedUnitIds : allUnitIds;
  if (!basis.length) return false;
  return basis.every(id => built.has(id));
}

// Decide the email-test outcome after the send workflow runs. A run that CONCLUDED SUCCESS must NEVER be
// reported as "failed" just because the workflow's email_test result (written to advisors.json) hasn't
// propagated yet — that stale read is what showed users "Test send failed: run concluded: success".
// Failure = the workflow run itself failed, OR a FRESH email_test result (ts changed since dispatch)
// explicitly says ok:false. A green run whose result we can't yet re-read is treated as sent, not failed.
export function emailTestOutcome({ conclusion, emailTest, beforeTs } = {}) {
  if (conclusion !== 'success') return { failed: true, error: 'send workflow ' + (conclusion || 'did not complete') };
  const fresh = !!(emailTest && (emailTest.ts || '') !== (beforeTs || ''));
  if (fresh && emailTest.ok === false) return { failed: true, error: emailTest.error || 'the email didn’t send' };
  return { failed: false, confirmed: !!(fresh && emailTest.ok) };
}

// ---- 3. Reviewer status board --------------------------------------------
// Per reviewer: how many units they can see, how many comments they've submitted, when they were last
// active, and the invite-email state. Only fields we can actually derive — no invented "opened the link".
export function reviewerStatus({ advisors = [], release = {}, inbox = {}, presence = {} } = {}) {
  const inviteStateOf = a => {
    if (!a.email) return 'no-email';
    if (a.invited) return 'invited';
    if (a.invite_error) return 'failed';
    return 'pending';
  };
  return advisors.map(a => {
    const rel = release[a.id] || {};
    const items = inbox[a.id] || [];
    const pr = presence[a.id] || {};
    const commentCount = items.filter(x => x.c && x.c.status !== 'open').length;
    const lastActive = pr.lastActive || null;
    return {
      id: a.id,
      name: a.name,
      email: a.email || '',
      releasedCount: (rel.released || []).length,
      responsesReleased: !!rel.responses_released,
      commentCount,
      draftCount: pr.drafts || 0,
      lastActive,
      // Derived activity signal: a reviewer who has left a comment or was recently present is "active",
      // shown in place of "invite pending" — the invite-email flag alone was misleading once they engage.
      active: commentCount > 0 || !!lastActive,
      inviteStatus: inviteStateOf(a),
    };
  });
}

// ---- 4. Soft-delete / restore --------------------------------------------
// Given a tombstone captured at remove time ({advisor, release}), re-derive the advisors.json +
// release.json objects to restore. Idempotent (never duplicates), non-destructive to other reviewers.
export function restoreAdvisorPlan(tomb, reg = { advisors: [] }, rel = {}) {
  const advisors = Array.isArray(reg.advisors) ? reg.advisors.slice() : [];
  if (tomb && tomb.advisor && !advisors.some(a => a.id === tomb.advisor.id)) {
    advisors.push(tomb.advisor);
  }
  const release = { ...rel };
  if (tomb && tomb.advisor && tomb.release && !release[tomb.advisor.id]) {
    release[tomb.advisor.id] = tomb.release;
  }
  return { advisors, release };
}

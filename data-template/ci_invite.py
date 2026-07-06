#!/usr/bin/env python3
"""ci_invite.py — email an invite to each newly-added advisor (advisors.json), via curl SMTP.
Deterministic; no assistant in the loop. Run by the invite workflow after a push to advisors.json.

Env (from GitHub secrets/vars): SMTP_USER, SMTP_PASS, ADVISOR_KEY; optional SMTP_HOST, SMTP_PORT,
SMTP_FROM_NAME, PORTAL_BASE (e.g. https://owner.github.io/repo/), AUTHOR_NAME.
Usage: python3 ci_invite.py [--dry-run]
"""
import json, os, sys, subprocess, datetime, tempfile, email.utils
import re
from urllib.parse import quote
import ci_notify_common as C

DRY = "--dry-run" in sys.argv
REG = "advisors.json"


def secret_name_for(reviewer_id):
    """Actions-secret name holding ONE reviewer's own least-privilege key: ADVISOR_KEY_<UPPER_SLUG(id)>.
    Mirrors ghsecrets.reviewerKeySecretName so the owner seals and CI reads the exact same name. Empty
    id → the shared/legacy ADVISOR_KEY name."""
    slug = re.sub(r"[^A-Z0-9]+", "_", (reviewer_id or "").strip().upper()).strip("_")
    return f"ADVISOR_KEY_{slug}" if slug else "ADVISOR_KEY"


def reviewer_key(env, advisor):
    """Source THIS reviewer's magic-link key with least-privilege routing:
      1) their own sealed Actions secret ADVISOR_KEY_<ID> (most secure — reviewers can't read it), else
      2) an access_key on their advisors.json entry (enables the owner's instant client copy-link), else
      3) the legacy shared ADVISOR_KEY (keeps live links working through migration).
    Falls back to the placeholder default (never crashes) when nothing is configured."""
    per = env.get(secret_name_for(advisor.get("id", "")))
    if per:
        return per
    entry = (advisor.get("access_key") or "").strip()
    if entry:
        return entry
    return env.get("ADVISOR_KEY", "(access key not configured)")

def load(p):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"advisors": []}
def save(p, o):
    json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def portal_url(base, a, prefix="", key=""):
    base = (base or "").rstrip("/") + "/"
    # Carry this data repo so the advisor (who has no hub access) lands in the right project.
    data = os.environ.get("GITHUB_REPOSITORY", "")
    url = f"{base}advisor.html?a={quote(a['id'])}&n={quote(a.get('name',''))}"
    if data:
        url += f"&data={quote(data)}"
    if prefix:   # consolidated workspace: tell the reviewer bundle which project subfolder to read
        url += f"&p={quote(prefix.rstrip('/'))}"
    if key:      # magic link: embed the access key so the reviewer just clicks — no token to paste
        url += f"&k={quote(key)}"
    return url

def build_message(a, frm, frm_name, key, author, base, prefix=""):
    to = a["email"]
    name = a.get("name", "")
    url = portal_url(base, a, prefix, key)   # magic link — key embedded so the reviewer just clicks
    noun = C.doc_noun(prefix)
    whose = f"{author}'s" if author else "a"
    subject = f"You're invited to review {author}'s {noun}" if author else f"You're invited to review a {noun}"
    # --- plain-text fallback ---
    text = (
        f"Hi {name},\n\n"
        f"You've been invited to review {whose} {noun} in a private, comment-only reader.\n\n"
        f"Your access key (paste it when the portal asks; it's stored only in your browser):\n  {key}\n\n"
        f"Open your review portal:\n  {url}\n\n"
        "How it works: open the link, paste the access key once, then read the released chapters and "
        "leave comments or suggested edits inline. Your comments are private to the author.\n\n"
        "Thank you for your time.\n"
    )
    # --- HTML (shared portal-matched shell from ci_notify_common) ---
    E = C.EMAIL
    intro = (f"you've been invited to review <span style=\"color:{E['text']};font-weight:500;\">{C.esc(author)}'s</span> {C.esc(noun)}"
             if author else f"you've been invited to review a {C.esc(noun)}")
    title = f"You're invited to review {C.esc(author)}'s {C.esc(noun)}" if author else f"You're invited to review a {C.esc(noun)}"
    rows = (
        f'<tr><td style="padding:0 24px 16px;">'
        f'<div style="font-size:14px;color:{E["text2"]};line-height:1.55;margin-bottom:16px;">Hi {C.esc(name)}, {intro} in a private, comment-only reader.</div>'
        f'<div style="background:{E["box"]};border:1px solid {E["box_border"]};border-radius:9px;padding:13px 15px;">'
        f'<div style="font-size:11px;color:{E["text3"]};text-transform:uppercase;letter-spacing:.6px;font-weight:600;margin-bottom:5px;">Your access key</div>'
        f'<div style="font-family:Menlo,Consolas,monospace;font-size:13px;color:{E["accent"]};word-break:break-all;">{C.esc(key)}</div></div>'
        f'<div style="font-size:12px;color:{E["text3"]};margin-top:7px;">Paste it when the portal asks &mdash; it\'s stored only in your browser.</div></td></tr>'
        + C.email_button(url, "Open your review portal")
        + f'<tr><td style="padding:0 24px 22px;"><div style="font-size:12px;color:{E["text3"]};line-height:1.5;">Open the link, paste the access key once, then read the released chapters and leave comments or suggested edits inline. Your comments are private to the author.</div></td></tr>'
    )
    html = C.email_shell(title, "A private, comment-only reader", rows)
    frm_disp = frm_name or author or C.default_sender_name()
    return to, subject, C.build_eml(frm, frm_disp, to, subject, text, html)

def send(frm, to, eml):
    import ci_notify_common as C
    C.send(frm, to, eml)

def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def _send_invites(prefix, frm, frm_name, key, author, base):
    """Send pending invites for one project (prefix '' = legacy root, '<id>/' = a workspace subfolder).
    Returns the number of invites sent."""
    reg_path = f"{prefix}{REG}"
    reg = load(reg_path)
    changed = 0
    for a in reg.get("advisors", []):
        if a.get("invited") or not a.get("email"):
            continue
        # least-privilege: embed THIS reviewer's own key (their ADVISOR_KEY_<ID> secret or entry field),
        # falling back to the shared `key` only during migration. Never one shared key for everyone.
        rk = reviewer_key(os.environ, a) or key
        to, subj, eml = build_message(a, frm, frm_name, rk, author, base, prefix)
        if DRY:
            print(f"--- DRY-RUN to {to} ({prefix or 'root'}) ---\n{eml}\n"); continue
        try:
            send(frm, to, eml)
            a["invited"] = True; a["invited_ts"] = _now(); a["invite_error"] = None
            changed += 1; print(f"invited {to} ({prefix or 'root'})")
        except Exception as e:
            a["invite_error"] = str(e); print(f"::warning::invite to {to} failed: {e}")
    if changed:
        reg["email_configured"] = True
    if not DRY:
        save(reg_path, reg)
    return changed

def _stamp(prefix, patch):
    """Merge `patch` into one project's advisors.json (used for the not-configured + test-send flags)."""
    reg_path = f"{prefix}{REG}"
    reg = load(reg_path); reg.update(patch)
    if not DRY:
        save(reg_path, reg)

def main():
    # The envelope/From sender can differ from the SMTP login (e.g. Brevo: login is 123@smtp-brevo.com,
    # but mail must be sent from a verified sender). Auth still uses SMTP_USER inside send().
    frm = (os.environ.get("SMTP_FROM", "").strip() or os.environ.get("SMTP_USER", "noreply@example.com"))
    frm_name = os.environ.get("SMTP_FROM_NAME")
    key = os.environ.get("ADVISOR_KEY", "(access key not configured)")
    author = os.environ.get("AUTHOR_NAME", "")
    base = os.environ.get("PORTAL_BASE", "")
    test_email = os.environ.get("TEST_EMAIL", "").strip()
    configured = bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))
    # One CI, both layouts: a legacy repo has advisors.json at the root; a consolidated workspace repo has
    # <id>/advisors.json per project. Process every project found (fall back to root so a bare run is a no-op).
    prefixes = C.project_prefixes() or [""]

    if not DRY and not configured:
        print("::warning::SMTP_USER/SMTP_PASS not set — configure the data-repo secrets to enable invites.")
        note = "Email not configured — the author hasn't set up sending yet."
        for pfx in prefixes:
            reg = load(f"{pfx}{REG}"); reg["email_configured"] = False
            for a in reg.get("advisors", []):
                if a.get("email") and not a.get("invited"):
                    a["invite_error"] = note
            if not DRY:
                save(f"{pfx}{REG}", reg)
        return

    # --- test send: ONE message to the owner proves SMTP; stamp the outcome onto every project ---
    if test_email:
        to, subj, eml = build_message({"id": "test", "name": "you", "email": test_email}, frm, frm_name, key, author, base)
        eml = eml.replace(f"Subject: {subj}", f"Subject: {C.doc_noun().capitalize()} reviewer - email test", 1)
        try:
            if not DRY:
                send(frm, test_email, eml)
            result = {"email_test": {"ok": True, "ts": _now(), "error": None}, "email_configured": True}
            print(f"test email sent to {test_email}")
        except Exception as e:
            result = {"email_test": {"ok": False, "ts": _now(), "error": str(e)[:300]}, "email_configured": False}
            print(f"::warning::test email to {test_email} failed: {e}")
        for pfx in prefixes:
            _stamp(pfx, result)
        return

    # --- normal invite send across every project ---
    total = sum(_send_invites(pfx, frm, frm_name, key, author, base) for pfx in prefixes)
    print(f"done — {total} invite(s) sent")

if __name__ == "__main__":
    main()

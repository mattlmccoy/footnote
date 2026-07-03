#!/usr/bin/env python3
"""ci_invite.py — email an invite to each newly-added advisor (advisors.json), via curl SMTP.
Deterministic; no assistant in the loop. Run by the invite workflow after a push to advisors.json.

Env (from GitHub secrets/vars): SMTP_USER, SMTP_PASS, ADVISOR_KEY; optional SMTP_HOST, SMTP_PORT,
SMTP_FROM_NAME, PORTAL_BASE (e.g. https://owner.github.io/repo/), AUTHOR_NAME.
Usage: python3 ci_invite.py [--dry-run]
"""
import json, os, sys, subprocess, datetime, tempfile, email.utils
from urllib.parse import quote
import ci_notify_common as C

DRY = "--dry-run" in sys.argv
REG = "advisors.json"

def load(p):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"advisors": []}
def save(p, o):
    json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def portal_url(base, a):
    base = (base or "").rstrip("/") + "/"
    # Carry this data repo so the advisor (who has no hub access) lands in the right project.
    data = os.environ.get("GITHUB_REPOSITORY", "")
    url = f"{base}advisor.html?a={quote(a['id'])}&n={quote(a.get('name',''))}"
    return url + (f"&data={quote(data)}" if data else "")

def build_message(a, frm, frm_name, key, author, base):
    to = a["email"]
    name = a.get("name", "")
    url = portal_url(base, a)
    whose = f"{author}'s" if author else "a"
    subject = f"You're invited to review {author}'s dissertation" if author else "You're invited to review a dissertation"
    # --- plain-text fallback ---
    text = (
        f"Hi {name},\n\n"
        f"You've been invited to review {whose} dissertation in a private, comment-only reader.\n\n"
        f"Your access key (paste it when the portal asks; it's stored only in your browser):\n  {key}\n\n"
        f"Open your review portal:\n  {url}\n\n"
        "How it works: open the link, paste the access key once, then read the released chapters and "
        "leave comments or suggested edits inline. Your comments are private to the author.\n\n"
        "Thank you for your time.\n"
    )
    # --- HTML (shared portal-matched shell from ci_notify_common) ---
    E = C.EMAIL
    intro = (f"you've been invited to review <span style=\"color:{E['text']};font-weight:500;\">{C.esc(author)}'s</span> dissertation"
             if author else "you've been invited to review a dissertation")
    title = f"You're invited to review {C.esc(author)}'s dissertation" if author else "You're invited to review a dissertation"
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
    frm_disp = frm_name or author or "Dissertation Review"
    return to, subject, C.build_eml(frm, frm_disp, to, subject, text, html)

def send(frm, to, eml):
    import ci_notify_common as C
    C.send(frm, to, eml)

def main():
    reg = load(REG)
    # The envelope/From sender can differ from the SMTP login (e.g. Brevo: login is 123@smtp-brevo.com,
    # but mail must be sent from a verified sender). Auth still uses SMTP_USER inside send().
    frm = (os.environ.get("SMTP_FROM", "").strip() or os.environ.get("SMTP_USER", "noreply@example.com"))
    frm_name = os.environ.get("SMTP_FROM_NAME")
    key = os.environ.get("ADVISOR_KEY", "(access key not configured)")
    author = os.environ.get("AUTHOR_NAME", "")
    base = os.environ.get("PORTAL_BASE", "")
    test_email = os.environ.get("TEST_EMAIL", "").strip()
    configured = bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))
    if not DRY and not configured:
        print("::warning::SMTP_USER/SMTP_PASS not set — configure the data-repo secrets to enable invites.")
        reg["email_configured"] = False                      # the app reads this to warn the owner honestly
        note = "Email not configured — the author hasn't set up sending yet."
        for a in reg.get("advisors", []):
            if a.get("email") and not a.get("invited"):
                a["invite_error"] = note
        save(REG, reg)
        return

    # --- test send: one message to the owner; record verbatim outcome; gate the flag on it ---
    if test_email:
        to, subj, eml = build_message({"id": "test", "name": "you", "email": test_email}, frm, frm_name, key, author, base)
        eml = eml.replace(f"Subject: {subj}", "Subject: Dissertation reviewer — email test", 1)
        try:
            if not DRY:
                send(frm, test_email, eml)
            reg["email_test"] = {"ok": True, "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(), "error": None}
            reg["email_configured"] = True
            print(f"test email sent to {test_email}")
        except Exception as e:
            reg["email_test"] = {"ok": False, "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(), "error": str(e)[:300]}
            reg["email_configured"] = False
            print(f"::warning::test email to {test_email} failed: {e}")
        if not DRY:
            save(REG, reg)
        return

    # --- normal invite send: flag becomes true only after at least one real success ---
    changed = 0
    for a in reg.get("advisors", []):
        if a.get("invited") or not a.get("email"):
            continue
        to, subj, eml = build_message(a, frm, frm_name, key, author, base)
        if DRY:
            print(f"--- DRY-RUN to {to} ---\n{eml}\n"); continue
        try:
            send(frm, to, eml)
            a["invited"] = True; a["invited_ts"] = datetime.datetime.now(datetime.timezone.utc).isoformat(); a["invite_error"] = None
            changed += 1; print(f"invited {to}")
        except Exception as e:
            a["invite_error"] = str(e); print(f"::warning::invite to {to} failed: {e}")
    if changed:
        reg["email_configured"] = True
    if not DRY:
        save(REG, reg)
    print(f"done — {changed} invite(s) sent")

if __name__ == "__main__":
    main()

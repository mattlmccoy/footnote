#!/usr/bin/env python3
"""ci_notify_common.py — shared helpers for the review-notification workflows.
Pure stdlib. SMTP send() is the same curl path used by ci_invite.py.
"""
import json, os, glob, subprocess, tempfile, datetime, email.utils
from urllib.parse import quote

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def iso_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def doc_noun():
    """The word for the whole document, from the DOC_NOUN Actions variable (default "document").
    Keeps the invite/notify emails document-agnostic — "dissertation", "paper", "proposal", etc."""
    return (os.environ.get("DOC_NOUN") or "document").strip() or "document"

def default_sender_name():
    """From-name fallback when the author name and SMTP_FROM_NAME are unset — brand, else the noun."""
    return (os.environ.get("BRAND_NAME") or "").strip() or f"{doc_noun().capitalize()} review"

def chapter_labels():
    """id -> {n, title} from chapters.json (empty dict if missing)."""
    rows = load_json("chapters.json", [])
    return {r["id"]: {"n": r["n"], "title": r["title"]} for r in rows}

def short_title(t):
    s = (t or "").split(":")[0].strip()
    return s if len(s) <= 60 else s[:60].rsplit(" ", 1)[0] + "…"

def chapter_label(ch_id, labels):
    m = labels.get(ch_id)
    if not m:
        return ch_id
    return f"Ch {m['n']} · {short_title(m['title'])}"

def advisor_name(adv_id, reg):
    for a in reg.get("advisors", []):
        if a.get("id") == adv_id:
            return a.get("name") or adv_id
    if adv_id.startswith("general-"):
        return "Lab reviewer"
    return adv_id

def portal_advisor_url(base, adv_id, name=""):
    base = (base or "").rstrip("/") + "/"
    return f"{base}advisor.html?a={quote(adv_id)}&n={quote(name or '')}"

def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# --- shared email theme (matches the review portal: white cards on a cool canvas,
#     portal accent blue #2c64c4, a thin accent top-bar; NO beige). Restyle all emails in one place. ---
EMAIL = {
    "bg": "#edf0f3", "card": "#ffffff", "border": "rgba(0,0,0,.10)",
    "accent": "#2c64c4", "text": "#1f1e1c", "text2": "#605e58", "text3": "#8f8d84",
    "box": "#f4f6f8", "box_border": "rgba(0,0,0,.08)",
}

# --- Brand. Hosted PNG (mail clients don't render SVG); the wordmark text is the images-off fallback. ---
# Derived from the adopter's own Pages deploy (PORTAL_BASE) so the logo isn't tied to any one instance.
BRAND_NAME = os.environ.get("BRAND_NAME", "Footnote")
_PORTAL = os.environ.get("PORTAL_BASE", "").rstrip("/")
BRAND_LOGO = os.environ.get("BRAND_LOGO") or (f"{_PORTAL}/brand/footnote-mark.png" if _PORTAL else "")

def email_shell(title, subtitle, inner_rows, width=520):
    """Wrap table-rows (inner_rows) in the standard card: cool canvas, white card, accent top-bar, header."""
    E = EMAIL
    sub = f'<div style="font-size:13px;color:{E["text3"]};margin-top:3px;">{esc(subtitle)}</div>' if subtitle else ""
    return (f'<!DOCTYPE html><html><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            f'<body style="margin:0;padding:24px 0;background:{E["bg"]};'
            'font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
            f'<table role="presentation" width="{width}" cellpadding="0" cellspacing="0" '
            f'style="width:{width}px;background:{E["card"]};border:1px solid {E["border"]};border-radius:13px;overflow:hidden;">'
            f'<tr><td style="height:4px;background:{E["accent"]};font-size:0;line-height:0;">&nbsp;</td></tr>'
            f'<tr><td style="padding:16px 24px 2px;">'
            f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="vertical-align:middle;"><img src="{BRAND_LOGO}" width="26" height="26" alt="{BRAND_NAME}" '
            f'style="display:block;border:0;border-radius:6px;"></td>'
            f'<td style="vertical-align:middle;padding-left:9px;font-size:16px;font-weight:600;'
            f'letter-spacing:-0.5px;color:{E["text"]};">{BRAND_NAME}</td>'
            f'</tr></table></td></tr>'
            f'<tr><td style="padding:8px 24px 14px;"><div style="font-size:17px;font-weight:600;color:{E["text"]};">{title}</div>{sub}</td></tr>'
            f'{inner_rows}'
            '</table></td></tr></table></body></html>')

def email_button(url, label, width=210):
    """Bulletproof CTA: rounded VML in Outlook, rounded <a> elsewhere, in the portal accent."""
    E = EMAIL
    return (f'<tr><td align="center" style="padding:6px 24px 22px;">'
            f'<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{esc(url)}" '
            f'style="height:42px;v-text-anchor:middle;width:{width}px;" arcsize="14%" fillcolor="{E["accent"]}" stroke="f">'
            f'<center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:600;">{label}</center>'
            f'</v:roundrect><![endif]-->'
            f'<!--[if !mso]><!-- --><a href="{esc(url)}" style="display:inline-block;background:{E["accent"]};color:#ffffff;'
            f'font-size:14px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:9px;">{label}</a><!--<![endif]--></td></tr>')

def build_eml(frm, frm_name, to, subject, text_body, html_body):
    """multipart/alternative message (text + HTML) as a raw .eml string."""
    boundary = email.utils.make_msgid().strip("<>").replace("@", "-")
    lines = [
        f"From: {email.utils.formataddr((frm_name or default_sender_name(), frm))}",
        f"To: {to}",
        f"Subject: {subject}",
        f"Date: {email.utils.formatdate(localtime=True)}",
        f"Message-ID: {email.utils.make_msgid()}",
        "MIME-Version: 1.0",
        f'Content-Type: multipart/alternative; boundary="{boundary}"',
        "",
        f"--{boundary}",
        "Content-Type: text/plain; charset=utf-8",
        "", text_body, "",
        f"--{boundary}",
        "Content-Type: text/html; charset=utf-8",
        "", html_body, "",
        f"--{boundary}--", "",
    ]
    return "\r\n".join(lines)

def send(frm, to, eml, dry=False):
    """Send a raw .eml via curl SMTP. Scheme by port: 465=smtps, else smtp+STARTTLS.
    Surfaces only the server's own 4xx/5xx line (client lines carry base64 creds)."""
    if dry:
        print(f"--- DRY-RUN to {to} ---")
        return
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
    port = os.environ.get("SMTP_PORT", "465").strip()
    user = os.environ["SMTP_USER"].strip(); pw = os.environ["SMTP_PASS"].strip()
    scheme = "smtps" if port == "465" else "smtp"
    with tempfile.NamedTemporaryFile("w", suffix=".eml", delete=False, encoding="utf-8") as f:
        f.write(eml); path = f.name
    try:
        r = subprocess.run(["curl", "--silent", "--show-error", "-v", "--ssl-reqd",
            "--url", f"{scheme}://{host}:{port}", "--user", f"{user}:{pw}",
            "--mail-from", frm, "--mail-rcpt", to, "--upload-file", path],
            capture_output=True, text=True)
        if r.returncode != 0:
            server_err = ""
            for ln in (r.stderr or "").splitlines():
                if ln.startswith("< ") and len(ln) >= 5 and ln[2:5].isdigit() and ln[2] in "45":
                    server_err = ln[2:].strip()
            msg = server_err or (r.stderr or r.stdout or "curl failed").strip().splitlines()[-1]
            raise RuntimeError(msg[:200])
    finally:
        os.unlink(path)

def smtp_from():
    return (os.environ.get("SMTP_FROM", "").strip()
            or os.environ.get("SMTP_USER", "noreply@example.com"))

# --- shared first-run bootstrap (seeds state from CURRENT data, emails nothing) ---
def needs_bootstrap(state):
    return not state.get("bootstrapped")

def resolved_by_advisor():
    """{ advisorId: set(comment ids that already have a resolution) } from advisor/*/*.json."""
    out = {}
    for p in glob.glob("advisor/*/*.json"):
        adv = p.split(os.sep)[1]
        j = load_json(p, None)
        if not j:
            continue
        for c in j.get("comments", []):
            if c.get("resolution") and c.get("id"):
                out.setdefault(adv, set()).add(c["id"])
    return out

def seed_bootstrap(state, rel, resolved, now):
    state["bootstrapped"] = True
    state["last_author_digest_ts"] = now
    state.setdefault("notified_released", {})
    state.setdefault("notified_resolved", {})
    state.setdefault("last_resolved_email_ts", {})
    for adv, meta in rel.items():
        if adv == "_comment":
            continue
        state["notified_released"][adv] = list(meta.get("released") or [])
    for adv, ids in resolved.items():
        state["notified_resolved"][adv] = sorted(ids)
    return state

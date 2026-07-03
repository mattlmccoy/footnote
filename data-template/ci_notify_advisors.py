#!/usr/bin/env python3
"""ci_notify_advisors.py — advisor emails: chapter-released (immediate) + responses-ready (floored).
Run by release-notify.yml (on release.json push) AND notify.yml (cron sweep for late resolutions).
Gated by advisors.json.email_configured. Never emails on zero new items.
Advisor-facing copy is deliberately free of any assistant references.
"""
import os, glob, sys, datetime
import ci_notify_common as C

STATE = "notify_state.json"
RESPONSE_BATCH = 5          # >= this many new resolutions fires immediately
STRAGGLER_DAYS = 7          # else fire if >=1 new and this many days since last email

def new_released(adv, rel, state):
    have = set((state.get("notified_released") or {}).get(adv, []))
    return [c for c in (rel.get(adv, {}).get("released") or []) if c not in have]

def _days_since(last_ts, now):
    if not last_ts:
        return 1e9
    a = datetime.datetime.fromisoformat(last_ts)
    b = datetime.datetime.fromisoformat(now)
    return (b - a).total_seconds() / 86400.0

def should_send_responses(new_count, last_ts, now):
    if new_count <= 0:
        return False
    if last_ts is None:
        return True
    if new_count >= RESPONSE_BATCH:
        return True
    return _days_since(last_ts, now) >= STRAGGLER_DAYS

def _adv_files(adv):
    return [C.load_json(p, None) for p in glob.glob(f"advisor/{adv}/*.json") if C.load_json(p, None) is not None]

def resolved_ids_and_counts(files):
    ids, counts = set(), {"addressed": 0, "declined": 0, "noted": 0}
    for f in files:
        for c in f.get("comments", []):
            r = c.get("resolution")
            if r and c.get("id"):
                ids.add(c["id"])
                st = r.get("state", "noted")
                counts[st] = counts.get(st, 0) + 1
    return ids, counts

def _chapters_email(name, chapters, labels, url, stamp):
    E = C.EMAIL
    plural = "chapters" if len(chapters) != 1 else "chapter"
    divider = f"border-top:1px solid {E['box_border']};"
    rows = "".join(
        f'<tr><td style="padding:9px 14px;{"" if i == 0 else divider}font-size:13px;color:{E["text"]};">{C.esc(C.chapter_label(c, labels))}</td></tr>'
        for i, c in enumerate(chapters))
    text = (f"Hi {name},\n\n{os.environ.get('AUTHOR_NAME','The author')} released {len(chapters)} {plural} for your review:\n"
            + "".join(f"  - {C.chapter_label(c, labels)}\n" for c in chapters)
            + f"\nOpen your review portal: {url}\n\nYour comments are saved as you go. Thank you for reviewing.\n")
    inner = (
        f'<tr><td style="padding:0 24px 14px;"><div style="font-size:14px;color:{E["text2"]};line-height:1.55;margin-bottom:12px;">'
        f'Hi {C.esc(name)}, {C.esc(os.environ.get("AUTHOR_NAME","the author"))} released <span style="color:{E["text"]};font-weight:500;">{len(chapters)} {plural}</span> for your review:</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{E["box"]};border:1px solid {E["box_border"]};border-radius:9px;">{rows}</table></td></tr>'
        + C.email_button(url, "Open your review portal")
        + f'<tr><td style="padding:0 24px 20px;"><div style="font-size:11px;color:{E["text3"]};">Your comments are saved as you go. Thank you for reviewing.</div></td></tr>'
    )
    html = C.email_shell(f"New {plural} ready to review", f"As of {stamp}", inner)
    _an = os.environ.get('AUTHOR_NAME', '')
    subject = f"New {plural} ready to review — {_an}'s dissertation" if _an else f"New {plural} ready to review"
    return subject, text, html

def _responses_email(name, counts, url, stamp):
    total = counts["addressed"] + counts["declined"] + counts["noted"]
    parts = []
    if counts["addressed"]: parts.append(f'{counts["addressed"]} addressed')
    if counts["declined"]:  parts.append(f'{counts["declined"]} kept as written')
    if counts["noted"]:     parts.append(f'{counts["noted"]} noted')
    author = os.environ.get('AUTHOR_NAME', 'The author')
    subject = f"{author} responded to your comments"
    text = (f"Hi {name},\n\n{author} responded to your review comments:\n\n"
            f"  {total} responses — {', '.join(parts)}\n\n"
            f"Open your portal to see how each was handled: {url}\n\n"
            "You'll only get another email like this when there are substantial new responses.\n")
    E = C.EMAIL
    def card(n, label, tint, fg):
        return (f'<td width="33%" style="background:{tint};border:1px solid {E["box_border"]};border-radius:9px;padding:13px 6px;text-align:center;">'
                f'<div style="font-size:22px;font-weight:600;color:{fg};">{n}</div>'
                f'<div style="font-size:12px;color:{fg};">{label}</div></td>')
    cells = (card(counts["addressed"], "addressed", "#e1f5ee", "#0f6e56")
             + card(counts["declined"], "kept as written", E["box"], E["text2"])
             + card(counts["noted"], "noted", E["box"], E["text2"]))
    inner = (
        f'<tr><td style="padding:0 24px 14px;"><div style="font-size:14px;color:{E["text2"]};line-height:1.55;margin-bottom:14px;">'
        f'You have <span style="color:{E["text"]};font-weight:500;">{total} responses</span> to your review comments:</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;"><tr>{cells}</tr></table></td></tr>'
        + C.email_button(url, "See how each was handled", width=230)
        + f'<tr><td style="padding:0 24px 20px;"><div style="font-size:11px;color:{E["text3"]};">You\'ll only get another email like this when there are substantial new responses.</div></td></tr>'
    )
    html = C.email_shell(f"{C.esc(author)} responded to your comments", f"As of {stamp}", inner)
    return subject, text, html

def main():
    dry = "--dry-run" in sys.argv
    rel = C.load_json("release.json", {})
    state = C.load_json(STATE, {})
    now = C.iso_now(); stamp = now[:16].replace("T", " ")
    if C.needs_bootstrap(state):
        C.seed_bootstrap(state, rel, C.resolved_by_advisor(), now)
        if not dry:
            C.save_json(STATE, state)
        print("::notice::bootstrap — seeded state without emailing."); return
    reg = C.load_json("advisors.json", {"advisors": []})
    if reg.get("email_configured") is not True:
        print("::notice::email not configured — advisor emails skipped."); return
    state.setdefault("notified_released", {})
    state.setdefault("notified_resolved", {})
    state.setdefault("last_resolved_email_ts", {})
    labels = C.chapter_labels()
    base = os.environ.get("PORTAL_BASE", "")
    frm = C.smtp_from(); frm_name = os.environ.get("SMTP_FROM_NAME")
    by_id = {a["id"]: a for a in reg.get("advisors", [])}
    sent = 0
    for adv in [k for k in rel.keys() if k != "_comment"]:
        a = by_id.get(adv)
        email_to = (a or {}).get("email")
        name = C.advisor_name(adv, reg)
        url = C.portal_advisor_url(base, adv, name)
        if not email_to:
            continue
        # chapter-released
        newch = new_released(adv, rel, state)
        if newch:
            subj, text, html = _chapters_email(name, newch, labels, url, stamp)
            try:
                C.send(frm, email_to, C.build_eml(frm, frm_name, email_to, subj, text, html), dry=dry)
                state["notified_released"].setdefault(adv, [])
                state["notified_released"][adv] = sorted(set(state["notified_released"][adv]) | set(newch))
                sent += 1; print(f"chapter-released email to {email_to} ({len(newch)})")
            except Exception as e:
                print(f"::warning::chapter email to {email_to} failed: {e}")
        # responses-ready (only when author released responses to this advisor)
        if rel.get(adv, {}).get("responses_released"):
            ids, counts = resolved_ids_and_counts(_adv_files(adv))
            already = set(state["notified_resolved"].get(adv, []))
            new_ids = ids - already
            last_ts = state["last_resolved_email_ts"].get(adv)
            if should_send_responses(len(new_ids), last_ts, now):
                subj, text, html = _responses_email(name, counts, url, stamp)
                try:
                    C.send(frm, email_to, C.build_eml(frm, frm_name, email_to, subj, text, html), dry=dry)
                    state["notified_resolved"][adv] = sorted(already | new_ids)
                    state["last_resolved_email_ts"][adv] = now
                    sent += 1; print(f"responses email to {email_to} ({len(new_ids)} new)")
                except Exception as e:
                    print(f"::warning::responses email to {email_to} failed: {e}")
    if not dry:
        C.save_json(STATE, state)
    print(f"done — {sent} advisor email(s) sent")

if __name__ == "__main__":
    main()

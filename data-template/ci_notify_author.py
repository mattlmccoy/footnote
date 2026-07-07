#!/usr/bin/env python3
"""ci_notify_author.py — twice-daily digest of new advisor comments/replies to the author.
Run by notify.yml. Reads notify_config.json (author_email) + notify_state.json (dedup).
Sends nothing when there are no new events. First run bootstraps state without emailing.
"""
import os, glob, sys
import ci_notify_common as C

STATE = "notify_state.json"

def _read_advisor_files(prefix=""):
    """{ advisorId: [file_json, ...] } from <prefix>advisor/*/*.json."""
    out = {}
    for p in glob.glob(f"{prefix}advisor/*/*.json"):
        adv = p.split(os.sep)[-2]
        j = C.load_json(p, None)
        if j is not None:
            out.setdefault(adv, []).append(j)
    return out

def collect_events(files_by_adv, hwm):
    """New comments (status != open, created_ts > hwm) + advisor thread replies (ts > hwm)."""
    events = {}
    for adv, files in files_by_adv.items():
        rows = []
        for f in files:
            ch = f.get("chapter", "")
            for c in f.get("comments", []):
                if c.get("status") != "open" and (c.get("created_ts") or "") > hwm:
                    rows.append({"kind": "comment", "chapter": ch,
                                 "quote": (c.get("anchor") or {}).get("quote", ""),
                                 "body": c.get("body", "")})
                for t in c.get("thread", []):
                    if t.get("author") != "author" and (t.get("ts") or "") > hwm:
                        rows.append({"kind": "reply", "chapter": ch,
                                     "quote": (c.get("anchor") or {}).get("quote", ""),
                                     "body": t.get("text", "")})
        if rows:
            events[adv] = rows
    return events

def _render(events, reg, labels, base, now):
    counts_c = sum(1 for a in events for e in events[a] if e["kind"] == "comment")
    counts_r = sum(1 for a in events for e in events[a] if e["kind"] == "reply")
    n_adv = len(events)
    stamp = now[:16].replace("T", " ")
    author = os.environ.get("AUTHOR_NAME", "")
    subj_bits = [f"{counts_c} new comment" + ("s" if counts_c != 1 else "")]
    if counts_r:
        subj_bits.append(f"{counts_r} repl" + ("ies" if counts_r != 1 else "y"))
    subject = f"{author}'s {C.doc_noun()}: " + " and ".join(subj_bits) if author else "Review digest: " + " and ".join(subj_bits)
    portal = (base or "").rstrip("/") + "/" + os.environ.get("OWNER_PORTAL_FILE", "owner.html")
    # --- text part ---
    tl = [f"Review digest — as of {stamp}", ""]
    for adv, rows in events.items():
        tl.append(C.advisor_name(adv, reg))
        for e in rows:
            lead = "reply on " if e["kind"] == "reply" else ""
            tl.append(f"  [{C.chapter_label(e['chapter'], labels)}] {lead}\"{e['quote'][:60]}\" — {e['body'][:80]}")
        tl.append("")
    tl.append(f"Open your reviewer portal: {portal}")
    text = "\n".join(tl)
    # --- html part (shared portal-matched shell) ---
    E = C.EMAIL
    def _stat(num, lbl):
        return (f'<td width="33%" style="background:{E["box"]};border:1px solid {E["box_border"]};border-radius:9px;padding:11px 12px;">'
                f'<div style="font-size:22px;font-weight:600;color:{E["text"]};">{num}</div>'
                f'<div style="font-size:12px;color:{E["text3"]};">{lbl}</div></td>')
    cards = ""
    for adv, rows in events.items():
        cards += f'<div style="font-size:14px;font-weight:600;color:{E["text"]};margin:14px 0 8px;">{C.esc(C.advisor_name(adv, reg))}</div>'
        for e in rows:
            head = (f'<div style="font-size:13px;color:{E["text2"]};font-style:italic;">"{C.esc(e["quote"][:64])}"</div>'
                    if e["kind"] == "comment"
                    else f'<div style="font-size:12px;color:{E["text3"]};">&#8618; reply on "{C.esc(e["quote"][:48])}"</div>')
            cards += (f'<div style="font-size:11px;color:{E["text3"]};margin:0 0 4px;">{C.esc(C.chapter_label(e["chapter"], labels))}</div>'
                      f'<div style="margin:0 0 8px;padding:9px 12px;background:{E["box"]};border-left:3px solid {E["accent"]};border-radius:0 6px 6px 0;">'
                      f'{head}<div style="font-size:13px;color:{E["text"]};margin-top:2px;">{C.esc(e["body"][:200])}</div></div>')
    rows_html = (
        f'<tr><td style="padding:2px 24px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;"><tr>'
        f'{_stat(counts_c, "new comments")}{_stat(counts_r, "repl" + ("ies" if counts_r != 1 else "y"))}{_stat(n_adv, "reviewer" + ("s" if n_adv != 1 else ""))}'
        '</tr></table></td></tr>'
        f'<tr><td style="padding:4px 24px 4px;">{cards}</td></tr>'
        + C.email_button(portal, "Open reviewer portal")
        + f'<tr><td style="padding:0 24px 20px;"><div style="font-size:11px;color:{E["text3"]};">You\'re getting this because you set a notification email in the reviewer app.</div></td></tr>'
    )
    html = C.email_shell("Review digest", f"As of {stamp} · since your last digest", rows_html, width=560)
    return subject, text, html

def _run_project(prefix, dry):
    """Author digest for one project (prefix '' = legacy root, '<id>/' = a workspace subfolder)."""
    cfg = C.load_json(f"{prefix}notify_config.json", {})
    to = (cfg.get("author_email") or "").strip()
    if not to:
        print(f"::notice::no author_email in {prefix}notify_config.json — author digest skipped ({prefix or 'root'})."); return
    freq = cfg.get("frequency", "daily")            # user-chosen cadence: off | daily | weekly
    state_path = f"{prefix}{STATE}"
    state = C.load_json(state_path, {})
    now = C.iso_now()
    # Honor the author's chosen frequency (off = zero notifications). Bootstrapped state still seeds silently.
    if not C.needs_bootstrap(state) and not C.digest_due(freq, state.get("last_author_digest_ts")):
        print(f"::notice::author digest not due yet (freq={freq}) — skipped ({prefix or 'root'})."); return
    if C.needs_bootstrap(state):
        C.seed_bootstrap(state, C.load_json(f"{prefix}release.json", {}), C.resolved_by_advisor(prefix), now)
        if not dry:
            C.save_json(state_path, state)
        print(f"::notice::bootstrap — seeded state without emailing ({prefix or 'root'})."); return
    files = _read_advisor_files(prefix)
    events = collect_events(files, state["last_author_digest_ts"])
    if not events:
        state["last_author_digest_ts"] = now
        if not dry:
            C.save_json(state_path, state)
        print(f"no new advisor activity — no email sent ({prefix or 'root'})."); return
    reg = C.load_json(f"{prefix}advisors.json", {"advisors": []})
    labels = C.chapter_labels(prefix)
    base = os.environ.get("PORTAL_BASE", "")
    subject, text, html = _render(events, reg, labels, base, now)
    frm = C.smtp_from(); frm_name = os.environ.get("SMTP_FROM_NAME")
    eml = C.build_eml(frm, frm_name, to, subject, text, html)
    C.send(frm, to, eml, dry=dry)
    state["last_author_digest_ts"] = now
    if not dry:
        C.save_json(state_path, state)
    print(f"author digest sent to {to} ({prefix or 'root'})")

def main():
    dry = "--dry-run" in sys.argv
    # Legacy repo: root files. Consolidated workspace: one digest per <id>/ subfolder.
    for prefix in (C.project_prefixes() or [""]):
        _run_project(prefix, dry)

if __name__ == "__main__":
    main()

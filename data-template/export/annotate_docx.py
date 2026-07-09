#!/usr/bin/env python3
"""annotate_docx.py — inject native Word comments + tracked-change suggestions into a
pandoc-built .docx, anchored to quoted passages and attributed to each reviewer.

Anything that can't be anchored (figure/equation comments, or a quote not found in the
body) is collected into a "Reviewer comments" appendix so NO comment is ever dropped.

Usage:
    python3 annotate_docx.py BASE.docx COMMENTS.json OUT.docx
    python3 annotate_docx.py --selftest          # build a synthetic docx and self-check

COMMENTS.json is a list of objects:
    { "author": "Carolyn C. Seepersad", "date": "2026-06-28T14:05:00Z",
      "quote": "radio-frequency additive manufacturing", "body": "comment text",
      "edit": {"op":"replace","find":"...","replacement":"..."} | null,
      "resolution": {"state":"addressed","note":"..."} | null, "kind": "text" }
"""
import sys, os, json, re, copy, zipfile, shutil, tempfile
from lxml import etree

W   = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CT  = "http://schemas.openxmlformats.org/package/2006/content-types"
PR  = "http://schemas.openxmlformats.org/package/2006/relationships"
ORE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML = "http://www.w3.org/XML/1998/namespace"
def w(tag): return f"{{{W}}}{tag}"
NSMAP = {"w": W}

def _norm(s): return re.sub(r"\s+", " ", (s or "").strip())
def _initials(name):
    parts = [p for p in re.split(r"\s+", name or "") if p]
    return "".join(p[0] for p in parts[:3]).upper() or "RV"
def _preserve(t):
    if t is not None and t.text is not None and (t.text != t.text.strip() or "  " in t.text):
        t.set(f"{{{XML}}}space", "preserve")

# ---------- docx package I/O ----------
def _read_docx(path):
    d = tempfile.mkdtemp(prefix="docx_")
    with zipfile.ZipFile(path) as z: z.extractall(d)
    return d
def _write_docx(d, out):
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(d):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, d))
def _parse(path):
    return etree.parse(path, etree.XMLParser(remove_blank_text=False))

# ---------- run-level anchoring ----------
def _runs(p):
    """Runs in paragraph p that carry visible text, with their w:t element + text."""
    out = []
    for r in p.findall(w("r")):
        t = r.find(w("t"))
        out.append({"r": r, "t": t, "text": (t.text or "") if t is not None else ""})
    return out

def _locate(quote, runs):
    """Return (start_run_idx, start_pos, end_run_idx, end_pos_inclusive) for the
    whitespace-normalized quote across the paragraph's runs, or None."""
    chars = []                              # (run_idx, pos_in_run, char)
    for i, ru in enumerate(runs):
        for j, ch in enumerate(ru["text"]):
            chars.append((i, j, ch))
    if not chars: return None
    norm, nmap, prev_ws = [], [], False
    for idx, (_, _, ch) in enumerate(chars):
        if ch.isspace():
            if prev_ws: continue
            norm.append(" "); nmap.append(idx); prev_ws = True
        else:
            norm.append(ch); nmap.append(idx); prev_ws = False
    q = _norm(quote)
    if not q: return None
    pos = "".join(norm).find(q)
    if pos < 0: return None
    s = chars[nmap[pos]]; e = chars[nmap[pos + len(q) - 1]]
    return s[0], s[1], e[0], e[1]

def _split_run(run, t, at):
    """Split a run after `at` chars: run keeps text[:at], a clone with text[at:] is
    inserted right after. Returns the right-hand clone (or None if no split needed)."""
    text = t.text or ""
    if at <= 0 or at >= len(text): return None
    right = copy.deepcopy(run)
    t.text = text[:at]; _preserve(t)
    rt = right.find(w("t")); rt.text = text[at:]; _preserve(rt)
    run.addnext(right)
    return right

def _carve(p, loc):
    """Given a located range, split boundary runs so the matched text is exactly the
    runs between (and including) a known start and end element. Returns (start_run, end_run)."""
    runs = _runs(p)
    si, sp, ei, ep = loc
    # split END first (so START indices stay valid), keeping matched text in the original element
    end_run = runs[ei]["r"]; end_t = runs[ei]["t"]
    _split_run(end_run, end_t, ep + 1)                      # tail (after match) moves to a new sibling
    runs = _runs(p)
    start_run = runs[si]["r"]; start_t = runs[si]["t"]
    if sp > 0:
        new_right = _split_run(start_run, start_t, sp)      # head (before match) stays in start_run; match moves right
        start_run = new_right if new_right is not None else start_run
        if si == ei:                                        # same run: the end is now the same (right) element
            end_run = start_run
    return start_run, end_run

# ---------- comments part ----------
def _ensure_comments_part(base_dir):
    cpath = os.path.join(base_dir, "word", "comments.xml")
    if os.path.exists(cpath):
        tree = _parse(cpath); root = tree.getroot()
    else:
        root = etree.Element(w("comments"), nsmap=NSMAP); tree = etree.ElementTree(root)
        # content types
        ctp = os.path.join(base_dir, "[Content_Types].xml"); ct = _parse(ctp); cr = ct.getroot()
        if not any(o.get("PartName") == "/word/comments.xml" for o in cr.findall(f"{{{CT}}}Override")):
            etree.SubElement(cr, f"{{{CT}}}Override", PartName="/word/comments.xml",
                ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml")
            ct.write(ctp, xml_declaration=True, encoding="UTF-8", standalone=True)
        # relationship
        rp = os.path.join(base_dir, "word", "_rels", "document.xml.rels")
        os.makedirs(os.path.dirname(rp), exist_ok=True)
        if os.path.exists(rp): rt = _parse(rp); rr = rt.getroot()
        else: rr = etree.Element(f"{{{PR}}}Relationships", nsmap={None: PR}); rt = etree.ElementTree(rr)
        if not any(rel.get("Target") == "comments.xml" for rel in rr):
            ids = [rel.get("Id") for rel in rr]
            nid = "rId" + str(max([int(re.sub(r"\D", "", i) or 0) for i in ids] + [0]) + 1)
            etree.SubElement(rr, f"{{{PR}}}Relationship", Id=nid,
                Type=f"{ORE}/comments", Target="comments.xml")
        rt.write(rp, xml_declaration=True, encoding="UTF-8", standalone=True)
    return tree, root, cpath

def _comment_el(cid, author, date, paras):
    c = etree.Element(w("comment")); c.set(w("id"), str(cid))
    c.set(w("author"), author or "Reviewer"); c.set(w("initials"), _initials(author))
    if date: c.set(w("date"), date)
    for text in paras:
        p = etree.SubElement(c, w("p")); r = etree.SubElement(p, w("r")); t = etree.SubElement(r, w("t"))
        t.text = text; _preserve(t)
    return c

def _ref_run(cid):
    r = etree.Element(w("r"))
    rpr = etree.SubElement(r, w("rPr")); etree.SubElement(rpr, w("rStyle")).set(w("val"), "CommentReference")
    etree.SubElement(r, w("commentReference")).set(w("id"), str(cid))
    return r

def _wrap_comment(p, start_run, end_run, cid):
    crs = etree.Element(w("commentRangeStart")); crs.set(w("id"), str(cid))
    start_run.addprevious(crs)
    cre = etree.Element(w("commentRangeEnd")); cre.set(w("id"), str(cid))
    end_run.addnext(cre)
    cre.addnext(_ref_run(cid))

# ---------- coarse anchoring (handles citations/cross-refs that pandoc wraps in <w:hyperlink>) ----------
def _inline_children(p):
    """Ordered inline children of the paragraph (w:r, w:hyperlink, w:ins, w:smartTag, …) with
    their full descendant text — so a quote spanning a hyperlinked citation still matches."""
    out = []
    for ch in p:
        if etree.QName(ch).localname == "pPr":
            continue
        txt = "".join(t.text or "" for t in ch.iter(w("t"), w("delText")))
        out.append({"el": ch, "text": txt})
    return out

def _locate_children(quote, children):
    """Locate the normalized quote across inline children; return (start_idx, end_idx) inclusive."""
    chars = []                              # (child_idx, char)
    for i, c in enumerate(children):
        for ch in c["text"]:
            chars.append((i, ch))
    if not chars:
        return None
    norm, nmap, prev_ws = [], [], False
    for idx, (_, ch) in enumerate(chars):
        if ch.isspace():
            if prev_ws: continue
            norm.append(" "); nmap.append(idx); prev_ws = True
        else:
            norm.append(ch); nmap.append(idx); prev_ws = False
    q = _norm(quote)
    if not q:
        return None
    pos = "".join(norm).find(q)
    if pos < 0:
        return None
    return chars[nmap[pos]][0], chars[nmap[pos + len(q) - 1]][0]

def _wrap_children(p, children, si, ei, cid):
    """Comment range at inline-child granularity (slightly coarser, but robust against wrappers)."""
    crs = etree.Element(w("commentRangeStart")); crs.set(w("id"), str(cid))
    children[si]["el"].addprevious(crs)
    cre = etree.Element(w("commentRangeEnd")); cre.set(w("id"), str(cid))
    children[ei]["el"].addnext(cre)
    cre.addnext(_ref_run(cid))

# ---------- tracked changes ----------
def _tracked_change(p, start_run, end_run, cid, author, date, op, replacement):
    """Wrap [start_run..end_run] as a w:del (delText), and/or add a w:ins with replacement."""
    parent = start_run.getparent()
    sibs = []; cur = start_run
    while True:
        sibs.append(cur)
        if cur is end_run: break
        cur = cur.getnext()
        if cur is None: break
    if op in ("replace", "delete"):
        delel = etree.Element(w("del")); delel.set(w("id"), str(cid))
        delel.set(w("author"), author or "Reviewer");
        if date: delel.set(w("date"), date)
        idx = parent.index(sibs[0]); parent.insert(idx, delel)
        for r in sibs:
            parent.remove(r); delel.append(r)
            t = r.find(w("t"))
            if t is not None: t.tag = w("delText"); _preserve(t)
        anchor = delel
    else:
        anchor = end_run
    if op in ("replace", "insert") and replacement:
        ins = etree.Element(w("ins")); ins.set(w("id"), str(cid + 100000))
        ins.set(w("author"), author or "Reviewer")
        if date: ins.set(w("date"), date)
        r = etree.SubElement(ins, w("r")); t = etree.SubElement(r, w("t")); t.text = replacement; _preserve(t)
        anchor.addnext(ins)

# ---------- appendix (nothing dropped) ----------
def _appendix(body, items):
    if not items: return
    h = etree.SubElement(body, w("p"))
    ppr = etree.SubElement(h, w("pPr")); etree.SubElement(ppr, w("pStyle")).set(w("val"), "Heading1")
    r = etree.SubElement(h, w("r")); t = etree.SubElement(r, w("t")); t.text = "Reviewer comments"
    for n, it in enumerate(items, 1):
        p = etree.SubElement(body, w("p"))
        bits = [f"{n}. [{it.get('author','Reviewer')}"]
        if it.get("date"): bits[0] += f", {it['date'][:10]}"
        bits[0] += "]"
        if it.get("quote"): bits.append(f' on "{_norm(it["quote"])[:80]}"')
        bits.append(": " + (it.get("body") or ""))
        e = it.get("edit")
        if e: bits.append(f"  [suggested {e.get('op')}: \"{e.get('find','')}\" → \"{e.get('replacement','')}\"]")
        res = it.get("resolution")
        if res: bits.append(f"  [{res.get('state')}: {res.get('note','')}]")
        r = etree.SubElement(p, w("r")); t = etree.SubElement(r, w("t")); t.text = "".join(bits); _preserve(t)

def _variants(quote):
    """Quote forms to try, most-specific first: as-is, minus an injected 'Figure 3.1.:' prefix
    (and any doubled label), and the first sentence — so caption/cross-ref comments still anchor."""
    out, seen = [], set()
    cands = [quote]
    stripped = re.sub(r"^\s*(Figure|Fig\.?|Table)\s*[\d.]+\.?[:\s]+", "", quote, flags=re.I)
    stripped = re.sub(r"^\s*(Figure|Fig\.?|Table)\s*[\d.]+\.?\s+", "", stripped, flags=re.I)  # doubled label
    cands.append(stripped)
    m = re.split(r"(?<=[.!?])\s", stripped.strip())
    if m and len(m[0]) >= 12: cands.append(m[0])
    for q in cands:
        n = _norm(q)
        if len(n) >= 6 and n not in seen:
            seen.add(n); out.append(q)
    return out

# ---------- proximity fallbacks: anchor near the object or in the right section ----------
def _para_text(p):
    return _norm("".join(t.text or "" for t in p.iter(w("t"), w("delText"))))

def _obj_ref(*texts):
    """Pull a 'Figure 3.9' / 'Table 3.1' / 'Eq 3.2' reference out of any of the given strings."""
    for s in texts:
        m = re.search(r"\b(Figure|Fig\.?|Table|Tab\.?|Equation|Eq\.?)\s*([0-9]+(?:\.[0-9]+)*)", s or "", re.I)
        if m:
            k = m.group(1).lower()
            kind = "Table" if k.startswith("ta") else "Equation" if k.startswith("e") else "Figure"
            return kind, m.group(2)
    return None

def _locate_object(paras, kind, num):
    """Anchor to the object's caption (label near the paragraph start) or, failing that, the
    first prose mention of it. Returns (paragraph, (start_child, end_child), is_caption) or None."""
    if kind == "Equation":
        pat = re.compile(r"(?:Equation|Eq\.?)\s*%s|\(%s\)" % (re.escape(num), re.escape(num)), re.I)
    else:
        word = "Figure|Fig\\.?" if kind == "Figure" else "Table|Tab\\.?"
        pat = re.compile(r"(?:%s)\s*%s\b" % (word, re.escape(num)), re.I)
    caption = None; prose = None
    for p in paras:
        txt = _para_text(p)
        m = pat.search(txt)
        if not m:
            continue
        loc = _locate_children(m.group(0), _inline_children(p))
        if not loc:
            continue
        if m.start() < 14 and caption is None:   # label at the start → it's the caption paragraph
            caption = (p, loc, True)
        elif prose is None:
            prose = (p, loc, False)
    return caption or prose

def _locate_section(paras, section):
    """Anchor to the heading whose text matches the comment's section. Returns (p, (si,ei))."""
    s = _norm(section)
    if len(s) < 4:
        return None
    sl = s.lower()
    for p in paras:
        ppr = p.find(w("pPr"))
        style = ppr.find(w("pStyle")) if ppr is not None else None
        if style is None or "Heading" not in (style.get(w("val")) or ""):
            continue
        ht = _para_text(p).lower()
        if ht and (ht in sl or sl in ht or ht[:24] == sl[:24]):
            kids = _inline_children(p)
            if kids:
                return (p, (0, len(kids) - 1))
    return None

# ---------- main entry ----------
def annotate(base_docx, comments, out_docx):
    d = _read_docx(base_docx)
    try:
        dpath = os.path.join(d, "word", "document.xml")
        dt = _parse(dpath); body = dt.getroot().find(w("body"))
        paras = body.findall(w("p"))
        ctree, croot, cpath = _ensure_comments_part(d)
        leftover = []
        for cid, c in enumerate(comments):
            quote = c.get("quote") or ""
            body_text = c.get("body") or ""
            res = c.get("resolution")
            paras_txt = [body_text] + ([f"[{res.get('state')}] {res.get('note','')}"] if res and res.get("note") else [])
            edit = c.get("edit")
            placed = False
            variants = _variants(quote) if _norm(quote) else []
            # 1) precise (direct-child runs): native comment + tracked-change suggestion
            for qv in variants:
                if placed: break
                for p in paras:
                    loc = _locate(qv, _runs(p))
                    if loc:
                        start_run, end_run = _carve(p, loc)
                        croot.append(_comment_el(cid, c.get("author"), c.get("date"), paras_txt))
                        _wrap_comment(p, start_run, end_run, cid)
                        if edit and edit.get("op"):
                            floc = _locate(edit.get("find") or qv, _runs(p))
                            if floc:
                                fs, fe = _carve(p, floc)
                                _tracked_change(p, fs, fe, cid, c.get("author"), c.get("date"),
                                                edit.get("op"), edit.get("replacement"))
                        placed = True
                        break
            # 2) coarse (handles hyperlinked citations/cross-refs): anchored comment, edit shown in the body
            for qv in variants:
                if placed: break
                for p in paras:
                    kids = _inline_children(p)
                    loc = _locate_children(qv, kids)
                    if loc:
                        txt = list(paras_txt)
                        if edit and edit.get("op"):
                            txt.append(f"Suggested {edit['op']}: “{edit.get('find','')}” → “{edit.get('replacement','')}”")
                        croot.append(_comment_el(cid, c.get("author"), c.get("date"), txt))
                        _wrap_children(p, kids, loc[0], loc[1], cid)
                        placed = True
                        break
            # anchor at a known (paragraph, child-span); add a note only when it clarifies an approximate placement
            def _anchor_at(p, span, note=None):
                si, ei = span
                txt = list(paras_txt) + ([note] if note else [])
                if edit and edit.get("op"):
                    txt.append(f"Suggested {edit['op']}: “{edit.get('find','')}” → “{edit.get('replacement','')}”")
                croot.append(_comment_el(cid, c.get("author"), c.get("date"), txt))
                _wrap_children(p, _inline_children(p), si, ei, cid)
            # 3) object proximity: figure/table/equation comments → that object's caption (no note) or a body mention (label it)
            if not placed:
                ref = _obj_ref(quote, c.get("figure") or "")
                if ref:
                    hit = _locate_object(paras, *ref)
                    if hit:
                        p, span, is_caption = hit
                        _anchor_at(p, span, None if is_caption else f"On {ref[0]} {ref[1]}.")
                        placed = True
            # 4) section fallback: land on the section heading, and say plainly that the exact spot wasn't found
            if not placed and c.get("section"):
                hit = _locate_section(paras, c.get("section"))
                if hit:
                    p, span = hit
                    _anchor_at(p, span, "Reviewer's exact text wasn't found in this rendering; placed at the start of its section.")
                    placed = True
            if not placed: leftover.append(c)
        _appendix(body, leftover)
        ctree.write(cpath, xml_declaration=True, encoding="UTF-8", standalone=True)
        dt.write(dpath, xml_declaration=True, encoding="UTF-8", standalone=True)
        _write_docx(d, out_docx)
        return len(comments) - len(leftover), len(leftover)
    finally:
        shutil.rmtree(d, ignore_errors=True)

# ---------- self-test ----------
def _make_test_docx(path):
    d = tempfile.mkdtemp(prefix="mk_")
    os.makedirs(os.path.join(d, "word", "_rels"))
    open(os.path.join(d, "[Content_Types].xml"), "w").write(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{CT}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>')
    os.makedirs(os.path.join(d, "_rels"))
    open(os.path.join(d, "_rels", ".rels"), "w").write(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PR}">'
        f'<Relationship Id="rId1" Type="{ORE}/officeDocument" Target="word/document.xml"/></Relationships>')
    open(os.path.join(d, "word", "_rels", "document.xml.rels"), "w").write(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PR}"></Relationships>')
    open(os.path.join(d, "word", "document.xml"), "w").write(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>'
        '<w:p><w:r><w:t xml:space="preserve">This dissertation studies </w:t></w:r>'
        '<w:r><w:t>radio-frequency additive manufacturing</w:t></w:r>'
        '<w:r><w:t xml:space="preserve"> of polymers.</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>The axis labels are hard to read at print size.</w:t></w:r></w:p>'
        '</w:body></w:document>')
    _write_docx(d, path); shutil.rmtree(d, ignore_errors=True)

def _selftest():
    tmp = tempfile.mkdtemp(prefix="atest_")
    base = os.path.join(tmp, "base.docx"); out = os.path.join(tmp, "out.docx")
    _make_test_docx(base)
    comments = [
        {"author": "Carolyn C. Seepersad", "date": "2026-06-28T14:05:00Z",
         "quote": "radio-frequency additive manufacturing", "body": "Consider splitting this sentence.",
         "edit": {"op": "replace", "find": "radio-frequency additive manufacturing",
                  "replacement": "RF additive manufacturing (RFAM)"}, "kind": "text"},
        {"author": "Carolyn C. Seepersad", "date": "2026-06-28T14:09:00Z",
         "quote": "this figure does not exist in the text", "body": "Enlarge the axis labels.", "kind": "figure"},
    ]
    placed, left = annotate(base, comments, out)
    with zipfile.ZipFile(out) as z:
        doc = z.read("word/document.xml").decode(); com = z.read("word/comments.xml").decode()
        ct = z.read("[Content_Types].xml").decode()
    ok = True
    def chk(cond, label):
        nonlocal ok; ok = ok and cond; print(("  ok  " if cond else " FAIL ") + label)
    chk(placed == 1 and left == 1, f"1 anchored, 1 to appendix (got {placed},{left})")
    chk("commentRangeStart" in doc and "commentReference" in doc, "comment range markers inserted")
    chk("Carolyn C. Seepersad" in com, "comment author attributed")
    chk('<w:del' in doc and "delText" in doc, "tracked deletion present")
    chk('<w:ins' in doc and "RFAM" in doc, "tracked insertion present")
    chk("comments.xml" in ct, "comments part registered in content types")
    chk("Reviewer comments" in doc, "appendix carries the unanchored figure comment")
    chk("Enlarge the axis labels" in doc, "unanchored comment text not dropped")
    # validity: reparse
    try: etree.fromstring(z.read("word/document.xml")) if False else etree.parse(io_bytes(doc)); chk(True, "document.xml well-formed")
    except Exception as e: chk(False, f"document.xml well-formed ({e})")
    shutil.rmtree(tmp, ignore_errors=True)
    print("SELFTEST:", "PASS" if ok else "FAIL"); return 0 if ok else 1

def io_bytes(s):
    import io; return io.BytesIO(s.encode())

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        sys.exit(_selftest())
    if len(sys.argv) != 4:
        print(__doc__); sys.exit(2)
    base, cj, out = sys.argv[1], sys.argv[2], sys.argv[3]
    comments = json.load(open(cj))
    placed, left = annotate(base, comments, out)
    print(f"annotated {out}: {placed} anchored, {left} in appendix")

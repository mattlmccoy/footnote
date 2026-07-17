"""Phase 3 — ci_render.py drives the generic export pipeline over every project in a data
repo (dual-mode: legacy root or workspace <id>/ subfolders), writing the reader's contract
outputs. The pure helpers (output paths, entry derivation, source-location decision) are
unit-tested here; the subprocess/git I/O runs live on the adopter's Actions.

Run: python3 -m pytest tests/test_ci_render.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_render as R  # noqa: E402


# ---------------- output paths match the reader contract (app.js) ----------------

def test_content_out_legacy_root():
    assert R.content_out("", "ch_intro") == "content/ch_intro.html"


def test_content_out_workspace_prefix():
    assert R.content_out("metro/", "intro") == "metro/content/intro.html"


def test_srcmap_out_sits_beside_the_html():
    assert R.srcmap_out("metro/", "intro") == "metro/content/intro.srcmap.json"


# ---------------- entry file derivation ----------------

def test_derive_entry_single_file_article():
    rows = [{"id": "a", "sourceFile": "main.tex"}, {"id": "b", "sourceFile": "main.tex"}]
    assert R.derive_entry(rows) == "main.tex"


def test_derive_entry_multifile_defaults_to_main():
    rows = [{"id": "a", "sourceFile": "chapters/a.tex"},
            {"id": "b", "sourceFile": "chapters/b.tex"}]
    assert R.derive_entry(rows) == "main.tex"


def test_derive_entry_respects_a_single_custom_root():
    rows = [{"id": "a", "sourceFile": "paper.tex"}, {"id": "b", "sourceFile": "paper.tex"}]
    assert R.derive_entry(rows) == "paper.tex"


# ---------------- source location: in-repo (workspace) vs external clone ----------------

def test_resolve_source_workspace_internal_is_in_repo():
    # workspace project with source living under <id>/source/ in the SAME (data) repo
    proj = {"id": "metro", "workspace": True}
    kind, ref = R.resolve_source(proj, "metro/", "alice/footnote-projects")
    assert kind == "inrepo"
    assert ref == "metro/source"


def test_resolve_source_external_sourcerepo_clones():
    proj = {"id": "metro", "workspace": True, "sourceRepo": "alice/my-thesis"}
    kind, ref = R.resolve_source(proj, "metro/", "alice/footnote-projects")
    assert kind == "clone"
    assert ref == "alice/my-thesis"


def test_resolve_source_workspace_sourcerepo_equal_to_repo_is_in_repo():
    # sourceRepo pointing at the workspace repo itself = internal, not an external clone
    proj = {"id": "metro", "workspace": True, "sourceRepo": "alice/footnote-projects"}
    kind, ref = R.resolve_source(proj, "metro/", "alice/footnote-projects")
    assert kind == "inrepo"
    assert ref == "metro/source"


def test_resolve_source_legacy_root_external_clone():
    proj = {"id": "", "sourceRepo": "alice/thesis"}
    kind, ref = R.resolve_source(proj, "", "alice/thesis-data")
    assert kind == "clone"
    assert ref == "alice/thesis"


def test_resolve_source_legacy_root_no_repo_uses_env_dir():
    # no project entry / no sourceRepo, legacy root -> render against a provided SOURCE_DIR
    kind, ref = R.resolve_source(None, "", "alice/data")
    assert kind == "inrepo"
    assert ref == "source"


def test_resolve_source_legacy_uses_env_source_repo():
    # legacy data repo has no projects.json, so the external source repo is supplied via the
    # SOURCE_REPO Actions variable (like DOC_NOUN etc.) — must clone it, not look in-repo
    kind, ref = R.resolve_source(None, "", "alice/metro-data", env_source_repo="alice/metro-source")
    assert kind == "clone"
    assert ref == "alice/metro-source"


def test_resolve_source_project_sourcerepo_beats_env():
    proj = {"id": "metro", "sourceRepo": "alice/from-project"}
    kind, ref = R.resolve_source(proj, "metro/", "alice/ws", env_source_repo="alice/from-env")
    assert kind == "clone"
    assert ref == "alice/from-project"


# ---------------- prefix discovery keys off chapters.json (not advisors.json) ----------------

def test_render_prefixes_discovers_workspace_projects(tmp_path, monkeypatch):
    (tmp_path / "metro").mkdir()
    (tmp_path / "metro" / "chapters.json").write_text("[]")
    (tmp_path / "thesis").mkdir()
    (tmp_path / "thesis" / "chapters.json").write_text("[]")
    monkeypatch.chdir(tmp_path)
    assert R.render_prefixes() == ["metro/", "thesis/"]


def test_render_prefixes_legacy_root(tmp_path, monkeypatch):
    (tmp_path / "chapters.json").write_text("[]")
    monkeypatch.chdir(tmp_path)
    assert R.render_prefixes() == [""]


def test_render_prefixes_empty_when_no_units(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert R.render_prefixes() == []


# ---- source resolution via the committed source.json marker (no Actions variable needed) ----
def test_resolve_source_marker_preferred_over_env_var():
    assert R.resolve_source(None, "", "me/data", env_source_repo="me/from-var",
                            marker_source_repo="me/from-marker") == ("clone", "me/from-marker")


def test_resolve_source_project_beats_marker():
    assert R.resolve_source({"sourceRepo": "me/proj"}, "", "me/data",
                            marker_source_repo="me/marker") == ("clone", "me/proj")


def test_resolve_source_marker_only_clones():
    assert R.resolve_source(None, "", "me/data", marker_source_repo="me/ext") == ("clone", "me/ext")


def test_resolve_source_inrepo_when_nothing_set():
    assert R.resolve_source(None, "", "me/data")[0] == "inrepo"


# ---- an unreachable/unauthorized source clone must NOT crash the whole render (protects last-good) ----
def test_render_project_survives_a_failed_source_clone(tmp_path, monkeypatch):
    import json as _json
    d = tmp_path / "data"; d.mkdir()
    (d / "chapters.json").write_text(_json.dumps([{"id": "ch1", "sourceFile": "ch1.tex"}]))
    (d / "projects.json").write_text(_json.dumps([{"id": "", "sourceRepo": "owner/no-access"}]))
    (d / "source.json").write_text(_json.dumps({"sourceRepo": "owner/no-access"}))
    monkeypatch.chdir(d)

    def _boom(*a, **k):
        import subprocess
        raise subprocess.CalledProcessError(128, ["git", "clone"])
    monkeypatch.setattr(R, "_clone", _boom)

    # must return 0 (skipped) rather than raising — a 403 on an external source can't take down render
    n = R.render_project("", "owner/data", "ro-token", tmp_path / "wd")
    assert n == 0


# ---------------- counts.json: word/char counts written for the home grid ----------------

def test_write_counts_json_from_content(tmp_path, monkeypatch):
    import ci_render, json
    (tmp_path / "content").mkdir()
    (tmp_path / "content" / "ch_a.html").write_text("<p>one two three</p>")
    (tmp_path / "content" / "ch_b.html").write_text("<p>alpha beta</p><section id='refs'>ignored ignored</section>")
    rows = [{"id": "ch_a"}, {"id": "ch_b"}]
    monkeypatch.chdir(tmp_path)
    ci_render.write_counts("", rows)
    got = json.loads((tmp_path / "content" / "counts.json").read_text())
    assert got == {"ch_a": {"words": 3, "chars": 11}, "ch_b": {"words": 2, "chars": 9}}

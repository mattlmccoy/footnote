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

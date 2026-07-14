import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import overleaf_sync as O  # noqa: E402


def test_marked_prefixes_maps_marker_paths_to_prefixes():
    paths = ["b/overleaf.json", "a/overleaf.json", "overleaf.json"]
    assert O.marked_prefixes(paths) == ["", "a/", "b/"]


def test_marked_prefixes_empty_when_no_markers():
    assert O.marked_prefixes([]) == []


def test_secret_name_sanitizes_project_id():
    assert O.secret_name("metrology-paper") == "OVERLEAF_TOKEN_METROLOGY_PAPER"
    assert O.secret_name("proj.1") == "OVERLEAF_TOKEN_PROJ_1"
    assert O.secret_name("") == "OVERLEAF_TOKEN"


def test_secret_name_collapses_runs_and_trims():
    assert O.secret_name("a--b") == "OVERLEAF_TOKEN_A_B"
    assert O.secret_name("-x-") == "OVERLEAF_TOKEN_X"


def test_three_way_lines_fast_paths():
    assert O.three_way_lines("x\n", "x\n", "x\n") == ("x\n", False)
    assert O.three_way_lines("x\n", "y\n", "x\n") == ("y\n", False)
    assert O.three_way_lines("x\n", "x\n", "z\n") == ("z\n", False)


def test_three_way_lines_merges_disjoint_hunks():
    base = "l1\nl2\nl3\nl4\n"
    a = "A1\nl2\nl3\nl4\n"
    b = "l1\nl2\nl3\nB4\n"
    assert O.three_way_lines(base, a, b) == ("A1\nl2\nl3\nB4\n", False)


def test_three_way_lines_conflict_on_overlap():
    base = "l1\nl2\nl3\n"
    a = "l1\nAA\nl3\n"
    b = "l1\nBB\nl3\n"
    text, conflict = O.three_way_lines(base, a, b)
    assert conflict is True


def test_merge_file_add_delete_and_binary():
    assert O.merge_file("x\n", "x\n", None, True) == {"content": None, "conflict": False}
    assert O.merge_file(None, "new\n", None, True) == {"content": "new\n", "conflict": False}
    assert O.merge_file("x\n", None, "y\n", True)["conflict"] is True
    assert O.merge_file("A", "B", "A", False) == {"content": "B", "conflict": False}
    assert O.merge_file("A", "B", "C", False)["conflict"] is True


def test_plan_sync_merges_pulls_and_pushes():
    base = {"main.tex": "l1\nl2\n"}
    overleaf = {"main.tex": "L1\nl2\n"}
    github = {"main.tex": "l1\nl2\n"}
    plan = O.plan_sync(base, overleaf, github)
    assert plan["merged"] == {"main.tex": "L1\nl2\n"}
    assert plan["conflicts"] == []
    assert plan["pull_needed"] is True
    assert plan["push_needed"] is False


def test_plan_sync_reports_conflicts_and_deletes():
    base = {"a.tex": "x\n", "b.tex": "keep\n"}
    overleaf = {"a.tex": "AA\n"}
    github = {"a.tex": "BB\n", "b.tex": "keep\n"}
    plan = O.plan_sync(base, overleaf, github)
    assert "a.tex" in plan["conflicts"]
    assert "b.tex" not in plan["merged"]


def test_plan_sync_noop_when_all_equal():
    tree = {"main.tex": "same\n"}
    plan = O.plan_sync(dict(tree), dict(tree), dict(tree))
    assert plan["pull_needed"] is False and plan["push_needed"] is False and plan["conflicts"] == []

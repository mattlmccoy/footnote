"""stamp_built.py — stamp content/built.json for a MANUALLY rendered data repo (rfam renders by
hand, not via the render workflow). Only units whose HTML changed since their last stamp are
re-stamped, so the manifest never claims a unit was built from a commit it wasn't.

Run: python3 -m pytest tests/test_stamp_built.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import stamp_built as S  # noqa: E402


def test_unstamped_units_need_stamping(tmp_path):
    content = tmp_path / "content"
    content.mkdir()
    (content / "ch_a.html").write_text("x")
    assert S.units_needing_stamp(content, {}) == ["ch_a"]


def test_unit_whose_html_is_older_than_its_stamp_is_left_alone(tmp_path):
    content = tmp_path / "content"
    content.mkdir()
    f = content / "ch_a.html"
    f.write_text("x")
    import os, datetime
    # stamp recorded AFTER the html was written -> not re-rendered since
    later = datetime.datetime.fromtimestamp(f.stat().st_mtime + 60, datetime.timezone.utc)
    manifest = {"ch_a": {"sha": "A" * 40, "ts": later.isoformat().replace("+00:00", "Z")}}
    assert S.units_needing_stamp(content, manifest) == []


def test_unit_rerendered_after_its_stamp_is_restamped(tmp_path):
    content = tmp_path / "content"
    content.mkdir()
    f = content / "ch_a.html"
    f.write_text("x")
    import datetime
    earlier = datetime.datetime.fromtimestamp(f.stat().st_mtime - 60, datetime.timezone.utc)
    manifest = {"ch_a": {"sha": "A" * 40, "ts": earlier.isoformat().replace("+00:00", "Z")}}
    assert S.units_needing_stamp(content, manifest) == ["ch_a"]


def test_ignores_non_html_and_manifest_files(tmp_path):
    content = tmp_path / "content"
    content.mkdir()
    (content / "ch_a.html").write_text("x")
    (content / "ch_a.srcmap.json").write_text("{}")
    (content / "counts.json").write_text("{}")
    (content / "built.json").write_text("{}")
    assert S.units_needing_stamp(content, {}) == ["ch_a"]


# A unit whose HTML predates the source HEAD commit was NOT built from HEAD — stamping it would
# record provenance it never had. (Real case: 13 units rendered 18:22 vs a HEAD committed 18:35.)
def test_units_rendered_before_head_are_held_back(tmp_path):
    import os
    content = tmp_path / "content"
    content.mkdir()
    old = content / "ch_old.html"; old.write_text("x")
    new = content / "ch_new.html"; new.write_text("x")
    head_epoch = old.stat().st_mtime + 10           # HEAD committed AFTER ch_old was rendered
    os.utime(new, (head_epoch + 10, head_epoch + 10))   # ch_new rendered after HEAD
    fresh, stale = S.partition_units(content, {}, head_epoch)
    assert fresh == ["ch_new"]
    assert stale == ["ch_old"]


def test_no_head_date_stamps_everything(tmp_path):
    content = tmp_path / "content"
    content.mkdir()
    (content / "ch_a.html").write_text("x")
    fresh, stale = S.partition_units(content, {}, None)
    assert fresh == ["ch_a"] and stale == []


def test_head_commit_epoch_reads_the_checkout(tmp_path):
    import subprocess
    repo = tmp_path / "src"; repo.mkdir()
    run = lambda *a: subprocess.run(a, cwd=repo, check=True, capture_output=True)
    run("git", "init", "-q"); run("git", "config", "user.email", "t@t.t"); run("git", "config", "user.name", "t")
    (repo / "f.tex").write_text("hi"); run("git", "add", "-A"); run("git", "commit", "-qm", "one")
    assert isinstance(S.head_commit_epoch(repo), float)
    assert S.head_commit_epoch(tmp_path / "nope") is None

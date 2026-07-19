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

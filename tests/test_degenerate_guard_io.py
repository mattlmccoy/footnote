"""I/O proof for the degenerate-build guard: build_guarded builds to a temp file via the
(stubbed) renderer and swaps over content/<unit>.html ONLY when the result is sound —
otherwise the last-good html AND its srcmap sidecar are preserved. This reproduces the
2026-07-08 incident (a 253-byte "5" build) and asserts it can no longer destroy content.

Run: python3 -m pytest tests/test_degenerate_guard_io.py
"""
import os
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_render as CR  # noqa: E402


def _stub(path, body_shell):
    path.write_text("#!/usr/bin/env bash\n" + body_shell + "\n")
    path.chmod(0o755)
    return path


def test_degenerate_build_keeps_lastgood(tmp_path, monkeypatch):
    out = tmp_path / "content" / "ch1.html"
    out.parent.mkdir(parents=True)
    good = "<h1>Chapter 1</h1>" + "<p>real paragraph</p>" * 400
    out.write_text(good, encoding="utf-8")
    (out.parent / "ch1.srcmap.json").write_text('{"paragraphs":[1,2,3]}', encoding="utf-8")
    # renderer exits 0 but emits the incident's 253-byte "5" stub
    _stub(tmp_path / "stub.sh", 'printf "5%.0s" {1..253} > "$2"')
    monkeypatch.setattr(CR, "CHAPTER_HTML", tmp_path / "stub.sh")

    published = CR.build_guarded("ch1", str(out), dict(os.environ), str(tmp_path))

    assert published is False
    assert out.read_text(encoding="utf-8") == good                    # html preserved
    assert (out.parent / "ch1.srcmap.json").read_text() == '{"paragraphs":[1,2,3]}'  # srcmap preserved


def test_failed_build_keeps_lastgood(tmp_path, monkeypatch):
    out = tmp_path / "content" / "ch1.html"
    out.parent.mkdir(parents=True)
    good = "<h1>keep me</h1>" + "<p>x</p>" * 100
    out.write_text(good, encoding="utf-8")
    _stub(tmp_path / "stub.sh", "exit 3")
    monkeypatch.setattr(CR, "CHAPTER_HTML", tmp_path / "stub.sh")

    published = CR.build_guarded("ch1", str(out), dict(os.environ), str(tmp_path))

    assert published is False
    assert out.read_text(encoding="utf-8") == good


def test_good_build_publishes_and_swaps_srcmap(tmp_path, monkeypatch):
    out = tmp_path / "content" / "ch1.html"
    out.parent.mkdir(parents=True)
    out.write_text("<h1>old</h1>" + "<p>old</p>" * 60, encoding="utf-8")
    (out.parent / "ch1.srcmap.json").write_text('{"paragraphs":[0]}', encoding="utf-8")
    _stub(tmp_path / "stub.sh",
          'printf "<h1>New Chapter</h1>" > "$2"; printf "<p>fresh</p>%.0s" {1..300} >> "$2"; '
          'printf "{\\"paragraphs\\":[9,9,9]}" > "${2%.html}.srcmap.json"')
    monkeypatch.setattr(CR, "CHAPTER_HTML", tmp_path / "stub.sh")

    published = CR.build_guarded("ch1", str(out), dict(os.environ), str(tmp_path))

    assert published is True
    assert "New Chapter" in out.read_text(encoding="utf-8")
    assert (out.parent / "ch1.srcmap.json").read_text() == '{"paragraphs":[9,9,9]}'   # sidecar updated


def test_first_build_no_lastgood_publishes_when_sound(tmp_path, monkeypatch):
    out = tmp_path / "content" / "ch1.html"   # no prior file
    _stub(tmp_path / "stub.sh",
          'printf "<h1>Intro</h1>" > "$2"; printf "<p>content</p>%.0s" {1..200} >> "$2"')
    monkeypatch.setattr(CR, "CHAPTER_HTML", tmp_path / "stub.sh")

    published = CR.build_guarded("ch1", str(out), dict(os.environ), str(tmp_path))

    assert published is True
    assert out.exists() and "Intro" in out.read_text(encoding="utf-8")

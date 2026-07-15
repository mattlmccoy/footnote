import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))
import ci_review_common as C  # noqa: E402


def test_finding_to_comment_marks_claude_review():
    finding = {"anchor": {"quote": "foo", "section": "1"}, "body": "unclear", "tag": "clarity"}
    c = C.finding_to_comment(finding, cid="c_x")
    assert c["id"] == "c_x"
    assert c["author"] == "claude"
    assert c["source"] == "review"
    assert c["anchor"]["quote"] == "foo"
    assert c["body"] == "unclear"
    assert c["tag"] == "clarity"
    assert "staged_edit" not in c          # the edit is drafted by a later pass, not here
    assert c["status"] == "open"


def test_finding_to_comment_accepts_flat_quote_and_defaults_tag():
    c = C.finding_to_comment({"quote": "bar", "body": "b"}, cid="c_y")
    assert c["anchor"]["quote"] == "bar"
    assert c["tag"] == "wording"

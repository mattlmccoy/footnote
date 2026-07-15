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


def test_agent_findings_as_review_makes_claude_comments_and_followup_job():
    job = {"chapter": "ch1", "agents": ["copyeditor", "critic"]}
    outputs = {"copyeditor": [{"quote": "a", "body": "x", "tag": "clarity"}],
               "critic": [{"quote": "b", "body": "y"}]}
    comments, followup = C.agent_findings_as_review(job, outputs, ts="T", idgen=lambda k: f"c_{k}")
    assert [c["author"] for c in comments] == ["claude", "claude"]
    assert all(c["source"] == "review" for c in comments)
    assert [c["id"] for c in comments] == ["c_0", "c_1"]
    assert followup["type"] == "apply-edits"
    assert followup["chapter"] == "ch1"
    assert followup["comment_ids"] == ["c_0", "c_1"]
    assert followup["status"] == "queued"


def test_agent_findings_as_review_caps_total_and_handles_empty():
    job = {"chapter": "ch1", "agents": ["a"]}
    outputs = {"a": [{"quote": str(i)} for i in range(10)]}
    comments, _ = C.agent_findings_as_review(job, outputs, ts="T", idgen=lambda k: f"c_{k}", cap_total=3)
    assert len(comments) == 3
    c2, f2 = C.agent_findings_as_review({"agents": ["a"]}, {"a": []}, ts="T", idgen=lambda k: k)
    assert c2 == [] and f2 is None

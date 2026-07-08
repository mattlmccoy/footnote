"""Local/Cloud hard gate (P0): a project processes reviews in exactly ONE mode. The marker
<prefix>mode.json ({"processingMode":"local"|"cloud"}) is read by the CI without app state.
Default is LOCAL — and crucially a MISSING/malformed marker resolves to local, so the cloud
apply engine is inert everywhere until a project explicitly opts into cloud (the 2026-07-08
collision was both routes live at once). Pure resolver unit-tested here.

Run: python3 -m pytest tests/test_processing_mode.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


def test_missing_marker_defaults_local():
    assert R.resolve_processing_mode(None) == "local"


def test_explicit_cloud():
    assert R.resolve_processing_mode({"processingMode": "cloud"}) == "cloud"


def test_explicit_local():
    assert R.resolve_processing_mode({"processingMode": "local"}) == "local"


def test_cloud_is_case_insensitive():
    assert R.resolve_processing_mode({"processingMode": "Cloud"}) == "cloud"


def test_malformed_marker_defaults_local():
    assert R.resolve_processing_mode({}) == "local"
    assert R.resolve_processing_mode({"processingMode": "banana"}) == "local"
    assert R.resolve_processing_mode("cloud") == "local"        # not a dict
    assert R.resolve_processing_mode([1, 2, 3]) == "local"


def test_cloud_enabled_is_true_only_for_cloud():
    assert R.cloud_enabled_marker({"processingMode": "cloud"}) is True
    assert R.cloud_enabled_marker(None) is False
    assert R.cloud_enabled_marker({"processingMode": "local"}) is False

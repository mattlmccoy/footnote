#!/usr/bin/env python3
"""Every email built through email_shell must carry the Footnote brand, and must never ship a
broken image.

The logo URL is derived per-adopter from PORTAL_BASE (ci_notify_common.BRAND_LOGO) so it isn't
tied to one instance; an adopter without a portal configured has no hosted logo URL. In that
case the header must fall back to the wordmark text alone — NOT emit an empty <img src="">,
which renders as a broken-image icon in mail clients. When a logo URL IS configured, the header
shows it as an <img> with alt text (the images-off fallback). The wordmark is always present.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ci_notify_common as C


def test_wordmark_always_present():
    """The brand is never invisible: the wordmark renders regardless of logo configuration."""
    html = C.email_shell("A title", "a subtitle", "<tr><td>body</td></tr>")
    assert ">Footnote<" in html, "Footnote wordmark missing"


def test_no_empty_image_when_no_logo_configured(monkeypatch):
    """No portal/logo configured -> must NOT emit a broken empty <img src="">."""
    monkeypatch.setattr(C, "BRAND_LOGO", "")
    html = C.email_shell("A title", "a subtitle", "<tr><td>body</td></tr>")
    assert 'src=""' not in html, "empty <img src=''> ships a broken-image icon"
    assert ">Footnote<" in html, "wordmark must still carry the brand when the logo is absent"


def test_hosted_logo_and_alt_when_configured(monkeypatch):
    """Portal configured -> the hosted logo renders as an <img> with alt (images-off fallback)."""
    monkeypatch.setattr(C, "BRAND_LOGO", "https://owner.github.io/repo/brand/footnote-mark.png")
    html = C.email_shell("A title", "a subtitle", "<tr><td>body</td></tr>")
    assert "footnote-mark.png" in html, "configured hosted logo missing"
    assert 'alt="Footnote"' in html, "logo needs alt text (images-off fallback)"
    assert 'src=""' not in html


def test_body_content_still_rendered():
    html = C.email_shell("A title", "a subtitle", "<tr><td>UNIQUE_BODY_MARKER</td></tr>")
    assert "UNIQUE_BODY_MARKER" in html, "shell dropped the caller's rows"
    assert "A title" in html, "shell dropped the title"


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))

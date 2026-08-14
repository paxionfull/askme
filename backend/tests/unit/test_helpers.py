from __future__ import annotations

import pytest

from auth.credential_store import mask_cookie
from onboarding.source_skill_writer import validate_slug


def test_mask_cookie_short_value() -> None:
    assert mask_cookie("abc") == "***"


def test_mask_cookie_long_value() -> None:
    cookie = "auth_token=0123456789abcdef; ct0=fedcba9876543210"
    masked = mask_cookie(cookie)
    assert masked.startswith("auth_tok")
    assert masked.endswith("6543210")
    assert "..." in masked


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("reuters", "reuters"),
        ("Reuters_News", "reuters-news"),
        ("  kimi-blog  ", "kimi-blog"),
    ],
)
def test_validate_slug(raw: str, expected: str) -> None:
    assert validate_slug(raw) == expected


def test_validate_slug_rejects_invalid() -> None:
    with pytest.raises(ValueError):
        validate_slug("Bad Slug!")

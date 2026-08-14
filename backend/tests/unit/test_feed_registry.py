from __future__ import annotations

import pytest

from feed.feed_registry import FeedRegistry, UNGROUPED_GROUP_ID, _normalize_platform_account


@pytest.fixture
def registry(tmp_path) -> FeedRegistry:
    return FeedRegistry(path=tmp_path / "feed_registry.json")


def test_hide_and_unhide_feed(registry: FeedRegistry) -> None:
    registry.hide_feed("website:demo")
    assert registry.is_hidden("website:demo")

    registry.unhide_feed("website:demo")
    assert not registry.is_hidden("website:demo")


def test_purge_feed_removes_hidden_and_display_name(registry: FeedRegistry) -> None:
    registry.set_feed_display_name("website:demo", "Demo Source")
    registry.hide_feed("website:demo")

    registry.purge_feed("website:demo")

    assert not registry.is_hidden("website:demo")
    assert registry.display_name_for_feed("website:demo") is None


def test_upsert_platform_account(registry: FeedRegistry) -> None:
    saved = registry.upsert_platform_account(
        {
            "feed_id": "website:x:pytest",
            "platform": "x",
            "account_key": "pytest",
            "display_name": "Pytest X",
            "entry_url": "https://x.com/pytest",
        }
    )
    assert saved["feed_id"] == "website:x:pytest"
    assert registry.get_platform_account("website:x:pytest") is not None
    assert registry.display_name_for_feed("website:x:pytest") == "Pytest X"


def test_normalize_platform_account_rejects_unknown_platform() -> None:
    assert (
        _normalize_platform_account(
            {
                "feed_id": "website:foo:bar",
                "platform": "unknown",
                "account_key": "bar",
            }
        )
        is None
    )


def test_set_layout_dedupes_feed_across_groups(registry: FeedRegistry) -> None:
    groups, order = registry.set_layout(
        [
            {"id": "news", "name": "News", "feed_ids": ["website:a", "website:b"]},
            {"id": "tech", "name": "Tech", "feed_ids": ["website:b", "website:c"]},
        ],
        ["news", "tech"],
    )
    feed_ids = [fid for group in groups for fid in group["feed_ids"]]
    assert feed_ids.count("website:b") == 1
    assert order == ["news", "tech"]


def test_assign_feed_to_group(registry: FeedRegistry) -> None:
    registry.set_layout([{"id": "news", "name": "News", "feed_ids": []}], ["news"])
    registry.assign_feed_to_group("website:demo", "news")
    assert registry.group_id_for_feed("website:demo") == "news"

    registry.assign_feed_to_group("website:demo", UNGROUPED_GROUP_ID)
    assert registry.group_id_for_feed("website:demo") is None

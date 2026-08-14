"""列表项按 article id 建索引，供 sitemap / 大列表源 O(1) 查找。"""

from __future__ import annotations


def norm_article_id(article_id: str) -> str:
    return str(article_id or "").strip().strip("/")


class ListByIdIndex:
    def __init__(self) -> None:
        self._by_id: dict[str, dict] = {}

    def rebuild(self, items: list[dict], *, id_key: str = "id") -> list[dict]:
        index: dict[str, dict] = {}
        for item in items:
            key = norm_article_id(str(item.get(id_key) or ""))
            if key:
                index[key] = item
        self._by_id = index
        return items

    def get(self, article_id: str) -> dict:
        return self._by_id.get(norm_article_id(article_id), {})

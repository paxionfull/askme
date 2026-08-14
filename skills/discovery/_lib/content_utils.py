"""Skill 侧 HTML 正文清洗（无 backend 依赖）。"""

from __future__ import annotations

from bs4 import BeautifulSoup


def clean_html_fragment(html: str) -> str:
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    for node in soup.find_all(style=True):
        style = node.get("style", "")
        cleaned = ";".join(
            part.strip()
            for part in style.split(";")
            if part.strip()
            and not part.strip().lower().startswith("visibility")
            and not part.strip().lower().startswith("opacity:")
        )
        if cleaned:
            node["style"] = cleaned
        else:
            del node["style"]
    if soup.body is None:
        return soup.decode()
    return "".join(str(child) for child in soup.children)

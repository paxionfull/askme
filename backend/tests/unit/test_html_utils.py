from __future__ import annotations

from core.html_utils import extract_article_html, html_to_text


def test_html_to_text_strips_tags() -> None:
    text = html_to_text("<p>Hello <strong>world</strong></p>")
    assert "Hello" in text
    assert "world" in text
    assert "<" not in text


def test_extract_article_html_prefers_js_content() -> None:
    html = """
    <html><body>
      <div id="js_content"><p>正文段落</p></div>
      <footer>页脚</footer>
    </body></html>
    """
    fragment = extract_article_html(html)
    assert "正文段落" in fragment
    assert "页脚" not in fragment

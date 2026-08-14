from bs4 import BeautifulSoup


def extract_article_html(html: str) -> str:
    if not html:
        return ""
    stripped = html.strip()
    if not stripped.startswith("<!") and "js_content" not in stripped:
        return _clean_article_fragment(stripped)

    soup = BeautifulSoup(html, "html.parser")
    for selector in ("#js_content", ".rich_media_content", "#img-content"):
        node = soup.select_one(selector)
        if node and node.get_text(strip=True):
            for tag in node(["script", "style"]):
                tag.decompose()
            return _clean_article_fragment(node.decode_contents())

    body = soup.body
    if body and body.get_text(strip=True):
        for tag in body(["script", "style"]):
            tag.decompose()
        return _clean_article_fragment(body.decode_contents())

    return _clean_article_fragment(stripped)


def _clean_article_fragment(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
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
    return soup.decode() if soup.body is None else "".join(str(child) for child in soup.children)


def html_to_text(html: str) -> str:
    if not html:
        return ""
    content_html = extract_article_html(html)
    soup = BeautifulSoup(content_html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)

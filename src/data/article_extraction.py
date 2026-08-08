import html
import logging
import re
from html.parser import HTMLParser

import requests

from src.data.cache import get_cache

logger = logging.getLogger(__name__)


class _ReadableTextParser(HTMLParser):
    """Tiny HTML text extractor used when optional article libraries are absent."""

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self._parts.append(text)

    @property
    def text(self) -> str:
        return " ".join(self._parts)


def extract_article_text(url: str, timeout: int = 8, min_chars: int = 500, max_chars: int = 6000) -> str | None:
    """Fetch and extract article text with a dependency-free fallback parser."""
    if not url:
        return None

    cache = get_cache()
    if cache.has_article_text(url):
        return cache.get_article_text(url)

    try:
        response = requests.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ai-hedge-fund/1.0; +https://github.com/virattt/ai-hedge-fund)",
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=timeout,
        )
        if response.status_code >= 400 or "text/html" not in response.headers.get("content-type", ""):
            cache.set_article_text(url, None)
            return None

        parser = _ReadableTextParser()
        parser.feed(response.text)
        text = html.unescape(parser.text)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < min_chars:
            cache.set_article_text(url, None)
            return None

        extracted = text[:max_chars]
        cache.set_article_text(url, extracted)
        return extracted
    except Exception as exc:
        logger.debug("Failed to extract article text from %s: %s", url, exc)
        cache.set_article_text(url, None)
        return None

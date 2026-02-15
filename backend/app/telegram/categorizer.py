"""Auto-categorization rules for normalized Saved Messages."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from app.telegram.scanner import ScannedMessage

VIDEOS_CATEGORY_SLUG = "videos"
AUDIO_CATEGORY_SLUG = "audio"
LINKS_CATEGORY_SLUG = "links"
REPOSITORIES_CATEGORY_SLUG = "repositories"
IMAGES_CATEGORY_SLUG = "images"
DOCUMENTS_CATEGORY_SLUG = "documents"
TEXT_CATEGORY_SLUG = "text"
OTHER_CATEGORY_SLUG = "other"

_REPOSITORY_DOMAINS = ("github.com", "gitlab.com")
_URL_PATTERN = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
_REPOSITORY_PATTERN = re.compile(r"(^|[^\w])(github\.com|gitlab\.com)([/:]|$)", re.IGNORECASE)


def categorize_scanned_message(message: ScannedMessage) -> str:
    """Return the default category slug for a normalized Saved Message."""

    media_type = (message.media_type or "").strip().lower()
    if "video" in media_type:
        return VIDEOS_CATEGORY_SLUG
    if "audio" in media_type or "voice" in media_type:
        return AUDIO_CATEGORY_SLUG
    if "photo" in media_type or "image" in media_type:
        return IMAGES_CATEGORY_SLUG
    if "document" in media_type:
        return DOCUMENTS_CATEGORY_SLUG

    content = (message.content or "").strip()
    if _contains_repository_reference(content=content, extracted_url=message.url):
        return REPOSITORIES_CATEGORY_SLUG
    if _contains_any_url(content=content, extracted_url=message.url):
        return LINKS_CATEGORY_SLUG
    if content:
        return TEXT_CATEGORY_SLUG

    return OTHER_CATEGORY_SLUG


def _contains_repository_reference(*, content: str, extracted_url: str | None) -> bool:
    if _is_repository_url(extracted_url):
        return True

    if _REPOSITORY_PATTERN.search(content):
        return True

    for url in _URL_PATTERN.findall(content):
        if _is_repository_url(url):
            return True

    return False


def _contains_any_url(*, content: str, extracted_url: str | None) -> bool:
    if extracted_url and extracted_url.strip():
        return True
    return bool(_URL_PATTERN.search(content))


def _is_repository_url(url: str | None) -> bool:
    if not url:
        return False

    normalized_url = url if "://" in url else f"https://{url}"
    parsed = urlparse(normalized_url)
    host = parsed.netloc.split("@")[-1].split(":")[0].lower()
    if not host:
        return False

    return any(host == domain or host.endswith(f".{domain}") for domain in _REPOSITORY_DOMAINS)


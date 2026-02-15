from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.telegram.categorizer import categorize_scanned_message
from app.telegram.scanner import ScannedMessage


def _message(
    *,
    content: str | None = None,
    media_type: str | None = None,
    url: str | None = None,
) -> ScannedMessage:
    return ScannedMessage(
        telegram_id=1,
        content=content,
        media_type=media_type,
        file_name=None,
        file_size=None,
        mime_type=None,
        url=url,
        sender_name=None,
        date=datetime.now(tz=UTC),
        raw_data={"id": 1},
    )


@pytest.mark.parametrize(
    ("media_type", "expected_category"),
    [
        ("video", "videos"),
        ("video_note", "videos"),
        ("audio", "audio"),
        ("voice", "audio"),
        ("photo", "images"),
        ("image/jpeg", "images"),
        ("document", "documents"),
    ],
)
def test_categorize_scanned_message_by_media_type(media_type: str, expected_category: str) -> None:
    categorized = categorize_scanned_message(_message(media_type=media_type))
    assert categorized == expected_category


def test_categorize_scanned_message_prefers_repositories_over_links() -> None:
    categorized = categorize_scanned_message(_message(content="Useful repo: https://github.com/acme/core"))
    assert categorized == "repositories"


def test_categorize_scanned_message_uses_url_field_for_repository_detection() -> None:
    categorized = categorize_scanned_message(_message(content=None, url="https://gitlab.com/acme/core"))
    assert categorized == "repositories"


def test_categorize_scanned_message_supports_repository_reference_without_scheme() -> None:
    categorized = categorize_scanned_message(_message(content="browse github.com/acme/core later"))
    assert categorized == "repositories"


def test_categorize_scanned_message_detects_repository_url_from_parsed_links() -> None:
    categorized = categorize_scanned_message(_message(content="Check https://github.com?tab=stars"))
    assert categorized == "repositories"


def test_categorize_scanned_message_classifies_generic_urls_as_links() -> None:
    categorized = categorize_scanned_message(_message(content="Read https://example.com/article"))
    assert categorized == "links"


def test_categorize_scanned_message_classifies_non_repository_extracted_url_as_link() -> None:
    categorized = categorize_scanned_message(_message(content=None, url="  https://example.com/docs  "))
    assert categorized == "links"


def test_categorize_scanned_message_handles_invalid_repository_host_in_url() -> None:
    categorized = categorize_scanned_message(_message(content=None, url="mailto:dev@example.com"))
    assert categorized == "links"


def test_categorize_scanned_message_handles_empty_url_host_for_repository_check() -> None:
    categorized = categorize_scanned_message(_message(content=None, url="https:///missing-host"))
    assert categorized == "links"


def test_categorize_scanned_message_classifies_plain_text_as_text() -> None:
    categorized = categorize_scanned_message(_message(content="Remember to review this note"))
    assert categorized == "text"


def test_categorize_scanned_message_falls_back_to_other_for_empty_payload() -> None:
    categorized = categorize_scanned_message(_message(content="  "))
    assert categorized == "other"


def test_categorize_scanned_message_prioritizes_media_before_text_rules() -> None:
    categorized = categorize_scanned_message(
        _message(media_type="document", content="https://github.com/acme/core")
    )
    assert categorized == "documents"

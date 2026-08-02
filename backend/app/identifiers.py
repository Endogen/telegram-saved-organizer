"""Shared normalization and bounds for externally supplied identifiers."""

from __future__ import annotations

MAX_DATABASE_INTEGER = 2**31 - 1


def normalize_phone_number(value: str) -> str:
    """Collapse common phone display variants into a stable comparison form."""

    stripped = value.strip()
    digits = "".join(
        character
        for character in stripped
        if character.isascii() and character.isdigit()
    )
    if stripped.startswith("+"):
        return f"+{digits}"
    if digits.startswith("00"):
        return f"+{digits[2:]}"
    return digits or stripped.casefold()

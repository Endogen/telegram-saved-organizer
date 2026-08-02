"""Pydantic schemas for per-user Telegram connection endpoints."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator


class TelegramConnectionState(StrEnum):
    DISCONNECTED = "disconnected"
    CODE_REQUIRED = "code_required"
    PASSWORD_REQUIRED = "password_required"
    CONNECTED = "connected"


class TelegramConnectionRequest(BaseModel):
    """Start Telegram authentication using the server-owned API credentials."""

    phone: str = Field(min_length=3, max_length=64)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("Phone number must contain at least three characters.")
        return normalized


class TelegramVerifyRequest(BaseModel):
    """Complete a Telegram challenge without persisting the supplied secret."""

    code: str | None = Field(default=None, max_length=32)
    password: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def validate_one_credential(self) -> "TelegramVerifyRequest":
        code = (self.code or "").strip()
        password = self.password if self.password not in {None, ""} else None
        if bool(code) == bool(password):
            raise ValueError("Provide exactly one of code or password.")
        self.code = code or None
        self.password = password
        return self


class TelegramConnectionResponse(BaseModel):
    """Durable state of the current user's Telegram connection."""

    state: TelegramConnectionState

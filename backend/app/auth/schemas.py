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
    """Start Telegram authentication using this user's API credentials."""

    api_id: int = Field(gt=0, le=2_147_483_647)
    api_hash: str = Field(min_length=32, max_length=32, pattern=r"^[0-9a-fA-F]{32}$")
    phone: str = Field(min_length=3, max_length=64)

    @field_validator("api_hash", mode="before")
    @classmethod
    def normalize_api_hash(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

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


class TelegramAccountSummary(BaseModel):
    """Non-sensitive Telegram identity details safe to show in the UI."""

    display_name: str | None = None
    phone_masked: str | None = None
    username: str | None = None


class TelegramConnectionResponse(BaseModel):
    """Durable state and safely displayable identity for the connection."""

    state: TelegramConnectionState
    phone_masked: str | None = None
    account: TelegramAccountSummary | None = None

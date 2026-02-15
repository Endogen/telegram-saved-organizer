"""Pydantic schemas for Telegram auth endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.auth.service import AuthStatus


class ConnectRequest(BaseModel):
    """Payload for starting Telegram auth with SMS/Telegram code delivery."""

    api_id: int = Field(gt=0)
    api_hash: str = Field(min_length=1)
    phone: str = Field(min_length=3)


class VerifyRequest(BaseModel):
    """Payload for verifying a Telegram auth challenge."""

    code: str | None = None
    password: str | None = None

    @model_validator(mode="after")
    def validate_code_or_password(self) -> "VerifyRequest":
        code = (self.code or "").strip()
        password = (self.password or "").strip()
        if not code and not password:
            raise ValueError("Either code or password must be provided.")
        self.code = code or None
        self.password = password or None
        return self


class AuthStatusResponse(BaseModel):
    """Current Telegram auth status."""

    connected: bool
    authorized: bool
    has_session: bool
    verification_required: bool
    password_required: bool

    @classmethod
    def from_status(cls, status: AuthStatus) -> "AuthStatusResponse":
        return cls(
            connected=status.connected,
            authorized=status.authorized,
            has_session=status.has_session,
            verification_required=status.verification_required,
            password_required=status.password_required,
        )

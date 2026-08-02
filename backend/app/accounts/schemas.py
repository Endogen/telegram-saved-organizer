"""Pydantic schemas for account and session endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


def _validate_password(value: str) -> str:
    byte_length = len(value.encode("utf-8"))
    if byte_length < 12:
        raise ValueError("Password must contain at least 12 bytes.")
    if byte_length > 128:
        raise ValueError("Password must not exceed 128 bytes.")
    return value


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    created_at: datetime


class RegistrationRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    password: str

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name must not be empty.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=512)


class SessionStatusResponse(BaseModel):
    authenticated: bool
    user: AccountResponse | None = None


class AccountUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name must not be empty.")
        return normalized

    @model_validator(mode="after")
    def require_change(self) -> AccountUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("At least one account field must be provided.")
        return self


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=512)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _validate_password(value)

    @model_validator(mode="after")
    def require_different_password(self) -> PasswordChangeRequest:
        if self.current_password == self.new_password:
            raise ValueError("New password must be different from the current password.")
        return self


class AccountDeleteRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)
    confirmation: str

    @field_validator("confirmation")
    @classmethod
    def validate_confirmation(cls, value: str) -> str:
        if value != "DELETE":
            raise ValueError("Type DELETE to confirm account deletion.")
        return value


class ActiveSessionResponse(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool
    user_agent: str | None
    ip_address: str | None

"""Password, opaque-token, and authenticated-encryption primitives."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

_PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
)
_PASSWORD_WORKERS = asyncio.Semaphore(4)
_DUMMY_PASSWORD_HASH = _PASSWORD_HASHER.hash(secrets.token_urlsafe(32))
_TOKEN_VERSION = "v1"
_NONCE_SIZE = 12


class SecretDecryptionError(ValueError):
    """Raised when encrypted application data fails authentication."""


def random_token() -> str:
    """Return a URL-safe 256-bit opaque token."""

    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a high-entropy token for server-side lookup."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def hash_password(password: str) -> str:
    async with _PASSWORD_WORKERS:
        return await asyncio.to_thread(_PASSWORD_HASHER.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Verify a password with indistinguishable work for unknown accounts."""

    candidate_hash = password_hash or _DUMMY_PASSWORD_HASH
    async with _PASSWORD_WORKERS:
        try:
            return await asyncio.to_thread(_PASSWORD_HASHER.verify, candidate_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False


def password_needs_rehash(password_hash: str) -> bool:
    return _PASSWORD_HASHER.check_needs_rehash(password_hash)


def _encryption_key() -> bytes:
    return hashlib.sha256(
        f"telegram-saved-organizer:encryption:v1:{settings.master_key}".encode("utf-8")
    ).digest()


def encrypt_secret(value: str, *, context: str) -> str:
    """Encrypt a secret with AES-GCM and bind it to its tenant/purpose context."""

    nonce = os.urandom(_NONCE_SIZE)
    ciphertext = AESGCM(_encryption_key()).encrypt(
        nonce,
        value.encode("utf-8"),
        context.encode("utf-8"),
    )
    return f"{_TOKEN_VERSION}.{base64.urlsafe_b64encode(nonce + ciphertext).decode('ascii')}"


def decrypt_secret(value: str, *, context: str) -> str:
    """Decrypt and authenticate a context-bound secret."""

    try:
        version, encoded = value.split(".", maxsplit=1)
        if version != _TOKEN_VERSION:
            raise ValueError("unsupported version")
        payload = base64.urlsafe_b64decode(encoded.encode("ascii"))
        nonce, ciphertext = payload[:_NONCE_SIZE], payload[_NONCE_SIZE:]
        if len(nonce) != _NONCE_SIZE or not ciphertext:
            raise ValueError("invalid payload")
        plaintext = AESGCM(_encryption_key()).decrypt(
            nonce,
            ciphertext,
            context.encode("utf-8"),
        )
    except Exception as exc:
        raise SecretDecryptionError("Encrypted secret could not be decrypted.") from exc
    return plaintext.decode("utf-8")

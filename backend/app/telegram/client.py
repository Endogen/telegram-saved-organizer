"""Telethon client wrapper with session lifecycle management."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from telethon import TelegramClient

from app.config import settings


class TelegramClientCredentialsMismatchError(ValueError):
    """Raised when trying to reuse a client with different API credentials."""


class TelethonClientProtocol(Protocol):
    """Subset of the Telethon client API used by the manager."""

    def is_connected(self) -> bool: ...

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...


class TelegramClientManager:
    """Manages a cached Telethon client and its local session files."""

    def __init__(
        self,
        *,
        session_path: Path,
        client_factory: type[TelegramClient] = TelegramClient,
    ) -> None:
        self.session_path = session_path
        self._client_factory = client_factory
        self._client: TelethonClientProtocol | None = None
        self._api_id: int | None = None
        self._api_hash: str | None = None
        self._lock = asyncio.Lock()

    async def connect(self, *, api_id: int, api_hash: str) -> TelethonClientProtocol:
        """Return a connected client for the provided credentials."""

        async with self._lock:
            self._ensure_credentials_compatible(api_id=api_id, api_hash=api_hash)

            client = self._client
            if client is None:
                client = self._client_factory(str(self.session_path), api_id, api_hash)
                self._client = client
                self._api_id = api_id
                self._api_hash = api_hash

            if client.is_connected():
                return client

            try:
                await client.connect()
            except Exception:
                if self._client is client:
                    self._client = None
                    self._api_id = None
                    self._api_hash = None
                with suppress(Exception):
                    await client.disconnect()
                raise

            return client

    async def disconnect(self) -> None:
        """Disconnect and clear the cached client instance."""

        async with self._lock:
            client = self._client
            self._client = None
            self._api_id = None
            self._api_hash = None

        if client is None:
            return

        with suppress(Exception):
            await client.disconnect()

    async def reset_session(self) -> None:
        """Disconnect and remove local Telethon session artifacts."""

        await self.disconnect()
        for file_path in self._session_artifacts():
            with suppress(FileNotFoundError):
                file_path.unlink()

    def is_connected(self) -> bool:
        """Return whether the cached client is connected."""

        return bool(self._client and self._client.is_connected())

    def has_session(self) -> bool:
        """Return whether a local session file currently exists."""

        return any(path.exists() for path in self._session_artifacts())

    def _ensure_credentials_compatible(self, *, api_id: int, api_hash: str) -> None:
        if self._client is None:
            return
        if api_id == self._api_id and api_hash == self._api_hash:
            return
        raise TelegramClientCredentialsMismatchError(
            "Telegram client is already initialized with different API credentials. "
            "Disconnect first before switching accounts."
        )

    def _session_artifacts(self) -> tuple[Path, ...]:
        base_path = self.session_path
        if base_path.suffix:
            return (base_path, Path(f"{base_path}-journal"))
        return (Path(f"{base_path}.session"), Path(f"{base_path}.session-journal"))


telegram_client_manager = TelegramClientManager(session_path=settings.data_dir / "telegram")

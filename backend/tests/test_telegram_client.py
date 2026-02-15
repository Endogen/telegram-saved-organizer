from __future__ import annotations

from pathlib import Path

import pytest

from app.telegram.client import TelegramClientCredentialsMismatchError, TelegramClientManager


class _FakeTelethonClient:
    def __init__(self, *, fail_connect: bool = False) -> None:
        self.fail_connect = fail_connect
        self.connect_calls = 0
        self.disconnect_calls = 0
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    async def connect(self) -> None:
        self.connect_calls += 1
        if self.fail_connect:
            raise RuntimeError("connect failed")
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnect_calls += 1
        self.connected = False


class _FakeClientFactory:
    def __init__(self, *, fail_connect: bool = False) -> None:
        self.fail_connect = fail_connect
        self.calls: list[tuple[str, int, str]] = []
        self.created_clients: list[_FakeTelethonClient] = []

    def __call__(self, session_path: str, api_id: int, api_hash: str) -> _FakeTelethonClient:
        self.calls.append((session_path, api_id, api_hash))
        client = _FakeTelethonClient(fail_connect=self.fail_connect)
        self.created_clients.append(client)
        return client


@pytest.mark.asyncio
async def test_connect_creates_and_reuses_cached_client(tmp_path: Path) -> None:
    factory = _FakeClientFactory()
    session_path = tmp_path / "telegram"
    manager = TelegramClientManager(session_path=session_path, client_factory=factory)

    first_client = await manager.connect(api_id=1001, api_hash="hash")
    second_client = await manager.connect(api_id=1001, api_hash="hash")

    assert first_client is second_client
    assert first_client.connect_calls == 1
    assert manager.is_connected() is True
    assert factory.calls == [(str(session_path), 1001, "hash")]


@pytest.mark.asyncio
async def test_connect_rejects_credential_switch_without_disconnect(tmp_path: Path) -> None:
    factory = _FakeClientFactory()
    manager = TelegramClientManager(session_path=tmp_path / "telegram", client_factory=factory)

    await manager.connect(api_id=1001, api_hash="hash")

    with pytest.raises(TelegramClientCredentialsMismatchError):
        await manager.connect(api_id=2002, api_hash="other-hash")

    assert len(factory.calls) == 1


@pytest.mark.asyncio
async def test_disconnect_clears_cached_client_and_allows_reconnect(tmp_path: Path) -> None:
    factory = _FakeClientFactory()
    manager = TelegramClientManager(session_path=tmp_path / "telegram", client_factory=factory)

    first_client = await manager.connect(api_id=1001, api_hash="hash")
    await manager.disconnect()
    second_client = await manager.connect(api_id=1001, api_hash="hash")

    assert first_client is not second_client
    assert first_client.disconnect_calls == 1
    assert second_client.connect_calls == 1
    assert len(factory.calls) == 2


@pytest.mark.asyncio
async def test_reset_session_removes_session_artifacts(tmp_path: Path) -> None:
    session_path = tmp_path / "telegram"
    session_file = tmp_path / "telegram.session"
    session_journal = tmp_path / "telegram.session-journal"
    session_file.write_text("session", encoding="utf-8")
    session_journal.write_text("journal", encoding="utf-8")

    manager = TelegramClientManager(session_path=session_path, client_factory=_FakeClientFactory())

    assert manager.has_session() is True

    await manager.reset_session()

    assert manager.has_session() is False
    assert not session_file.exists()
    assert not session_journal.exists()


@pytest.mark.asyncio
async def test_connect_failure_does_not_cache_failed_client(tmp_path: Path) -> None:
    factory = _FakeClientFactory(fail_connect=True)
    manager = TelegramClientManager(session_path=tmp_path / "telegram", client_factory=factory)

    with pytest.raises(RuntimeError, match="connect failed"):
        await manager.connect(api_id=1001, api_hash="hash")
    with pytest.raises(RuntimeError, match="connect failed"):
        await manager.connect(api_id=1001, api_hash="hash")

    assert len(factory.calls) == 2
    assert factory.created_clients[0].disconnect_calls == 1
    assert factory.created_clients[1].disconnect_calls == 1


@pytest.mark.asyncio
async def test_get_connected_client_returns_none_when_disconnected(tmp_path: Path) -> None:
    manager = TelegramClientManager(session_path=tmp_path / "telegram", client_factory=_FakeClientFactory())

    assert manager.get_connected_client() is None

    connected_client = await manager.connect(api_id=1001, api_hash="hash")
    assert manager.get_connected_client() is connected_client
    connected_client.connected = False

    assert manager.get_connected_client() is None


@pytest.mark.asyncio
async def test_reset_session_supports_explicit_session_suffix_path(tmp_path: Path) -> None:
    session_path = tmp_path / "telegram.session"
    session_journal = tmp_path / "telegram.session-journal"
    session_path.write_text("session", encoding="utf-8")
    session_journal.write_text("journal", encoding="utf-8")

    manager = TelegramClientManager(session_path=session_path, client_factory=_FakeClientFactory())

    assert manager.has_session() is True

    await manager.reset_session()

    assert manager.has_session() is False
    assert not session_path.exists()
    assert not session_journal.exists()

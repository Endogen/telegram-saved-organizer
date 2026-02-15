"""Telegram integration package."""

from app.telegram.client import (
    TelegramClientCredentialsMismatchError,
    TelegramClientManager,
    telegram_client_manager,
)
from app.telegram.scanner import (
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    ScannedMessage,
    SavedMessagesScanner,
)

__all__ = [
    "TelegramClientCredentialsMismatchError",
    "TelegramClientManager",
    "ScanAlreadyRunningError",
    "ScanPage",
    "ScanProgress",
    "ScannedMessage",
    "SavedMessagesScanner",
    "telegram_client_manager",
]

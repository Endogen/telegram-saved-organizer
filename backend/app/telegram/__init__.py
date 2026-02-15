"""Telegram integration package."""

from app.telegram.client import (
    TelegramClientCredentialsMismatchError,
    TelegramClientManager,
    telegram_client_manager,
)
from app.telegram.categorizer import categorize_scanned_message
from app.telegram.scanner import (
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    ScannedMessage,
    SavedMessagesScanner,
)
from app.telegram.service import TelegramClientNotConnectedError, TelegramScanService

__all__ = [
    "TelegramClientCredentialsMismatchError",
    "TelegramClientManager",
    "categorize_scanned_message",
    "ScanAlreadyRunningError",
    "ScanPage",
    "ScanProgress",
    "ScannedMessage",
    "SavedMessagesScanner",
    "TelegramClientNotConnectedError",
    "TelegramScanService",
    "telegram_client_manager",
]

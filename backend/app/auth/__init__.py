"""Authentication package for Telegram connection endpoints."""

from app.auth.router import get_auth_service, router
from app.auth.service import TelegramAuthService

__all__ = ["TelegramAuthService", "get_auth_service", "router"]

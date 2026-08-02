import type {
  ConnectTelegramPayload,
  TelegramAuthStatus,
  VerifyTelegramPayload,
} from "@/types/auth";
import { requestJson } from "@/api/client";

const AUTH_BASE_PATH = "/api/auth";

async function requestAuthStatus(path: string, init?: RequestInit): Promise<TelegramAuthStatus> {
  return requestJson<TelegramAuthStatus>(`${AUTH_BASE_PATH}${path}`, init, {
    fallbackMessage: "Telegram auth request failed.",
  });
}

export async function fetchTelegramAuthStatus(): Promise<TelegramAuthStatus> {
  return requestAuthStatus("/status");
}

export async function connectTelegram(payload: ConnectTelegramPayload): Promise<TelegramAuthStatus> {
  return requestAuthStatus("/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function verifyTelegram(payload: VerifyTelegramPayload): Promise<TelegramAuthStatus> {
  const body: VerifyTelegramPayload = {};
  if (payload.code && payload.code.trim().length > 0) {
    body.code = payload.code.trim();
  }
  if (payload.password && payload.password.trim().length > 0) {
    body.password = payload.password.trim();
  }

  return requestAuthStatus("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function disconnectTelegram(): Promise<TelegramAuthStatus> {
  return requestAuthStatus("/disconnect", { method: "POST" });
}

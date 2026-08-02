import type {
  ConnectTelegramPayload,
  TelegramConnection,
  VerifyTelegramPayload,
} from "@/types/auth";
import { requestJson } from "@/api/client";

const CONNECTION_PATH = "/api/telegram/connection";

async function requestConnection(path = "", init?: RequestInit): Promise<TelegramConnection> {
  return requestJson<TelegramConnection>(`${CONNECTION_PATH}${path}`, init, {
    fallbackMessage: "Telegram connection request failed.",
  });
}

export async function fetchTelegramConnection(): Promise<TelegramConnection> {
  return requestConnection();
}

export async function connectTelegram(payload: ConnectTelegramPayload): Promise<TelegramConnection> {
  return requestConnection("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_id: payload.apiId,
      api_hash: payload.apiHash,
      phone: payload.phone,
    }),
  });
}

export async function verifyTelegram(payload: VerifyTelegramPayload): Promise<TelegramConnection> {
  const body: VerifyTelegramPayload = "password" in payload
    ? { password: payload.password }
    : { code: payload.code.trim() };

  return requestConnection("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function disconnectTelegram(): Promise<TelegramConnection> {
  return requestConnection("", { method: "DELETE" });
}

/** @deprecated Use fetchTelegramConnection. */
export const fetchTelegramAuthStatus = fetchTelegramConnection;

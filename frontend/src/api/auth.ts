import type {
  ConnectTelegramPayload,
  TelegramAuthStatus,
  VerifyTelegramPayload,
} from "@/types/auth";

const AUTH_BASE_PATH = "/api/auth";

type ApiErrorPayload = {
  detail?: unknown;
};

function toErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}

async function requestAuthStatus(path: string, init?: RequestInit): Promise<TelegramAuthStatus> {
  const response = await fetch(`${AUTH_BASE_PATH}${path}`, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(toErrorMessage(payload) ?? "Telegram auth request failed.");
  }

  return payload as TelegramAuthStatus;
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

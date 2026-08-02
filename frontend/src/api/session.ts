import { requestJson } from "@/api/client";
import type { ActiveSession, LoginPayload, SessionStatus } from "@/types/account";

const SESSION_ENDPOINT = "/api/session";
const ACTIVE_SESSIONS_ENDPOINT = "/api/account/sessions";

export async function fetchSession(signal?: AbortSignal): Promise<SessionStatus> {
  return requestJson<SessionStatus>(
    SESSION_ENDPOINT,
    { signal },
    {
      fallbackMessage: "Could not check your session.",
      notifyUnauthorized: false,
    },
  );
}

export async function createSession(payload: LoginPayload): Promise<SessionStatus> {
  return requestJson<SessionStatus>(
    SESSION_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      fallbackMessage: "Could not sign in.",
      notifyUnauthorized: false,
    },
  );
}

export async function deleteSession(): Promise<void> {
  await requestJson<void>(
    SESSION_ENDPOINT,
    { method: "DELETE" },
    { notifyUnauthorized: false },
  );
}

export async function fetchActiveSessions(signal?: AbortSignal): Promise<ActiveSession[]> {
  return requestJson<ActiveSession[]>(ACTIVE_SESSIONS_ENDPOINT, { signal }, {
    fallbackMessage: "Could not load active sessions.",
  });
}

export async function revokeSession(id: string): Promise<void> {
  await requestJson<void>(`${ACTIVE_SESSIONS_ENDPOINT}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, {
    fallbackMessage: "Could not revoke the session.",
  });
}

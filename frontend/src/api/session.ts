import { requestJson } from "@/api/client";

export type ApiSessionStatus = {
  authenticated: boolean;
};

const SESSION_ENDPOINT = "/api/session";

export async function fetchApiSession(signal?: AbortSignal): Promise<ApiSessionStatus> {
  return requestJson<ApiSessionStatus>(
    SESSION_ENDPOINT,
    { signal },
    {
      fallbackMessage: "Could not reach the local API.",
      notifyUnauthorized: false,
    },
  );
}

export async function unlockApiSession(token: string): Promise<ApiSessionStatus> {
  return requestJson<ApiSessionStatus>(
    SESSION_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
    {
      fallbackMessage: "The API token was not accepted.",
      notifyUnauthorized: false,
    },
  );
}

export async function lockApiSession(): Promise<ApiSessionStatus> {
  return requestJson<ApiSessionStatus>(
    SESSION_ENDPOINT,
    { method: "DELETE" },
    { notifyUnauthorized: false },
  );
}

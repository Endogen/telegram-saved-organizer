import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  deleteSession,
  fetchActiveSessions,
  fetchSession,
  revokeSession,
} from "@/api/session";

function response(payload: unknown): Response {
  return { ok: true, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

describe("session api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("checks the current session without publishing an expected anonymous 401", async () => {
    fetchMock.mockResolvedValue(response({ authenticated: false, user: null }));

    await expect(fetchSession()).resolves.toEqual({ authenticated: false, user: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("preserves the password when creating a session", async () => {
    const user = { id: "u1", email: "ada@example.com", display_name: "Ada", created_at: "2026-01-01" };
    fetchMock.mockResolvedValue(response({ authenticated: true, user }));

    await createSession({ email: "ada@example.com", password: "  exact password  " });

    expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "  exact password  " }),
    }));
  });

  it("deletes the current session", async () => {
    fetchMock.mockResolvedValue(response(null));
    await deleteSession();
    expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" }));
  });

  it("lists and revokes account sessions", async () => {
    fetchMock.mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(null));
    await expect(fetchActiveSessions()).resolves.toEqual([]);
    await revokeSession("session/one");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/account/sessions/session%2Fone", expect.objectContaining({ method: "DELETE" }));
  });
});

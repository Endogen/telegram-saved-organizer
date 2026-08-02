import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_UNAUTHORIZED_EVENT, ApiRequestError, requestJson } from "@/api/client";

function response(payload: unknown, options: { ok: boolean; status: number }): Response {
  return {
    ok: options.ok,
    status: options.status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe("shared API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    document.cookie = "__Host-tso_csrf=; Max-Age=0; Secure; path=/";
    document.cookie = "tso_csrf=; Max-Age=0; path=/";
    vi.unstubAllGlobals();
  });

  it("includes same-origin credentials on every request", async () => {
    fetchMock.mockResolvedValue(response({ ok: true }, { ok: true, status: 200 }));

    await expect(requestJson("/api/probe", { method: "POST" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/probe", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("adds the CSRF cookie to unsafe requests without replacing caller headers", async () => {
    document.cookie = "tso_csrf=csrf-token-123; path=/";
    fetchMock.mockResolvedValue(response({ ok: true }, { ok: true, status: 200 }));

    await requestJson("/api/probe", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
    expect(init.credentials).toBe("same-origin");

  });

  it("prefers the production __Host CSRF cookie", async () => {
    document.cookie = "tso_csrf=development-token; path=/";
    document.cookie = "__Host-tso_csrf=production-token; Secure; path=/";
    fetchMock.mockResolvedValue(response({ ok: true }, { ok: true, status: 200 }));

    await requestJson("/api/probe", { method: "DELETE" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("production-token");
  });

  it("does not attach a CSRF header to safe requests", async () => {
    document.cookie = "tso_csrf=csrf-token-123; path=/";
    fetchMock.mockResolvedValue(response({ ok: true }, { ok: true, status: 200 }));

    await requestJson("/api/probe");

    expect(fetchMock).toHaveBeenCalledWith("/api/probe", { credentials: "same-origin" });
  });

  it("returns a structured error and announces an expired session", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, unauthorizedListener);
    fetchMock.mockResolvedValue(
      response({ detail: "api_authentication_required" }, { ok: false, status: 401 }),
    );

    const error = await requestJson("/api/protected").catch((requestError: unknown) => requestError);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 401, detail: "api_authentication_required" });
    expect(unauthorizedListener).toHaveBeenCalledTimes(1);
    expect(unauthorizedListener.mock.calls[0][0]).toMatchObject({
      detail: { path: "/api/protected" },
    });
    window.removeEventListener(API_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("can suppress the global unauthorized event for the unlock endpoint", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, unauthorizedListener);
    fetchMock.mockResolvedValue(response({ detail: "invalid" }, { ok: false, status: 401 }));

    await expect(
      requestJson("/api/session", undefined, { notifyUnauthorized: false }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(unauthorizedListener).not.toHaveBeenCalled();
    window.removeEventListener(API_UNAUTHORIZED_EVENT, unauthorizedListener);
  });
});

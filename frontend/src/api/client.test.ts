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

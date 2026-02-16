import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectTelegram,
  disconnectTelegram,
  fetchTelegramAuthStatus,
  verifyTelegram,
} from "@/api/auth";
import type { TelegramAuthStatus } from "@/types/auth";

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const connectedStatus: TelegramAuthStatus = {
  connected: true,
  authorized: false,
  has_session: true,
  verification_required: true,
  password_required: false,
};

const authorizedStatus: TelegramAuthStatus = {
  connected: true,
  authorized: true,
  has_session: true,
  verification_required: false,
  password_required: false,
};

const disconnectedStatus: TelegramAuthStatus = {
  connected: false,
  authorized: false,
  has_session: false,
  verification_required: false,
  password_required: false,
};

describe("auth api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches auth status", async () => {
    fetchMock.mockResolvedValue(createResponse(connectedStatus));

    const result = await fetchTelegramAuthStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/status", undefined);
    expect(result).toEqual(connectedStatus);
  });

  it("sends connect request with payload", async () => {
    fetchMock.mockResolvedValue(createResponse(connectedStatus));

    const result = await connectTelegram({
      api_id: 123456,
      api_hash: "abc123",
      phone: "+15550001234",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          api_id: 123456,
          api_hash: "abc123",
          phone: "+15550001234",
        }),
      }),
    );
    expect(result).toEqual(connectedStatus);
  });

  it("sends verify request with code", async () => {
    fetchMock.mockResolvedValue(createResponse(authorizedStatus));

    const result = await verifyTelegram({ code: "  12345  " });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "12345" }),
      }),
    );
    expect(result).toEqual(authorizedStatus);
  });

  it("sends verify request with password", async () => {
    fetchMock.mockResolvedValue(createResponse(authorizedStatus));

    const result = await verifyTelegram({ password: "  secret  " });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "secret" }),
      }),
    );
    expect(result).toEqual(authorizedStatus);
  });

  it("sends verify request with empty fields trimmed away", async () => {
    fetchMock.mockResolvedValue(createResponse(authorizedStatus));

    await verifyTelegram({ code: "   ", password: "" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
  });

  it("sends disconnect request", async () => {
    fetchMock.mockResolvedValue(createResponse(disconnectedStatus));

    const result = await disconnectTelegram();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(disconnectedStatus);
  });

  it("throws on error responses with detail", async () => {
    fetchMock.mockResolvedValue(
      createResponse({ detail: "Invalid phone number." }, false),
    );

    await expect(connectTelegram({ api_id: 1, api_hash: "x", phone: "y" })).rejects.toThrow(
      "Invalid phone number.",
    );
  });

  it("throws fallback message when detail is missing", async () => {
    fetchMock.mockResolvedValue(createResponse({}, false));

    await expect(fetchTelegramAuthStatus()).rejects.toThrow(
      "Telegram auth request failed.",
    );
  });

  it("throws fallback when detail is non-string", async () => {
    fetchMock.mockResolvedValue(createResponse({ detail: 42 }, false));

    await expect(fetchTelegramAuthStatus()).rejects.toThrow(
      "Telegram auth request failed.",
    );
  });

  it("handles null payload for toErrorMessage", async () => {
    fetchMock.mockResolvedValue(createResponse(null, false));

    await expect(fetchTelegramAuthStatus()).rejects.toThrow(
      "Telegram auth request failed.",
    );
  });
});

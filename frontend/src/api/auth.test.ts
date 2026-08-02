import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectTelegram,
  disconnectTelegram,
  fetchTelegramConnection,
  verifyTelegram,
} from "@/api/auth";
import type { TelegramConnection } from "@/types/auth";

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const codeRequired: TelegramConnection = { state: "code_required" };
const connected: TelegramConnection = { state: "connected" };
const disconnected: TelegramConnection = { state: "disconnected" };
const connectionPayload = {
  apiId: 123456,
  apiHash: "0123456789abcdef0123456789abcdef",
  phone: "+155****1234",
};

describe("Telegram connection API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the current connection state", async () => {
    fetchMock.mockResolvedValue(createResponse(codeRequired));

    const result = await fetchTelegramConnection();

    expect(fetchMock).toHaveBeenCalledWith("/api/telegram/connection", { credentials: "same-origin" });
    expect(result).toEqual(codeRequired);
  });

  it("starts a connection with the user's API credentials and phone number", async () => {
    fetchMock.mockResolvedValue(createResponse(codeRequired));

    const result = await connectTelegram(connectionPayload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/telegram/connection",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          api_id: connectionPayload.apiId,
          api_hash: connectionPayload.apiHash,
          phone: connectionPayload.phone,
        }),
      }),
    );
    expect(result).toEqual(codeRequired);
  });

  it("trims and sends a verification code", async () => {
    fetchMock.mockResolvedValue(createResponse(connected));

    const result = await verifyTelegram({ code: "  12345  " });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/telegram/connection/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "12345" }),
      }),
    );
    expect(result).toEqual(connected);
  });

  it("preserves the verification password exactly", async () => {
    fetchMock.mockResolvedValue(createResponse(connected));

    const result = await verifyTelegram({ password: "  secret phrase  " });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/telegram/connection/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "  secret phrase  " }),
      }),
    );
    expect(result).toEqual(connected);
  });

  it("disconnects with DELETE", async () => {
    fetchMock.mockResolvedValue(createResponse(disconnected));

    const result = await disconnectTelegram();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/telegram/connection",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual(disconnected);
  });

  it("surfaces API details and uses the connection fallback", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ detail: "Invalid phone number." }, false));

    await expect(connectTelegram({ ...connectionPayload, phone: "x" })).rejects.toThrow("Invalid phone number.");

    fetchMock.mockResolvedValueOnce(createResponse({}, false));

    await expect(fetchTelegramConnection()).rejects.toThrow("Telegram connection request failed.");
  });
});

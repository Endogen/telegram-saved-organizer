import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchScanStatus, startScan, stopScan, subscribeToScanStatus } from "@/api/scan";
import type { ScanStatus } from "@/types/scan";

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const idleScanStatus: ScanStatus = {
  is_running: false,
  is_complete: false,
  stop_requested: false,
  messages_scanned: 0,
  pages_scanned: 0,
  page_size: 100,
  last_message_id: null,
  started_at: null,
  finished_at: null,
  error: null,
};

const runningScanStatus: ScanStatus = {
  ...idleScanStatus,
  is_running: true,
  messages_scanned: 50,
  pages_scanned: 1,
  started_at: "2026-02-15T10:00:00.000Z",
};

describe("scan api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches scan status", async () => {
    fetchMock.mockResolvedValue(createResponse(idleScanStatus));

    const result = await fetchScanStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/scan/status", undefined);
    expect(result).toEqual(idleScanStatus);
  });

  it("starts a scan with default page size", async () => {
    fetchMock.mockResolvedValue(createResponse(runningScanStatus));

    const result = await startScan();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/start?page_size=100",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(runningScanStatus);
  });

  it("clamps page size to valid range", async () => {
    fetchMock.mockResolvedValue(createResponse(runningScanStatus));

    await startScan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/start?page_size=1",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(createResponse(runningScanStatus));
    await startScan(5000);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/start?page_size=1000",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(createResponse(runningScanStatus));
    await startScan(NaN);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/start?page_size=100",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stops a scan", async () => {
    fetchMock.mockResolvedValue(
      createResponse({ ...runningScanStatus, stop_requested: true }),
    );

    const result = await stopScan();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/stop",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.stop_requested).toBe(true);
  });

  it("throws on error responses with detail", async () => {
    fetchMock.mockResolvedValue(
      createResponse({ detail: "Scan already running." }, false),
    );

    await expect(startScan()).rejects.toThrow("Scan already running.");
  });

  it("throws fallback message when detail is missing", async () => {
    fetchMock.mockResolvedValue(createResponse({}, false));

    await expect(fetchScanStatus()).rejects.toThrow("Scan request failed.");
  });

  it("throws fallback when payload is null", async () => {
    fetchMock.mockResolvedValue(createResponse(null, false));

    await expect(fetchScanStatus()).rejects.toThrow("Scan request failed.");
  });
});

describe("subscribeToScanStatus", () => {
  it("returns early with an error when EventSource is unavailable", () => {
    const originalEventSource = window.EventSource;
    // @ts-expect-error removing EventSource to test fallback
    delete window.EventSource;

    try {
      const onStatus = vi.fn();
      const onError = vi.fn();

      const subscription = subscribeToScanStatus({ onStatus, onError });

      expect(onError).toHaveBeenCalledWith(
        "Live scan updates are not available in this environment.",
      );
      expect(onStatus).not.toHaveBeenCalled();

      subscription.close();
    } finally {
      window.EventSource = originalEventSource;
    }
  });

  it("subscribes to SSE events and dispatches status updates", () => {
    const listeners = new Map<string, EventListener>();

    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(event: string, handler: EventListener) {
        listeners.set(event, handler);
      }
      removeEventListener(event: string, _handler: EventListener) {
        listeners.delete(event);
      }
      close = vi.fn();
    }

    const originalEventSource = window.EventSource;
    // @ts-expect-error mock EventSource
    window.EventSource = MockEventSource;

    try {
      const onStatus = vi.fn();
      const onOpen = vi.fn();
      const onError = vi.fn();

      const subscription = subscribeToScanStatus({ onStatus, onOpen, onError });

      // Fire open event
      const openHandler = listeners.get("open");
      expect(openHandler).toBeDefined();
      openHandler!(new Event("open"));
      expect(onOpen).toHaveBeenCalled();

      // Fire status event
      const statusHandler = listeners.get("status");
      expect(statusHandler).toBeDefined();
      const statusEvent = new MessageEvent("status", {
        data: JSON.stringify(idleScanStatus),
      });
      statusHandler!(statusEvent);
      expect(onStatus).toHaveBeenCalledWith(idleScanStatus);

      // Fire error event
      const errorHandler = listeners.get("error");
      expect(errorHandler).toBeDefined();
      errorHandler!(new Event("error"));
      expect(onError).toHaveBeenCalledWith(
        "Live scan updates disconnected. Falling back to polling.",
      );

      // Fire invalid status event
      onStatus.mockClear();
      onError.mockClear();
      const invalidEvent = new MessageEvent("status", {
        data: "not valid json{",
      });
      statusHandler!(invalidEvent);
      expect(onStatus).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        "Received an invalid live scan status payload.",
      );

      subscription.close();
    } finally {
      window.EventSource = originalEventSource;
    }
  });
});

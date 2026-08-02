import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanStatus } from "@/types/scan";

// Mock the scan API before importing the component
vi.mock("@/api/scan", () => ({
  fetchScanStatus: vi.fn(),
  startScan: vi.fn(),
  stopScan: vi.fn(),
  subscribeToScanStatus: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  notifyCategoriesChanged: vi.fn(),
}));

import { fetchScanStatus, startScan, stopScan, subscribeToScanStatus } from "@/api/scan";
import { ScanProgress } from "@/components/scan/scan-progress";
import { notifyCategoriesChanged } from "@/hooks/use-categories";

const idleScanStatus: ScanStatus = {
  job_id: null,
  state: "idle",
  stop_requested: false,
  messages_scanned: 0,
  pages_scanned: 0,
  page_size: 100,
  max_messages: null,
  max_runtime_seconds: null,
  last_message_id: null,
  started_at: null,
  finished_at: null,
  error: null,
  completion_reason: null,
};

const completeScanStatus: ScanStatus = {
  job_id: "job-a",
  state: "completed",
  stop_requested: false,
  messages_scanned: 150,
  pages_scanned: 3,
  page_size: 100,
  max_messages: 10_000,
  max_runtime_seconds: 3600,
  last_message_id: 5000,
  started_at: "2026-02-15T10:00:00.000Z",
  finished_at: "2026-02-15T10:05:00.000Z",
  error: null,
  completion_reason: "source_exhausted",
};

const errorScanStatus: ScanStatus = {
  ...idleScanStatus,
  error: "Connection timed out.",
};

const originalEventSourceDescriptor = Object.getOwnPropertyDescriptor(window, "EventSource");

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("ScanProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.mocked(subscribeToScanStatus).mockReturnValue({ close: vi.fn() });
    vi.mocked(fetchScanStatus).mockResolvedValue(idleScanStatus);
    vi.mocked(startScan).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "pending",
    });
    vi.mocked(stopScan).mockResolvedValue({
      ...idleScanStatus,
      stop_requested: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEventSourceDescriptor) {
      Object.defineProperty(window, "EventSource", originalEventSourceDescriptor);
    } else {
      Reflect.deleteProperty(window, "EventSource");
    }
  });

  it("shows loading state initially then renders idle status", async () => {
    render(<ScanProgress />);

    expect(screen.getByText("Checking import status...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Ready to import")).toBeInTheDocument();
    });

    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1); // messages/batches checked
    expect(screen.getByText("Import Saved Messages")).toBeInTheDocument();
    expect(screen.getByText("Find new messages in Telegram and add them to your organizer.")).toBeInTheDocument();
    expect(screen.getByText("No active import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan for new messages" })).toBeInTheDocument();
    expect(subscribeToScanStatus).not.toHaveBeenCalled();
  });

  it("renders complete status", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue(completeScanStatus);

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Import complete")).toBeInTheDocument();
    });

    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("All available Saved Messages were imported.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Saved Messages import progress" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("link", { name: "Browse messages" })).toHaveAttribute("href", "/messages");
    await waitFor(() => expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1));
  });

  it("explains when a server quota completes the scan", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...completeScanStatus,
      messages_scanned: 10_000,
      completion_reason: "message_limit_reached",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("This scan reached its message limit of 10000. Scan again to continue.")).toBeInTheDocument();
    });
  });

  it("renders error status", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue(errorScanStatus);

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Import failed")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection timed out.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection timed out.");
  });

  it("handles fetch status failure", async () => {
    vi.mocked(fetchScanStatus).mockRejectedValue(new Error("Network error"));

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("subscribes to live updates only while a scan is active and cleans up", async () => {
    const closeFn = vi.fn();
    vi.mocked(subscribeToScanStatus).mockReturnValue({ close: closeFn });
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });

    const { unmount } = render(<ScanProgress />);

    await waitFor(() => {
      expect(subscribeToScanStatus).toHaveBeenCalled();
    });

    unmount();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("discovers a scan started in another tab before opening live updates", async () => {
    vi.mocked(fetchScanStatus)
      .mockResolvedValueOnce(idleScanStatus)
      .mockResolvedValue({
        ...idleScanStatus,
        job_id: "job-cross-tab",
        state: "running",
        started_at: "2026-02-15T10:00:00.000Z",
      });

    render(<ScanProgress />);
    await screen.findByText("Ready to import");
    expect(subscribeToScanStatus).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    await waitFor(() => expect(subscribeToScanStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Importing Saved Messages")).toBeInTheDocument();
  });

  it("renders running state with stop button enabled", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      messages_scanned: 42,
      pages_scanned: 1,
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Importing Saved Messages")).toBeInTheDocument();
    });

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Scan for new messages" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "Saved Messages import progress" })).not.toHaveAttribute("aria-valuenow");
  });

  it("renders stopping state", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "stopping",
      stop_requested: true,
      messages_scanned: 80,
      pages_scanned: 2,
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Stopping import")).toBeInTheDocument();
    });
  });

  it("starts a scan when start button is clicked", async () => {
    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Ready to import")).toBeInTheDocument();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Scan for new messages" }));

    await waitFor(() => {
      expect(startScan).toHaveBeenCalledWith(100);
    });
  });

  it("stops a scan when stop button is clicked", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(stopScan).toHaveBeenCalled();
    });
  });

  it("handles start scan error", async () => {
    vi.mocked(startScan).mockRejectedValue(new Error("Start failed"));

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Ready to import")).toBeInTheDocument();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Scan for new messages" }));

    await waitFor(() => {
      expect(screen.getByText("Start failed")).toBeInTheDocument();
    });
  });

  it("offers a Telegram connection link when starting disconnected", async () => {
    vi.mocked(startScan).mockRejectedValue(new Error("Connect Telegram before starting a scan."));
    render(<ScanProgress />);
    await screen.findByText("Ready to import");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Scan for new messages" }));

    const link = await screen.findByRole("link", { name: "Connect Telegram" });
    expect(link).toHaveAttribute("href", "/settings/telegram");
  });

  it("starts a staged full-library refresh after explaining its safe replacement behavior", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ScanProgress />);
    await screen.findByText("Ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Refresh full library" }));

    const confirmation = String(confirmSpy.mock.calls[0]?.[0]);
    expect(confirmation).toContain("current library stays available while Telegram is imported");
    expect(confirmation).toContain("Categories and tags on messages that remain are preserved");
    expect(confirmation).toContain("removed only after a complete, successful import");
    expect(confirmation).toContain("stop the import, it fails, or it reaches a limit");
    expect(confirmation).toContain("existing library stays unchanged");

    await waitFor(() => expect(startScan).toHaveBeenCalledWith(100, true));
  });

  it("handles stop scan error", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });
    vi.mocked(stopScan).mockRejectedValue(new Error("Stop failed"));

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByText("Stop failed")).toBeInTheDocument();
    });
  });

  it("refreshes status manually", async () => {
    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Ready to import")).toBeInTheDocument();
    });

    vi.mocked(fetchScanStatus).mockResolvedValue(completeScanStatus);

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Import complete")).toBeInTheDocument();
    });
  });

  it("updates SSE stream state on events", async () => {
    let onStatusCallback: ((status: ScanStatus) => void) | undefined;
    let onErrorCallback: (() => void) | undefined;

    vi.mocked(subscribeToScanStatus).mockImplementation((handlers: any) => {
      onStatusCallback = handlers.onStatus;
      onErrorCallback = handlers.onError;
      return { close: vi.fn() };
    });
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(subscribeToScanStatus).toHaveBeenCalled();
    });

    // Simulate SSE status update
    if (onStatusCallback) {
      onStatusCallback({
        ...idleScanStatus,
        job_id: "job-a",
        state: "running",
        messages_scanned: 25,
        started_at: "2026-02-15T10:00:00.000Z",
      });
    }

    await waitFor(() => {
      expect(screen.getByText("25")).toBeInTheDocument();
    });

    // Simulate SSE error — should fall back to polling
    if (onErrorCallback) {
      onErrorCallback();
    }

    await waitFor(() => {
      expect(screen.getByText("Live updates interrupted — checking automatically")).toBeInTheDocument();
    });
  });

  it("does not let a stale poll overwrite a newer live status", async () => {
    let onStatusCallback: ((status: ScanStatus) => void) | undefined;
    const stalePoll = deferred<ScanStatus>();
    const runningStatus: ScanStatus = {
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      messages_scanned: 25,
      started_at: "2026-02-15T10:00:00.000Z",
    };
    vi.mocked(fetchScanStatus)
      .mockResolvedValueOnce(runningStatus)
      .mockReturnValueOnce(stalePoll.promise);
    vi.mocked(subscribeToScanStatus).mockImplementation((handlers: any) => {
      onStatusCallback = handlers.onStatus;
      return { close: vi.fn() };
    });

    render(<ScanProgress />);
    await screen.findByText("Importing Saved Messages");

    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(fetchScanStatus).toHaveBeenCalledTimes(2));

    act(() => {
      onStatusCallback?.(completeScanStatus);
    });
    await screen.findByText("Import complete");

    await act(async () => {
      stalePoll.resolve(runningStatus);
      await stalePoll.promise;
    });

    expect(screen.getByText("Import complete")).toBeInTheDocument();
    expect(screen.queryByText("Importing Saved Messages")).not.toBeInTheDocument();
  });

  it("closes live updates immediately when they report a terminal state", async () => {
    let onStatusCallback: ((status: ScanStatus) => void) | undefined;
    const closeFn = vi.fn();
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-a",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });
    vi.mocked(subscribeToScanStatus).mockImplementation((handlers: any) => {
      onStatusCallback = handlers.onStatus;
      return { close: closeFn };
    });

    render(<ScanProgress />);
    await waitFor(() => expect(subscribeToScanStatus).toHaveBeenCalledTimes(1));

    act(() => {
      onStatusCallback?.(completeScanStatus);
    });

    await waitFor(() => expect(closeFn).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("No active import")).toBeInTheDocument();
  });

  it("refreshes category counts once when polling observes a terminal scan", async () => {
    vi.mocked(fetchScanStatus)
      .mockResolvedValueOnce(idleScanStatus)
      .mockResolvedValue(completeScanStatus);

    render(<ScanProgress />);
    await screen.findByText("Ready to import");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    await waitFor(() => expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1);
  });

  it("refreshes category counts once for each failed or cancelled terminal transition", async () => {
    let onStatusCallback: ((status: ScanStatus) => void) | undefined;
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-running",
      state: "running",
      started_at: "2026-02-15T10:00:00.000Z",
    });
    vi.mocked(subscribeToScanStatus).mockImplementation((handlers: any) => {
      onStatusCallback = handlers.onStatus;
      return { close: vi.fn() };
    });

    render(<ScanProgress />);
    await screen.findByText("Importing Saved Messages");
    await waitFor(() => expect(subscribeToScanStatus).toHaveBeenCalled());

    act(() => {
      onStatusCallback?.({
        ...idleScanStatus,
        job_id: "job-failed",
        state: "failed",
        finished_at: "2026-02-15T10:05:00.000Z",
        error: "Telegram request failed.",
      });
    });
    await waitFor(() => expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("Telegram request failed.");

    act(() => {
      onStatusCallback?.({
        ...idleScanStatus,
        job_id: "job-failed",
        state: "failed",
        finished_at: "2026-02-15T10:05:00.000Z",
        error: "Telegram request failed.",
      });
    });
    expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1);

    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      job_id: "job-cancelled",
      state: "cancelled",
      finished_at: "2026-02-15T10:06:00.000Z",
      completion_reason: "stopped_by_user",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(notifyCategoriesChanged).toHaveBeenCalledTimes(2));
    expect(screen.getByText("The import was stopped.")).toHaveAttribute("role", "status");
  });
});

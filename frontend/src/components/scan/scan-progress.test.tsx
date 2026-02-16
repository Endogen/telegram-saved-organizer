import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanStatus } from "@/types/scan";

// Mock the scan API before importing the component
vi.mock("@/api/scan", () => ({
  fetchScanStatus: vi.fn(),
  startScan: vi.fn(),
  stopScan: vi.fn(),
  subscribeToScanStatus: vi.fn(),
}));

import { fetchScanStatus, startScan, stopScan, subscribeToScanStatus } from "@/api/scan";
import { ScanProgress } from "@/components/scan/scan-progress";

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

const completeScanStatus: ScanStatus = {
  is_running: false,
  is_complete: true,
  stop_requested: false,
  messages_scanned: 150,
  pages_scanned: 3,
  page_size: 100,
  last_message_id: 5000,
  started_at: "2026-02-15T10:00:00.000Z",
  finished_at: "2026-02-15T10:05:00.000Z",
  error: null,
};

const errorScanStatus: ScanStatus = {
  ...idleScanStatus,
  error: "Connection timed out.",
};

describe("ScanProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(subscribeToScanStatus).mockReturnValue({ close: vi.fn() });
    vi.mocked(fetchScanStatus).mockResolvedValue(idleScanStatus);
    vi.mocked(startScan).mockResolvedValue({
      ...idleScanStatus,
      is_running: true,
    });
    vi.mocked(stopScan).mockResolvedValue({
      ...idleScanStatus,
      stop_requested: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading state initially then renders idle status", async () => {
    render(<ScanProgress />);

    expect(screen.getByText("Loading scan status...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    });

    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1); // messages/pages scanned
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("renders complete status", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue(completeScanStatus);

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Scan complete")).toBeInTheDocument();
    });

    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Scan finished successfully")).toBeInTheDocument();
  });

  it("renders error status", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue(errorScanStatus);

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Scan failed")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection timed out.")).toBeInTheDocument();
  });

  it("handles fetch status failure", async () => {
    vi.mocked(fetchScanStatus).mockRejectedValue(new Error("Network error"));

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("subscribes to SSE and cleans up", async () => {
    const closeFn = vi.fn();
    vi.mocked(subscribeToScanStatus).mockReturnValue({ close: closeFn });

    const { unmount } = render(<ScanProgress />);

    await waitFor(() => {
      expect(subscribeToScanStatus).toHaveBeenCalled();
    });

    unmount();
    expect(closeFn).toHaveBeenCalled();
  });

  it("renders running state with stop button enabled", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      is_running: true,
      messages_scanned: 42,
      pages_scanned: 1,
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Scanning Saved Messages")).toBeInTheDocument();
    });

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("renders stopping state", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      is_running: true,
      stop_requested: true,
      messages_scanned: 80,
      pages_scanned: 2,
      started_at: "2026-02-15T10:00:00.000Z",
    });

    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Stopping scan")).toBeInTheDocument();
    });
  });

  it("starts a scan when start button is clicked", async () => {
    render(<ScanProgress />);

    await waitFor(() => {
      expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(startScan).toHaveBeenCalledWith(100);
    });
  });

  it("stops a scan when stop button is clicked", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      is_running: true,
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
      expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(screen.getByText("Start failed")).toBeInTheDocument();
    });
  });

  it("handles stop scan error", async () => {
    vi.mocked(fetchScanStatus).mockResolvedValue({
      ...idleScanStatus,
      is_running: true,
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
      expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    });

    vi.mocked(fetchScanStatus).mockResolvedValue(completeScanStatus);

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Scan complete")).toBeInTheDocument();
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

    render(<ScanProgress />);

    await waitFor(() => {
      expect(subscribeToScanStatus).toHaveBeenCalled();
    });

    // Simulate SSE status update
    if (onStatusCallback) {
      onStatusCallback({
        ...idleScanStatus,
        is_running: true,
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
      expect(screen.getByText("Live stream fallback")).toBeInTheDocument();
    });
  });
});

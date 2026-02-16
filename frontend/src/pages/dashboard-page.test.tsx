import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/scan", () => ({
  fetchScanStatus: vi.fn(),
  startScan: vi.fn(),
  stopScan: vi.fn(),
  subscribeToScanStatus: vi.fn(),
}));

import { fetchScanStatus, subscribeToScanStatus } from "@/api/scan";
import { DashboardPage } from "@/pages/dashboard-page";
import type { ScanStatus } from "@/types/scan";

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

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchScanStatus).mockResolvedValue(idleScanStatus);
    vi.mocked(subscribeToScanStatus).mockReturnValue({ close: vi.fn() });
  });

  it("renders dashboard heading and scan controls", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Dashboard")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    });
  });
});

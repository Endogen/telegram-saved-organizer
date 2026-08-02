import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/session", () => ({
  fetchActiveSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

import { fetchActiveSessions, revokeSession } from "@/api/session";
import { SessionsPage } from "@/pages/sessions-page";
import type { ActiveSession } from "@/types/account";

const sessions: ActiveSession[] = [
  {
    id: "current",
    current: true,
    created_at: "2026-08-01T10:00:00Z",
    last_seen_at: "2026-08-02T09:00:00Z",
    expires_at: "2026-09-01T10:00:00Z",
    user_agent: "Current browser",
    ip_address: "127.0.0.1",
  },
  {
    id: "other",
    current: false,
    created_at: "2026-07-28T10:00:00Z",
    last_seen_at: "2026-08-01T09:00:00Z",
    expires_at: "2026-08-28T10:00:00Z",
    user_agent: "Firefox on Linux",
    ip_address: "192.0.2.10",
  },
];

describe("SessionsPage", () => {
  beforeEach(() => {
    vi.mocked(fetchActiveSessions).mockReset();
    vi.mocked(revokeSession).mockReset();
    vi.mocked(fetchActiveSessions).mockResolvedValue(sessions);
    vi.mocked(revokeSession).mockResolvedValue(undefined);
  });

  it("marks the current session and only offers revocation for other sessions", async () => {
    render(<SessionsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading active sessions");

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Firefox on Linux")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Revoke session:/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Revoke session: Firefox on Linux" })).toBeInTheDocument();
  });

  it("revokes and removes another session", async () => {
    render(<SessionsPage />);
    const revokeButton = await screen.findByRole("button", { name: "Revoke session: Firefox on Linux" });
    fireEvent.click(revokeButton);

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith("other"));
    await waitFor(() => expect(screen.queryByText("Firefox on Linux")).not.toBeInTheDocument());
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("shows revoke failures without removing the session", async () => {
    vi.mocked(revokeSession).mockRejectedValue(new Error("Revocation failed."));
    render(<SessionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Revoke session: Firefox on Linux" }));

    expect(await screen.findByText("Revocation failed.")).toBeInTheDocument();
    expect(screen.getByText("Firefox on Linux")).toBeInTheDocument();
  });

  it("shows a load error and retries", async () => {
    vi.mocked(fetchActiveSessions).mockRejectedValueOnce(new Error("Sessions unavailable.")).mockResolvedValueOnce(sessions);
    render(<SessionsPage />);

    expect(await screen.findByText("Sessions unavailable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(fetchActiveSessions).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state", async () => {
    vi.mocked(fetchActiveSessions).mockResolvedValue([]);
    render(<SessionsPage />);

    expect(await screen.findByText("No active sessions found")).toBeInTheDocument();
  });
});

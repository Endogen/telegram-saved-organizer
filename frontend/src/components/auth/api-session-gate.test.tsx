import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/api/client";
import { ApiSessionGate, useApiSession } from "@/components/auth/api-session-gate";

const sessionMocks = vi.hoisted(() => ({
  fetchApiSession: vi.fn(),
  unlockApiSession: vi.fn(),
  lockApiSession: vi.fn(),
}));

vi.mock("@/api/session", () => sessionMocks);

function ProtectedContent() {
  const session = useApiSession();
  return (
    <div>
      <span>Protected workspace</span>
      <button type="button" onClick={() => void session?.lockWorkspace()}>Lock test workspace</button>
    </div>
  );
}

describe("ApiSessionGate", () => {
  it("renders children when the browser already has a session", async () => {
    sessionMocks.fetchApiSession.mockResolvedValueOnce({ authenticated: true });

    render(<ApiSessionGate><ProtectedContent /></ApiSessionGate>);

    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
  });

  it("unlocks the workspace with a valid token", async () => {
    sessionMocks.fetchApiSession.mockResolvedValueOnce({ authenticated: false });
    sessionMocks.unlockApiSession.mockResolvedValueOnce({ authenticated: true });

    render(<ApiSessionGate><ProtectedContent /></ApiSessionGate>);

    const tokenInput = await screen.findByLabelText("Local API token");
    fireEvent.change(tokenInput, { target: { value: "a-valid-local-api-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock workspace" }));

    await waitFor(() => expect(sessionMocks.unlockApiSession).toHaveBeenCalledWith("a-valid-local-api-token"));
    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
  });

  it("explains an invalid token without exposing backend error codes", async () => {
    sessionMocks.fetchApiSession.mockResolvedValueOnce({ authenticated: false });
    sessionMocks.unlockApiSession.mockRejectedValueOnce(
      new ApiRequestError("api_authentication_required", 401, "api_authentication_required"),
    );

    render(<ApiSessionGate><ProtectedContent /></ApiSessionGate>);

    fireEvent.change(await screen.findByLabelText("Local API token"), { target: { value: "wrong-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That token is not valid");
  });

  it("explains a blocked browser origin", async () => {
    sessionMocks.fetchApiSession.mockResolvedValueOnce({ authenticated: false });
    sessionMocks.unlockApiSession.mockRejectedValueOnce(
      new ApiRequestError("cross_origin_request_blocked", 403, "cross_origin_request_blocked"),
    );

    render(<ApiSessionGate><ProtectedContent /></ApiSessionGate>);

    fireEvent.change(await screen.findByLabelText("Local API token"), { target: { value: "local-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("backend rejected this browser origin");
  });

  it("locks an active browser session", async () => {
    sessionMocks.fetchApiSession.mockResolvedValueOnce({ authenticated: true });
    sessionMocks.lockApiSession.mockResolvedValueOnce({ authenticated: false });

    render(<ApiSessionGate><ProtectedContent /></ApiSessionGate>);

    fireEvent.click(await screen.findByRole("button", { name: "Lock test workspace" }));

    expect(await screen.findByLabelText("Local API token")).toBeInTheDocument();
    expect(sessionMocks.lockApiSession).toHaveBeenCalledTimes(1);
  });
});

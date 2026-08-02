import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_UNAUTHORIZED_EVENT } from "@/api/client";
import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { useUiStore } from "@/stores/ui-store";

const sessionMocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));
const accountMocks = vi.hoisted(() => ({ registerAccount: vi.fn() }));

vi.mock("@/api/session", () => sessionMocks);
vi.mock("@/api/account", () => accountMocks);

const user = { id: "u1", email: "ada@example.com", display_name: "Ada", created_at: "2026-01-01" };

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.display_name ?? "no user"}</span>
      <button type="button" onClick={() => void auth.login({ email: user.email, password: "  exact  " })}>Log in</button>
      <button type="button" onClick={() => void auth.register({ email: user.email, display_name: user.display_name, password: "  exact  " })}>Register</button>
      <button type="button" onClick={() => void auth.logout().catch(() => undefined)}>Log out</button>
      <button type="button" onClick={() => void auth.refreshSession()}>Refresh</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.deleteSession.mockResolvedValue(undefined);
    useUiStore.setState({ isSidebarOpen: false, searchQuery: "" });
  });

  it("bootstraps an authenticated session", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: true, user });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("distinguishes an anonymous session from an unavailable server", async () => {
    sessionMocks.fetchSession.mockResolvedValueOnce({ authenticated: false, user: null });
    const first = render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    first.unmount();

    sessionMocks.fetchSession.mockRejectedValueOnce(new Error("offline"));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("treats malformed session data as unavailable rather than anonymous", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: true, user: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("logs in without normalizing the password", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: false, user: null });
    sessionMocks.createSession.mockResolvedValue({ authenticated: true, user });
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("anonymous");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(sessionMocks.createSession).toHaveBeenCalledWith({ email: user.email, password: "  exact  " });
  });

  it("creates a session after registering an account", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: false, user: null });
    accountMocks.registerAccount.mockResolvedValue(undefined);
    sessionMocks.createSession.mockResolvedValue({ authenticated: true, user });
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("anonymous");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(accountMocks.registerAccount).toHaveBeenCalledWith({ email: user.email, display_name: user.display_name, password: "  exact  " });
    expect(sessionMocks.createSession).toHaveBeenCalledWith({ email: user.email, password: "  exact  " });
  });

  it("keeps an authenticated view mounted when a background refresh fails", async () => {
    sessionMocks.fetchSession.mockResolvedValueOnce({ authenticated: true, user });
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("authenticated");
    sessionMocks.fetchSession.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(sessionMocks.fetchSession).toHaveBeenCalledTimes(2));
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("clears account-specific UI on unauthorized responses and logout", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: true, user });
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("authenticated");
    useUiStore.setState({ isSidebarOpen: true, searchQuery: "private" });
    window.dispatchEvent(new Event(API_UNAUTHORIZED_EVENT));
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(useUiStore.getState()).toMatchObject({ isSidebarOpen: false, searchQuery: "" });

    sessionMocks.createSession.mockResolvedValue({ authenticated: true, user });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByText("authenticated");
    useUiStore.setState({ searchQuery: "private again" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(sessionMocks.deleteSession).toHaveBeenCalled());
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(useUiStore.getState().searchQuery).toBe("");
  });

  it("keeps the authenticated view when logout cannot reach the server", async () => {
    sessionMocks.fetchSession.mockResolvedValue({ authenticated: true, user });
    sessionMocks.deleteSession.mockRejectedValue(new Error("offline"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("authenticated");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(sessionMocks.deleteSession).toHaveBeenCalledTimes(1));

    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

import { AccountMenu } from "@/components/account/account-menu";
import { useAuth, type AuthContextValue } from "@/components/auth/auth-provider";

const user = {
  id: "user-1",
  email: "ada@example.com",
  display_name: "Ada Lovelace",
  created_at: "2026-08-01T10:00:00Z",
};

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "authenticated",
    user,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderMenu() {
  return render(
    <MemoryRouter>
      <AccountMenu />
    </MemoryRouter>,
  );
}

describe("AccountMenu", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authValue());
  });

  it("shows the signed-in identity and account destinations", async () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Open account menu for Ada Lovelace" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("menuitem", { name: "Active sessions" })).toHaveAttribute("href", "/settings/sessions");
    expect(screen.getByRole("menuitem", { name: "Telegram connection" })).toHaveAttribute(
      "href",
      "/settings/telegram",
    );
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Account settings" })).toHaveFocus());
  });

  it("supports arrow navigation and restores trigger focus on Escape", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /Open account menu/ });
    fireEvent.click(trigger);

    const accountLink = screen.getByRole("menuitem", { name: "Account settings" });
    await waitFor(() => expect(accountLink).toHaveFocus());
    fireEvent.keyDown(accountLink, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Active sessions" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("activates the focused menu destination with Enter", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Open account menu/ }));
    const accountLink = screen.getByRole("menuitem", { name: "Account settings" });
    await waitFor(() => expect(accountLink).toHaveFocus());
    fireEvent.keyDown(accountLink, { key: "ArrowDown" });

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Active sessions" }), { key: "Enter" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes after an outside pointer event", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Open account menu/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("signs out and reports failures", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("Sign out failed."));
    vi.mocked(useAuth).mockReturnValue(authValue({ logout }));
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /Open account menu/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed.");
  });

  it("renders nothing without an authenticated user", () => {
    vi.mocked(useAuth).mockReturnValue(authValue({ status: "anonymous", user: null }));
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { ApiRequestError } from "@/api/client";
import { RegisterPage } from "@/pages/register-page";

const authMocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ register: authMocks.register }),
}));

describe("RegisterPage", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPage(returnTo?: string) {
    return render(
      <MemoryRouter initialEntries={[returnTo ? { pathname: "/register", state: { returnTo } } : "/register"]}>
        <Routes>
          <Route path="register" element={<RegisterPage />} />
          <Route path="onboarding/telegram" element={<div>Telegram onboarding</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("validates mismatched passwords with accessible fields", () => {
    renderPage();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password one" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password two" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it("preserves passwords and continues to Telegram onboarding", async () => {
    authMocks.register.mockResolvedValue({});
    renderPage("/messages");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Ada  " } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "  ada@example.com  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "  exact password  " } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "  exact password  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(authMocks.register).toHaveBeenCalledWith({
      email: "ada@example.com",
      display_name: "Ada",
      password: "  exact password  ",
    }));
    expect(await screen.findByText("Telegram onboarding")).toBeInTheDocument();
  });

  it("does not reveal whether the registration email already exists", async () => {
    authMocks.register.mockRejectedValue(
      new ApiRequestError("An account with this email already exists.", 409, "account_conflict"),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a secure password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not complete registration or sign you in/i);
    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
  });
});

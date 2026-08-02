import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { ApiRequestError } from "@/api/client";
import { LoginPage } from "@/pages/login-page";

const authMocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ login: authMocks.login }),
}));

describe("LoginPage", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPage(state?: unknown) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="messages" element={<div>Messages destination</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("uses accessible autocomplete and validation errors", () => {
    renderPage();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
  });

  it("preserves the password and returns to the requested route", async () => {
    authMocks.login.mockResolvedValue({});
    renderPage({ returnTo: "/messages?q=saved" });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "  ada@example.com  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "  exact password  " } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(authMocks.login).toHaveBeenCalledWith({ email: "ada@example.com", password: "  exact password  " }));
    expect(await screen.findByText("Messages destination")).toBeInTheDocument();
  });

  it("focuses a helpful authentication error", async () => {
    authMocks.login.mockRejectedValue(new ApiRequestError("bad", 401, "bad"));
    renderPage();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("email or password is incorrect");
    expect(alert).toHaveFocus();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/account", () => ({
  fetchAccount: vi.fn(),
  updateAccount: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

import { changePassword, deleteAccount, fetchAccount, updateAccount } from "@/api/account";
import { useAuth, type AuthContextValue } from "@/components/auth/auth-provider";
import { AccountSettingsPage } from "@/pages/account-settings-page";
import type { AccountUser } from "@/types/account";

const account: AccountUser = {
  id: "user-1",
  email: "ada@example.com",
  display_name: "Ada Lovelace",
  created_at: "2026-08-01T10:00:00Z",
};

const logout = vi.fn();
const refreshSession = vi.fn();

function authValue(): AuthContextValue {
  return {
    status: "authenticated",
    user: account,
    login: vi.fn(),
    register: vi.fn(),
    logout,
    refreshSession,
  };
}

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authValue());
    vi.mocked(fetchAccount).mockReset();
    vi.mocked(updateAccount).mockReset();
    vi.mocked(changePassword).mockReset();
    vi.mocked(deleteAccount).mockReset();
    vi.mocked(fetchAccount).mockResolvedValue(account);
    vi.mocked(updateAccount).mockResolvedValue(account);
    vi.mocked(changePassword).mockResolvedValue(undefined);
    vi.mocked(deleteAccount).mockResolvedValue(undefined);
    logout.mockReset().mockResolvedValue(undefined);
    refreshSession.mockReset().mockResolvedValue(undefined);
  });

  it("shows the email as read-only identity and saves only the normalized display name", async () => {
    const updatedAccount = { ...account, display_name: "Grace Hopper" };
    vi.mocked(updateAccount).mockResolvedValue(updatedAccount);
    render(<AccountSettingsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading account settings");
    await screen.findByRole("heading", { name: "Account settings" });

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("This is your sign-in identity and cannot be changed here.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email address" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Grace Hopper  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(updateAccount).toHaveBeenCalledWith({ display_name: "Grace Hopper" });
    });
    expect(await screen.findByText("Account details saved.")).toBeInTheDocument();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("validates the display name before submitting", async () => {
    render(<AccountSettingsPage />);
    await screen.findByRole("heading", { name: "Account settings" });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByText("Enter your display name.")).toBeInTheDocument();
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it("preserves password whitespace exactly", async () => {
    render(<AccountSettingsPage />);
    await screen.findByRole("heading", { name: "Account settings" });

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: " current pass " } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "  a new password  " } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "  a new password  " } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        current_password: " current pass ",
        new_password: "  a new password  ",
      });
    });
    expect(await screen.findByText("Password changed successfully.")).toBeInTheDocument();
  });

  it("rejects a password confirmation mismatch", async () => {
    render(<AccountSettingsPage />);
    await screen.findByRole("heading", { name: "Account settings" });

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a long new password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a different password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByText("New password and confirmation do not match.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("requires explicit deletion confirmation", async () => {
    render(<AccountSettingsPage />);
    await screen.findByRole("heading", { name: "Account settings" });

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const confirmButton = screen.getByRole("button", { name: "Permanently delete account" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Current password for deletion"), {
      target: { value: " delete password " },
    });
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith({
      password: " delete password ",
      confirmation: "DELETE",
    }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not report deletion as failed when the removed session makes logout fail", async () => {
    logout.mockRejectedValue(new Error("Session no longer exists."));
    render(<AccountSettingsPage />);
    await screen.findByRole("heading", { name: "Account settings" });

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText("Current password for deletion"), {
      target: { value: "delete password" },
    });
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete account" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Session no longer exists.")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not delete your account.")).not.toBeInTheDocument();
  });

  it("shows a load error and retries", async () => {
    vi.mocked(fetchAccount).mockRejectedValueOnce(new Error("Account unavailable.")).mockResolvedValueOnce(account);
    render(<AccountSettingsPage />);

    expect(await screen.findByText("Account unavailable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(fetchAccount).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/auth", () => ({
  fetchTelegramConnection: vi.fn(),
  connectTelegram: vi.fn(),
  verifyTelegram: vi.fn(),
  disconnectTelegram: vi.fn(),
}));

import {
  connectTelegram,
  disconnectTelegram,
  fetchTelegramConnection,
  verifyTelegram,
} from "@/api/auth";
import { ApiRequestError } from "@/api/client";
import { ConnectPage } from "@/pages/connect-page";
import type { TelegramConnection } from "@/types/auth";

const disconnected: TelegramConnection = { state: "disconnected" };
const codeRequired: TelegramConnection = { state: "code_required", phone_masked: "+1 ••• ••• 1234" };
const passwordRequired: TelegramConnection = { state: "password_required", phone_masked: "+1 ••• ••• 1234" };
const connected: TelegramConnection = {
  state: "connected",
  account: {
    display_name: "Ada Lovelace",
    username: "ada",
    phone_masked: "+1 ••• ••• 1234",
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectPage />
    </MemoryRouter>,
  );
}

describe("ConnectPage", () => {
  beforeEach(() => {
    vi.mocked(fetchTelegramConnection).mockReset().mockResolvedValue(disconnected);
    vi.mocked(connectTelegram).mockReset().mockResolvedValue(codeRequired);
    vi.mocked(verifyTelegram).mockReset().mockResolvedValue(connected);
    vi.mocked(disconnectTelegram).mockReset().mockResolvedValue(disconnected);
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("loads server state before rendering the disconnected form", async () => {
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading Telegram connection...");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Connect your account" })).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    expect(screen.queryByLabelText("API ID")).not.toBeInTheDocument();
    expect(screen.getByText(/API credentials are configured securely by the server/)).toBeInTheDocument();
  });

  it("resumes a pending code challenge from server state on refresh", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(codeRequired);

    renderPage();

    expect(await screen.findByLabelText("Verification Code")).toBeInTheDocument();
    expect(screen.getByText(/\+1 ••• ••• 1234/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a different number" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Telegram connection progress" })).toHaveTextContent("Verify");
  });

  it("renders the password challenge directly from server state", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(passwordRequired);

    renderPage();

    expect(await screen.findByLabelText("Two-Factor Password")).toBeInTheDocument();
    expect(screen.getByText(/Telegram accepted the code/)).toBeInTheDocument();
  });

  it("renders connected account details and data-retention guidance", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(connected);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Ada Lovelace is ready" })).toBeInTheDocument();
    expect(screen.getByText("@ada · +1 ••• ••• 1234")).toBeInTheDocument();
    expect(screen.getByText(/does not remove messages already imported/)).toBeInTheDocument();
    expect(screen.getByText("Ready to scan")).toBeInTheDocument();
  });

  it("completes the phone, code, and connected flow using response states", async () => {
    renderPage();

    const phone = await screen.findByLabelText("Phone Number");
    fireEvent.change(phone, { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    await waitFor(() => {
      expect(connectTelegram).toHaveBeenCalledWith({ phone: "+15550001234" });
    });

    const code = await screen.findByLabelText("Verification Code");
    fireEvent.change(code, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    expect(await screen.findByRole("heading", { name: "Ada Lovelace is ready" })).toBeInTheDocument();
    expect(verifyTelegram).toHaveBeenCalledWith({ code: "12345" });
  });

  it("keeps the current server state available after a verification error", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(codeRequired);
    vi.mocked(verifyTelegram).mockRejectedValue(new Error("Wrong code."));

    renderPage();

    const input = await screen.findByLabelText("Verification Code");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code.");
    expect(screen.getByLabelText("Verification Code")).toHaveValue("wrong");
    expect(fetchTelegramConnection).toHaveBeenCalledTimes(1);
  });

  it("shows connection errors without leaving the phone step", async () => {
    vi.mocked(connectTelegram).mockRejectedValue(new Error("Invalid phone."));

    renderPage();

    const phone = await screen.findByLabelText("Phone Number");
    fireEvent.change(phone, { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid phone.");
    expect(screen.getByLabelText("Phone Number")).toHaveValue("+1555");
  });

  it("explains when a Telegram identity already belongs to another account", async () => {
    vi.mocked(connectTelegram).mockRejectedValue(
      new ApiRequestError(
        "telegram_account_already_connected",
        409,
        "telegram_account_already_connected",
      ),
    );

    renderPage();

    const phone = await screen.findByLabelText("Phone Number");
    fireEvent.change(phone, { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Telegram account is already connected to another organizer account.",
    );
  });

  it("renders a friendly rate-limit message", async () => {
    vi.mocked(connectTelegram).mockRejectedValue(
      new ApiRequestError("too_many_requests", 429, "too_many_requests"),
    );

    renderPage();

    const phone = await screen.findByLabelText("Phone Number");
    fireEvent.change(phone, { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many Telegram sign-in attempts. Wait a moment and try again.",
    );
  });

  it("offers retry when initial status loading fails", async () => {
    vi.mocked(fetchTelegramConnection)
      .mockRejectedValueOnce(new Error("Server down."))
      .mockResolvedValueOnce(disconnected);

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Server down.");
    expect(screen.queryByLabelText("Phone Number")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Phone Number")).toBeInTheDocument();
    expect(fetchTelegramConnection).toHaveBeenCalledTimes(2);
  });

  it("uses a safe fallback for non-Error failures", async () => {
    vi.mocked(fetchTelegramConnection).mockRejectedValue("offline");

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed. Check your connection and try again.");
  });

  it("confirms disconnect and explains that imported messages remain", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(connected);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Telegram" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("messages already imported into the organizer will remain"));
    await waitFor(() => expect(disconnectTelegram).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText("Phone Number")).toBeInTheDocument();
  });

  it("can cancel a pending challenge to use a different number", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(codeRequired);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Use a different number" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("use a different phone number"));
    expect(await screen.findByLabelText("Phone Number")).toBeInTheDocument();
  });

  it("does not disconnect when confirmation is declined", async () => {
    vi.mocked(fetchTelegramConnection).mockResolvedValue(connected);
    vi.mocked(confirm).mockReturnValue(false);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Telegram" }));

    expect(disconnectTelegram).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Ada Lovelace is ready" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open scanner dashboard" })).toHaveAttribute("href", "/");
  });

  it("prevents overlapping connection submissions", async () => {
    let resolveConnection: ((value: TelegramConnection) => void) | undefined;
    vi.mocked(connectTelegram).mockImplementation(
      () => new Promise((resolve) => {
        resolveConnection = resolve;
      }),
    );

    renderPage();

    const phone = await screen.findByLabelText("Phone Number");
    fireEvent.change(phone, { target: { value: "+15550001234" } });
    const submit = screen.getByRole("button", { name: "Continue with Telegram" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(connectTelegram).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending code..." })).toBeDisabled();

    resolveConnection?.(codeRequired);
    expect(await screen.findByLabelText("Verification Code")).toBeInTheDocument();
  });
});

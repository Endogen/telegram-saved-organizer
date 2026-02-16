import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/auth", () => ({
  fetchTelegramAuthStatus: vi.fn(),
  connectTelegram: vi.fn(),
  verifyTelegram: vi.fn(),
  disconnectTelegram: vi.fn(),
}));

import {
  connectTelegram,
  disconnectTelegram,
  fetchTelegramAuthStatus,
  verifyTelegram,
} from "@/api/auth";
import { ConnectPage } from "@/pages/connect-page";
import type { TelegramAuthStatus } from "@/types/auth";

const disconnectedStatus: TelegramAuthStatus = {
  connected: false,
  authorized: false,
  has_session: false,
  verification_required: false,
  password_required: false,
};

const verifyingStatus: TelegramAuthStatus = {
  connected: true,
  authorized: false,
  has_session: true,
  verification_required: true,
  password_required: false,
};

const authorizedStatus: TelegramAuthStatus = {
  connected: true,
  authorized: true,
  has_session: true,
  verification_required: false,
  password_required: false,
};

const passwordRequiredStatus: TelegramAuthStatus = {
  ...verifyingStatus,
  password_required: true,
};

describe("ConnectPage", () => {
  beforeEach(() => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(disconnectedStatus);
    vi.mocked(connectTelegram).mockResolvedValue(verifyingStatus);
    vi.mocked(verifyTelegram).mockResolvedValue(authorizedStatus);
    vi.mocked(disconnectTelegram).mockResolvedValue(disconnectedStatus);
  });

  it("shows loading state then connect form when disconnected", async () => {
    render(<ConnectPage />);

    expect(screen.getByText("Loading Telegram auth status...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Not Connected")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("API ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Connection" })).toBeInTheDocument();
  });

  it("shows authorized state", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(authorizedStatus);

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Telegram session is authorized.")).toBeInTheDocument();
    });

    expect(screen.getByText("Ready to scan")).toBeInTheDocument();
  });

  it("shows verification form after connecting", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(verifyingStatus);

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Verification Required")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
  });

  it("shows password form when 2FA required", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(passwordRequiredStatus);

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Two-Factor Password")).toBeInTheDocument();
    });
  });

  it("completes connect → verify flow", async () => {
    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("API ID")).toBeInTheDocument();
    });

    // Fill connect form
    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
    });

    // Verify code
    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    await waitFor(() => {
      expect(screen.getByText("Telegram session is authorized.")).toBeInTheDocument();
    });
  });

  it("handles connect error", async () => {
    vi.mocked(connectTelegram).mockRejectedValue(new Error("Invalid phone."));

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("API ID")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid phone.")).toBeInTheDocument();
    });
  });

  it("handles verify error and syncs status", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(verifyingStatus);
    vi.mocked(verifyTelegram).mockRejectedValue(new Error("Wrong code."));

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    await waitFor(() => {
      expect(screen.getByText("Wrong code.")).toBeInTheDocument();
    });
  });

  it("handles fetch status error", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockRejectedValue(new Error("Server down."));

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Server down.")).toBeInTheDocument();
    });
  });

  it("handles disconnect", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(authorizedStatus);

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Telegram session is authorized.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(disconnectTelegram).toHaveBeenCalled();
    });
  });

  it("handles disconnect error", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(authorizedStatus);
    vi.mocked(disconnectTelegram).mockRejectedValue(new Error("Failed to disconnect."));

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Telegram session is authorized.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to disconnect.")).toBeInTheDocument();
    });
  });

  it("handles non-Error thrown objects", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockRejectedValue("string error");

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Request failed. Check backend logs and try again.")).toBeInTheDocument();
    });
  });

  it("renders status chips", async () => {
    vi.mocked(fetchTelegramAuthStatus).mockResolvedValue(authorizedStatus);

    render(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText("Connected to Telegram")).toBeInTheDocument();
    });

    // "Authorized" appears both as a heading and as a status chip
    expect(screen.getAllByText("Authorized").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Session found")).toBeInTheDocument();
  });
});

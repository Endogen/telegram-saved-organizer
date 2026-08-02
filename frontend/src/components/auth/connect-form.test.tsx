import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectForm } from "@/components/auth/connect-form";

const API_HASH = "0123456789abcdef0123456789abcdef";

function fillCredentials() {
  fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: API_HASH } });
}

describe("ConnectForm", () => {
  it("asks for the user's Telegram app credentials and phone number", () => {
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("API ID")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("API Hash")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByRole("button", { name: "Continue with Telegram" })).toBeInTheDocument();
  });

  it("shows the pending state and disables every credential input", () => {
    render(<ConnectForm isSubmitting error={null} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sending code..." })).toBeDisabled();
    expect(screen.getByLabelText("API ID")).toBeDisabled();
    expect(screen.getByLabelText("API Hash")).toBeDisabled();
    expect(screen.getByLabelText("Phone Number")).toBeDisabled();
  });

  it("exposes a server error as an accessible field error", () => {
    render(<ConnectForm isSubmitting={false} error="Invalid Telegram credentials." onSubmit={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid Telegram credentials.");
    expect(screen.getByLabelText("API ID")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("API Hash")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("aria-invalid", "true");
  });

  it("validates the API ID", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "not-a-number" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: API_HASH } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(screen.getByRole("alert")).toHaveTextContent("API ID must be a positive number.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates the API hash", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(screen.getByRole("alert")).toHaveTextContent("API Hash must be exactly 32 hexadecimal characters.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates that the phone number is long enough", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fillCredentials();
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Phone number looks too short.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims and submits valid per-user credentials and phone number", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: " 123456 " } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: ` ${API_HASH} ` } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "  +155****1234  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(onSubmit).toHaveBeenCalledWith({
      apiId: 123456,
      apiHash: API_HASH,
      phone: "+155****1234",
    });
  });

  it("clears a local validation error on the next valid submission", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fillCredentials();
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(onSubmit).toHaveBeenCalledWith({ apiId: 123456, apiHash: API_HASH, phone: "+1555" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

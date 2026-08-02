import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectForm } from "@/components/auth/connect-form";

describe("ConnectForm", () => {
  it("asks only for the Telegram phone number", () => {
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("autocomplete", "tel");
    expect(screen.queryByLabelText("API ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API Hash")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Telegram" })).toBeInTheDocument();
  });

  it("shows the pending state and disables the input", () => {
    render(<ConnectForm isSubmitting error={null} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sending code..." })).toBeDisabled();
    expect(screen.getByLabelText("Phone Number")).toBeDisabled();
  });

  it("exposes a server error as an accessible field error", () => {
    render(<ConnectForm isSubmitting={false} error="Invalid phone number." onSubmit={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid phone number.");
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("aria-describedby", "telegram-phone-error");
  });

  it("validates that the phone number is long enough", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Phone number looks too short.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims and submits a valid phone number", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "  +15550001234  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(onSubmit).toHaveBeenCalledWith({ phone: "+15550001234" });
  });

  it("clears a local validation error on the next valid submission", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Telegram" }));

    expect(onSubmit).toHaveBeenCalledWith({ phone: "+1555" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

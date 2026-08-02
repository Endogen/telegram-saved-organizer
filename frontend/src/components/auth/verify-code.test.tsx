import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VerifyCode } from "@/components/auth/verify-code";

describe("VerifyCode", () => {
  it("renders a one-time-code field for the code step", () => {
    render(<VerifyCode passwordRequired={false} isSubmitting={false} error={null} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText("Verification Code");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("button", { name: "Verify Code" })).toBeInTheDocument();
  });

  it("renders a current-password field for the password step", () => {
    render(<VerifyCode passwordRequired isSubmitting={false} error={null} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("Two-Factor Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Verify Password" })).toBeInTheDocument();
  });

  it("shows the pending state and disables the input", () => {
    render(<VerifyCode passwordRequired={false} isSubmitting error={null} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    expect(screen.getByLabelText("Verification Code")).toBeDisabled();
  });

  it("exposes server errors as accessible field errors", () => {
    render(<VerifyCode passwordRequired={false} isSubmitting={false} error="Invalid code." onSubmit={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid code.");
    expect(screen.getByLabelText("Verification Code")).toHaveAttribute("aria-invalid", "true");
  });

  it("requires a verification code", () => {
    const onSubmit = vi.fn();
    render(<VerifyCode passwordRequired={false} isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Verification code is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires a non-blank two-step verification password", () => {
    const onSubmit = vi.fn();
    render(<VerifyCode passwordRequired isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Two-Factor Password"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Password" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Two-factor password is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims and submits a verification code", () => {
    const onSubmit = vi.fn();
    render(<VerifyCode passwordRequired={false} isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "  12345  " } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    expect(onSubmit).toHaveBeenCalledWith({ code: "12345" });
  });

  it("preserves the password exactly, including surrounding whitespace", () => {
    const onSubmit = vi.fn();
    render(<VerifyCode passwordRequired isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Two-Factor Password"), { target: { value: "  my secret  " } });
    fireEvent.click(screen.getByRole("button", { name: "Verify Password" }));

    expect(onSubmit).toHaveBeenCalledWith({ password: "  my secret  " });
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VerifyCode } from "@/components/auth/verify-code";

describe("VerifyCode", () => {
  it("renders code input when password is not required", () => {
    render(
      <VerifyCode
        passwordRequired={false}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify Code" })).toBeInTheDocument();
  });

  it("renders password input when password is required", () => {
    render(
      <VerifyCode
        passwordRequired
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Two-Factor Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify Password" })).toBeInTheDocument();
  });

  it("shows submitting state", () => {
    render(
      <VerifyCode
        passwordRequired={false}
        isSubmitting
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Verifying..." })).toBeInTheDocument();
    expect(screen.getByLabelText("Verification Code")).toBeDisabled();
  });

  it("displays server error", () => {
    render(
      <VerifyCode
        passwordRequired={false}
        isSubmitting={false}
        error="Invalid code."
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Invalid code.")).toBeInTheDocument();
  });

  it("validates code is required when submitting", () => {
    const onSubmit = vi.fn();
    render(
      <VerifyCode
        passwordRequired={false}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));
    expect(screen.getByText("Verification code is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates password is required when submitting", () => {
    const onSubmit = vi.fn();
    render(
      <VerifyCode
        passwordRequired
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verify Password" }));
    expect(screen.getByText("Two-factor password is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits code successfully", () => {
    const onSubmit = vi.fn();
    render(
      <VerifyCode
        passwordRequired={false}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Verification Code"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Code" }));

    expect(onSubmit).toHaveBeenCalledWith({ code: "12345" });
  });

  it("submits password successfully", () => {
    const onSubmit = vi.fn();
    render(
      <VerifyCode
        passwordRequired
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Two-Factor Password"), {
      target: { value: "mysecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Password" }));

    expect(onSubmit).toHaveBeenCalledWith({ password: "mysecret" });
  });
});

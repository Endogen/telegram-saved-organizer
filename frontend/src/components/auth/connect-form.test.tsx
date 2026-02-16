import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectForm } from "@/components/auth/connect-form";

describe("ConnectForm", () => {
  it("renders all input fields and submit button", () => {
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("API ID")).toBeInTheDocument();
    expect(screen.getByLabelText("API Hash")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Connection" })).toBeInTheDocument();
  });

  it("shows submitting state", () => {
    render(<ConnectForm isSubmitting error={null} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sending code..." })).toBeInTheDocument();
    expect(screen.getByLabelText("API ID")).toBeDisabled();
    expect(screen.getByLabelText("API Hash")).toBeDisabled();
    expect(screen.getByLabelText("Phone Number")).toBeDisabled();
  });

  it("displays server error", () => {
    render(<ConnectForm isSubmitting={false} error="Invalid credentials." onSubmit={vi.fn()} />);

    expect(screen.getByText("Invalid credentials.")).toBeInTheDocument();
  });

  it("validates API ID must be a positive integer", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "hash123" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    expect(screen.getByText("API ID must be a positive integer.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates API hash is required", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    expect(screen.getByText("API hash is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates phone number minimum length", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "hash" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    expect(screen.getByText("Phone number looks too short.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits valid form data", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "abcdef" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+15550001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    expect(onSubmit).toHaveBeenCalledWith({
      api_id: 123456,
      api_hash: "abcdef",
      phone: "+15550001234",
    });
  });

  it("clears validation error on new submit attempt", () => {
    const onSubmit = vi.fn();
    render(<ConnectForm isSubmitting={false} error={null} onSubmit={onSubmit} />);

    // Trigger validation error
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));
    expect(screen.getByText("API ID must be a positive integer.")).toBeInTheDocument();

    // Fill valid data and submit
    fireEvent.change(screen.getByLabelText("API ID"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("API Hash"), { target: { value: "hash" } });
    fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "+1555" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Connection" }));

    expect(onSubmit).toHaveBeenCalled();
  });
});

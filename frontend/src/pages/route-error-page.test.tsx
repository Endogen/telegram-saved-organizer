import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock react-router-dom to provide a controlled error
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useRouteError: vi.fn(),
    isRouteErrorResponse: vi.fn(),
  };
});

import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { RouteErrorPage } from "@/pages/route-error-page";

// We need MemoryRouter for Link components
import { MemoryRouter } from "react-router-dom";

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <RouteErrorPage />
    </MemoryRouter>,
  );
}

describe("RouteErrorPage", () => {
  it("renders Error instance message", () => {
    vi.mocked(useRouteError).mockReturnValue(new Error("Something broke."));
    vi.mocked(isRouteErrorResponse).mockReturnValue(false);

    renderWithRouter();

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something broke.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeInTheDocument();
  });

  it("renders route error response data", () => {
    vi.mocked(useRouteError).mockReturnValue({
      status: 404,
      statusText: "Not Found",
      data: "Page not found.",
      internal: false,
    });
    vi.mocked(isRouteErrorResponse).mockReturnValue(true);

    renderWithRouter();

    expect(screen.getByText("Page not found.")).toBeInTheDocument();
  });

  it("renders fallback for route error without data", () => {
    vi.mocked(useRouteError).mockReturnValue({
      status: 500,
      statusText: "Internal Server Error",
      data: "",
      internal: false,
    });
    vi.mocked(isRouteErrorResponse).mockReturnValue(true);

    renderWithRouter();

    expect(screen.getByText("500 Internal Server Error")).toBeInTheDocument();
  });

  it("renders fallback for unknown error type", () => {
    vi.mocked(useRouteError).mockReturnValue("string error");
    vi.mocked(isRouteErrorResponse).mockReturnValue(false);

    renderWithRouter();

    expect(screen.getByText("An unexpected routing error occurred.")).toBeInTheDocument();
  });

  it("renders fallback for Error with empty message", () => {
    vi.mocked(useRouteError).mockReturnValue(new Error("  "));
    vi.mocked(isRouteErrorResponse).mockReturnValue(false);

    renderWithRouter();

    expect(screen.getByText("An unexpected routing error occurred.")).toBeInTheDocument();
  });
});

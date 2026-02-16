import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/use-categories", () => ({
  useCategories: vi.fn(),
}));

import { useCategories } from "@/hooks/use-categories";
import { AppLayout } from "@/components/layout/app-layout";

describe("AppLayout", () => {
  beforeEach(() => {
    vi.mocked(useCategories).mockReturnValue({
      categories: [
        {
          id: 1,
          name: "Text",
          slug: "text",
          icon: "message-square",
          color: "#6B7280",
          position: 1,
          is_default: true,
          message_count: 5,
        },
      ],
      isLoading: false,
      isFallback: false,
      error: null,
    });
  });

  function renderAppLayout(initialEntry = "/") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<div>Dashboard Content</div>} />
            <Route path="messages" element={<div>Messages Content</div>} />
            <Route path="connect" element={<div>Connect Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders layout with sidebar, top bar, and child route", () => {
    renderAppLayout();

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders messages route with correct title", () => {
    renderAppLayout("/messages");

    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(screen.getByText("Messages Content")).toBeInTheDocument();
  });

  it("renders connect route with correct title", () => {
    renderAppLayout("/connect");

    expect(screen.getByRole("heading", { level: 1, name: "Connect Telegram" })).toBeInTheDocument();
    expect(screen.getByText("Connect Content")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    renderAppLayout();

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect" })).toBeInTheDocument();
  });
});

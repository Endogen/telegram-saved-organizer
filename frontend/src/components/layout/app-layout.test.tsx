import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/hooks/use-categories", () => ({
  useCategories: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "ada@example.com",
      display_name: "Ada Lovelace",
      created_at: "2026-08-02T12:00:00Z",
    },
    logout: vi.fn(),
  }),
}));

import { useCategories } from "@/hooks/use-categories";
import { AppLayout } from "@/components/layout/app-layout";

describe("AppLayout", () => {
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    vi.mocked(useCategories).mockReturnValue({
      categories: [
        {
          id: 1,
          name: "Text",
          slug: "text",
          system_key: "text",
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
            <Route path="settings/telegram" element={<div>Telegram Content</div>} />
            <Route path="settings/categories" element={<div>Categories Content</div>} />
            <Route path="settings/tags" element={<div>Tags Content</div>} />
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

  it("renders Telegram settings with the correct title", () => {
    renderAppLayout("/settings/telegram");

    expect(screen.getByRole("heading", { level: 1, name: "Telegram connection" })).toBeInTheDocument();
    expect(screen.getByText("Telegram Content")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    renderAppLayout();

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Telegram" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("renders organization route metadata", () => {
    renderAppLayout("/settings/categories");
    expect(screen.getByRole("heading", { level: 1, name: "Category management" })).toBeInTheDocument();
    expect(screen.getByText("Categories Content")).toBeInTheDocument();
    expect(document.title).toBe("Category management · Telegram Saved Organizer");
  });

  it("exposes a skip link and updates the document title", () => {
    renderAppLayout("/messages");

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(document.title).toBe("Messages · Telegram Saved Organizer");
  });
});

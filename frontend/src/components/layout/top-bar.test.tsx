import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/account/account-menu", () => ({
  AccountMenu: () => <button type="button">Account</button>,
}));

import { TopBar } from "@/components/layout/top-bar";
import { useUiStore } from "@/stores/ui-store";

describe("TopBar", () => {
  beforeEach(() => {
    useUiStore.setState({ isSidebarOpen: false });
  });

  it("renders title and subtitle", () => {
    render(<TopBar title="Dashboard" subtitle="Overview of your workspace." onMenuClick={vi.fn()} />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Overview of your workspace.")).toBeInTheDocument();
    expect(screen.getByText("Telegram Saved Organizer")).toBeInTheDocument();
  });

  it("calls onMenuClick when hamburger is clicked", () => {
    const onMenuClick = vi.fn();
    render(<TopBar title="Test" subtitle="Test sub" onMenuClick={onMenuClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it("exposes navigation state and a focusable page heading", () => {
    useUiStore.setState({ isSidebarOpen: true });
    render(<TopBar title="Sessions" subtitle="Manage sessions." onMenuClick={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Toggle navigation" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Toggle navigation" })).toHaveAttribute(
      "aria-controls",
      "workspace-navigation",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Sessions" })).toHaveAttribute("tabindex", "-1");
  });
});

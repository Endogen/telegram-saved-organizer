import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "@/components/layout/top-bar";

describe("TopBar", () => {
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
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkActions } from "@/components/messages/bulk-actions";
import type { CategoryWithCount } from "@/types/category";
import type { MessageTag } from "@/types/message";

const categories: CategoryWithCount[] = [
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
  {
    id: 2,
    name: "Links",
    slug: "links",
    system_key: "links",
    icon: "link",
    color: "#0EA5E9",
    position: 2,
    is_default: true,
    message_count: 3,
  },
];

const tags: MessageTag[] = [
  { id: 10, name: "backend", color: null },
  { id: 11, name: "urgent", color: "#F97316" },
];

function renderBulkActions(overrides: Partial<Parameters<typeof BulkActions>[0]> = {}) {
  const defaultProps = {
    selectedCount: 2,
    filteredCount: 10,
    categories,
    tags,
    selectedCategoryId: 1,
    selectedTagId: 10,
    isMoveSubmitting: false,
    isTagSubmitting: false,
    isDeleteSubmitting: false,
    errorMessage: null,
    successMessage: null,
    onSelectAllFiltered: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectedCategoryChange: vi.fn(),
    onSelectedTagChange: vi.fn(),
    onBulkMove: vi.fn(),
    onBulkTag: vi.fn(),
    onBulkDelete: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };

  render(<BulkActions {...defaultProps} />);
  return defaultProps;
}

describe("BulkActions", () => {
  it("renders selection counts and action buttons", () => {
    renderBulkActions();

    expect(screen.getByText("Bulk selection mode")).toBeInTheDocument();
    expect(screen.getByText("2 selected of 10 visible messages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select visible (10)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeInTheDocument();
  });

  it("calls onSelectAllFiltered when select visible is clicked", () => {
    const props = renderBulkActions();

    fireEvent.click(screen.getByRole("button", { name: "Select visible (10)" }));
    expect(props.onSelectAllFiltered).toHaveBeenCalledTimes(1);
  });

  it("calls onClearSelection when clear is clicked", () => {
    const props = renderBulkActions();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("calls onBulkMove when move is clicked", () => {
    const props = renderBulkActions();

    fireEvent.click(screen.getByRole("button", { name: "Move selected" }));
    expect(props.onBulkMove).toHaveBeenCalledTimes(1);
  });

  it("calls onBulkDelete when delete is clicked", () => {
    const props = renderBulkActions();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(props.onBulkDelete).toHaveBeenCalledTimes(1);
  });

  it("selects an existing tag and calls the bulk tag action", () => {
    const props = renderBulkActions();

    fireEvent.change(screen.getByRole("combobox", { name: "Tag selected with" }), {
      target: { value: "11" },
    });
    expect(props.onSelectedTagChange).toHaveBeenCalledWith(11);

    fireEvent.click(screen.getByRole("button", { name: "Tag selected" }));
    expect(props.onBulkTag).toHaveBeenCalledTimes(1);
  });

  it("calls onExit when exit button is clicked", () => {
    const props = renderBulkActions();

    fireEvent.click(screen.getByRole("button", { name: "Exit bulk mode" }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectedCategoryChange when category changes", () => {
    const props = renderBulkActions();

    const select = screen.getByRole("combobox", { name: "Move selected to" });
    fireEvent.change(select, { target: { value: "2" } });
    expect(props.onSelectedCategoryChange).toHaveBeenCalledWith(2);
  });

  it("handles invalid category selection gracefully", () => {
    const props = renderBulkActions();

    const select = screen.getByRole("combobox", { name: "Move selected to" });
    fireEvent.change(select, { target: { value: "abc" } });
    expect(props.onSelectedCategoryChange).toHaveBeenCalledWith(null);
  });

  it("shows submitting states", () => {
    renderBulkActions({ isMoveSubmitting: true });
    expect(screen.getByRole("button", { name: "Moving..." })).toBeInTheDocument();

    renderBulkActions({ isDeleteSubmitting: true });
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeInTheDocument();

    renderBulkActions({ isTagSubmitting: true });
    expect(screen.getByRole("button", { name: "Tagging..." })).toBeInTheDocument();
  });

  it("disables buttons appropriately when no selection", () => {
    renderBulkActions({ selectedCount: 0 });

    expect(screen.getByRole("button", { name: "Clear selection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tag selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });

  it("displays error message", () => {
    renderBulkActions({ errorMessage: "Something went wrong." });

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("coordinates disabled states while any mutation is pending", () => {
    renderBulkActions({ isTagSubmitting: true });

    expect(screen.getByRole("button", { name: "Select visible (10)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Move selected to" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Tag selected with" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exit bulk mode" })).toBeDisabled();
  });

  it("shows a polite bulk-action success message", () => {
    renderBulkActions({ successMessage: "Added #urgent to 2 selected messages." });

    expect(screen.getByRole("status")).toHaveTextContent("Added #urgent to 2 selected messages.");
  });
});

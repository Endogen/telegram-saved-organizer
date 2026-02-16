import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MoveDialog } from "@/components/categories/move-dialog";
import type { CategoryWithCount } from "@/types/category";
import type { MessageListItem } from "@/types/message";

const categories: CategoryWithCount[] = [
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
  {
    id: 2,
    name: "Links",
    slug: "links",
    icon: "link",
    color: "#0EA5E9",
    position: 2,
    is_default: true,
    message_count: 3,
  },
];

function createMessage(overrides: Partial<MessageListItem> = {}): MessageListItem {
  return {
    id: 1,
    telegram_id: 1001,
    content: "Test message",
    media_type: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    url: null,
    sender_name: null,
    date: "2026-02-15T10:00:00.000Z",
    category_id: 1,
    raw_data: {},
    created_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-15T10:00:00.000Z",
    category: {
      id: 1,
      name: "Text",
      slug: "text",
      icon: "message-square",
      color: "#6B7280",
    },
    tags: [],
    ...overrides,
  };
}

describe("MoveDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MoveDialog
        open={false}
        message={null}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when open but no message", () => {
    const { container } = render(
      <MoveDialog
        open
        message={null}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders dialog with category options", () => {
    const message = createMessage();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Move message")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Links" })).toBeInTheDocument();
  });

  it("submits move with selected category", async () => {
    const message = createMessage();
    const onSubmit = vi.fn();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(onSubmit).toHaveBeenCalledWith(1, 2);
  });

  it("disables submit when same category is selected", () => {
    const message = createMessage();
    const onSubmit = vi.fn();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    // Same category (id: 1) is pre-selected
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  });

  it("shows submitting state", () => {
    const message = createMessage();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Moving..." })).toBeDisabled();
  });

  it("displays error message", () => {
    const message = createMessage();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage="Failed to move message."
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed to move message.")).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on escape key", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <MoveDialog
        open
        message={message}
        categories={categories}
        isSubmitting={false}
        errorMessage={null}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

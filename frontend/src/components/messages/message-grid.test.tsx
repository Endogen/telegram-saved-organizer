import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageGrid } from "@/components/messages/message-grid";
import type { MessageListItem } from "@/types/message";

function createMessage(id: number, overrides: Partial<MessageListItem> = {}): MessageListItem {
  const baseMessage: MessageListItem = {
    id,
    telegram_id: id + 1000,
    content: `Message ${id}`,
    media_type: "text",
    file_name: null,
    file_size: null,
    mime_type: null,
    media_url: null,
    url: null,
    sender_name: null,
    date: "2026-02-15T10:00:00.000Z",
    category_id: 1,
    raw_data: {},
    created_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-15T10:00:00.000Z",
    category: {
      id: 1,
      name: "General",
      slug: "general",
      icon: "message-square",
      color: "#0f766e",
    },
    tags: [],
  };

  return {
    ...baseMessage,
    ...overrides,
    category: overrides.category ?? baseMessage.category,
    tags: overrides.tags ?? baseMessage.tags,
    raw_data: overrides.raw_data ?? baseMessage.raw_data,
  };
}

describe("MessageGrid", () => {
  it("renders cards and propagates callbacks to message actions", () => {
    const messages = [createMessage(1), createMessage(2)];
    const onOpenDetailRequest = vi.fn();
    const onMoveRequest = vi.fn();
    const onTagRequest = vi.fn();
    const onDeleteRequest = vi.fn();
    const onSelectionChange = vi.fn();

    render(
      <MessageGrid
        messages={messages}
        pendingDeleteMessageId={null}
        isSelectionMode
        selectedMessageIds={[2]}
        onOpenDetailRequest={onOpenDetailRequest}
        onMoveRequest={onMoveRequest}
        onTagRequest={onTagRequest}
        onDeleteRequest={onDeleteRequest}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(screen.getByText("Message 1")).toBeInTheDocument();
    expect(screen.getByText("Message 2")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox", { name: "Select message" });
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    fireEvent.click(screen.getAllByRole("button", { name: "View full message" })[0]);
    expect(onOpenDetailRequest).toHaveBeenCalledWith(messages[0]);

    fireEvent.click(checkboxes[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(messages[0], true);

    fireEvent.click(screen.getAllByRole("button", { name: "Message actions" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to category" }));
    expect(onMoveRequest).toHaveBeenCalledWith(messages[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "Message actions" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit tags" }));
    expect(onTagRequest).toHaveBeenCalledWith(messages[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "Message actions" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));
    expect(onDeleteRequest).toHaveBeenCalledWith(messages[0]);
  });

  it("marks the pending delete card as non-draggable and disables delete action", () => {
    const messages = [createMessage(11), createMessage(12)];

    render(
      <MessageGrid
        messages={messages}
        pendingDeleteMessageId={12}
        isSelectionMode={false}
        selectedMessageIds={[]}
        onOpenDetailRequest={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Message actions" })[1]);
    const deleteButton = screen.getByRole("menuitem", { name: "Deleting..." });
    expect(deleteButton).toBeDisabled();

    const card = screen.getByText("Message 12").closest("article");
    expect(card).toHaveAttribute("draggable", "false");
  });
});

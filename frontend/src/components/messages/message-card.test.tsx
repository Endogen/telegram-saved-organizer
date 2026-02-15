import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageCard } from "@/components/messages/message-card";
import type { MessageListItem } from "@/types/message";

function createMessage(overrides: Partial<MessageListItem> = {}): MessageListItem {
  const baseMessage: MessageListItem = {
    id: 101,
    telegram_id: 9001,
    content: "Read this later",
    media_type: "text",
    file_name: null,
    file_size: null,
    mime_type: null,
    url: "https://www.example.com/path",
    sender_name: "Me",
    date: "2026-02-15T10:00:00.000Z",
    category_id: 4,
    raw_data: {},
    created_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-15T10:00:00.000Z",
    category: {
      id: 4,
      name: "Links",
      slug: "links",
      icon: "link",
      color: "#0ea5e9",
    },
    tags: [
      {
        id: 1,
        name: "work",
        color: "#16a34a",
      },
    ],
  };

  return {
    ...baseMessage,
    ...overrides,
    category: overrides.category ?? baseMessage.category,
    tags: overrides.tags ?? baseMessage.tags,
    raw_data: overrides.raw_data ?? baseMessage.raw_data,
  };
}

describe("MessageCard", () => {
  it("renders message metadata, parsed domain, and tags", () => {
    const message = createMessage({ content: "  Ship this build  " });

    render(
      <MessageCard
        message={message}
        onOpenDetailRequest={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByText("Ship this build")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("#work")).toBeInTheDocument();
  });

  it("invokes action callbacks from the card controls", () => {
    const message = createMessage();
    const onOpenDetailRequest = vi.fn();
    const onMoveRequest = vi.fn();
    const onTagRequest = vi.fn();
    const onDeleteRequest = vi.fn();

    render(
      <MessageCard
        message={message}
        onOpenDetailRequest={onOpenDetailRequest}
        onMoveRequest={onMoveRequest}
        onTagRequest={onTagRequest}
        onDeleteRequest={onDeleteRequest}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View full message" }));
    expect(onOpenDetailRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));
    expect(onOpenDetailRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to category" }));
    expect(onMoveRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));
    expect(onTagRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));
    expect(onDeleteRequest).toHaveBeenCalledWith(message);
  });

  it("supports selection and handles pending delete state", () => {
    const message = createMessage({
      content: "   ",
      url: "not-a-valid-url",
      tags: [],
    });
    const onSelectionChange = vi.fn();
    const onDeleteRequest = vi.fn();

    render(
      <MessageCard
        message={message}
        isDeletePending
        onOpenDetailRequest={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={onDeleteRequest}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(screen.getByText("No text preview available for this message.")).toBeInTheDocument();
    expect(screen.getByText("not-a-valid-url")).toBeInTheDocument();

    const checkbox = screen.getByRole("checkbox", { name: "Select message" });
    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalledWith(message, true);

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const deleteButton = screen.getByRole("menuitem", { name: "Deleting..." });
    expect(deleteButton).toBeDisabled();

    fireEvent.click(deleteButton);
    expect(onDeleteRequest).not.toHaveBeenCalled();

    expect(screen.getByText(message.category.name).closest("article")).toHaveAttribute("draggable", "false");
  });
});

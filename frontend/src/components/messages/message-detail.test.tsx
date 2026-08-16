import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageDetail } from "@/components/messages/message-detail";
import type { MessageListItem } from "@/types/message";

function createMessage(overrides: Partial<MessageListItem> = {}): MessageListItem {
  return {
    id: 1,
    telegram_id: 5001,
    content: "Hello world message content",
    media_type: "document",
    file_name: "report.pdf",
    file_size: 1048576,
    mime_type: "application/pdf",
    media_url: null,
    url: "https://example.com/file",
    sender_name: "Test User",
    date: "2026-02-15T10:00:00.000Z",
    category_id: 3,
    raw_data: { source: "test" },
    created_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-15T11:00:00.000Z",
    category: {
      id: 3,
      name: "Links",
      slug: "links",
      icon: "link",
      color: "#0EA5E9",
    },
    tags: [
      { id: 1, name: "important", color: "#EF4444" },
      { id: 2, name: "work", color: null },
    ],
    ...overrides,
  };
}

describe("MessageDetail", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MessageDetail
        open={false}
        message={null}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders nothing when open but no message", () => {
    const { container } = render(
      <MessageDetail
        open
        message={null}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders full message details when open with message", () => {
    const message = createMessage();

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Message details")).toBeInTheDocument();
    expect(screen.getByText("Hello world message content")).toBeInTheDocument();
    expect(screen.getAllByText("Links").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText(/Telegram #5001/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute("href", "https://example.com/file");
    expect(screen.getByText("document")).toBeInTheDocument();
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("1.00 MB")).toBeInTheDocument();
    expect(screen.getByText("#important")).toBeInTheDocument();
    expect(screen.getByText("#work")).toBeInTheDocument();
    const categoryBadge = screen.getByLabelText("Category: Links");
    expect(categoryBadge).toHaveClass("bg-[hsl(var(--muted))]", "text-[hsl(var(--foreground))]");
    expect(categoryBadge).not.toHaveStyle({ color: message.category.color });
    expect(categoryBadge.querySelector("span[aria-hidden='true']")).toHaveStyle({
      backgroundColor: message.category.color,
    });
    const importantTag = screen.getByLabelText("Tag: important");
    expect(importantTag).toHaveClass("bg-[hsl(var(--muted))]", "text-[hsl(var(--foreground))]");
    expect(importantTag).not.toHaveStyle({ color: message.tags[0].color });
    expect(importantTag.querySelector("span[aria-hidden='true']")).toHaveStyle({
      backgroundColor: message.tags[0].color,
    });
  });

  it("shows the link preview when content is null", () => {
    const message = createMessage({ content: null });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute("href", "https://example.com/file");
  });

  it("shows 'No tags attached' when tags are empty", () => {
    const message = createMessage({ tags: [] });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByText("No tags attached.")).toBeInTheDocument();
  });

  it("hides media section when no media details", () => {
    const message = createMessage({
      media_type: null,
      file_name: null,
      file_size: null,
      mime_type: null,
    });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.queryByText("Media details")).not.toBeInTheDocument();
  });

  it("hides url section when no url", () => {
    const message = createMessage({ url: null });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.queryByText("https://example.com/file")).not.toBeInTheDocument();
  });

  it("calls action callbacks", () => {
    const message = createMessage();
    const onClose = vi.fn();
    const onMoveRequest = vi.fn();
    const onTagRequest = vi.fn();
    const onDeleteRequest = vi.fn();

    render(
      <MessageDetail
        open
        message={message}
        onClose={onClose}
        onMoveRequest={onMoveRequest}
        onTagRequest={onTagRequest}
        onDeleteRequest={onDeleteRequest}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onMoveRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(onTagRequest).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteRequest).toHaveBeenCalledWith(message);
  });

  it("shows delete pending state", () => {
    const message = createMessage();

    render(
      <MessageDetail
        open
        message={message}
        isDeletePending
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
  });

  it("closes on escape key", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <MessageDetail
        open
        message={message}
        onClose={onClose}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when backdrop is clicked", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <MessageDetail
        open
        message={message}
        onClose={onClose}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close message details"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders raw data section", () => {
    const message = createMessage({ raw_data: { key: "value" } });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByText("Raw payload")).toBeInTheDocument();
  });

  it("hides raw data when empty", () => {
    const message = createMessage({ raw_data: {} });

    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.queryByText("Raw payload")).not.toBeInTheDocument();
  });

  it("handles small file sizes", () => {
    const messageSmall = createMessage({ file_size: 500 });
    render(
      <MessageDetail
        open
        message={messageSmall}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("500 B")).toBeInTheDocument();
  });

  it("handles large file sizes", () => {
    const messageLarge = createMessage({ file_size: 1073741824 });
    render(
      <MessageDetail
        open
        message={messageLarge}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("1.00 GB")).toBeInTheDocument();
  });

  it("hides file size when null or invalid", () => {
    const message = createMessage({ file_size: null });
    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );
    expect(screen.queryByText("File size")).not.toBeInTheDocument();
  });

  it("handles whitespace-only content", () => {
    const message = createMessage({ content: "    " });
    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute("href", "https://example.com/file");
  });

  it("handles sender_name being null", () => {
    const message = createMessage({ sender_name: null });
    render(
      <MessageDetail
        open
        message={message}
        onClose={vi.fn()}
        onMoveRequest={vi.fn()}
        onTagRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );
    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
  });
});

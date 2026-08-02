import { fireEvent, render as renderTestingLibrary, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TagInputDialog } from "@/components/tags/tag-input";
import type { MessageListItem, MessageTag } from "@/types/message";

const availableTags: MessageTag[] = [
  { id: 1, name: "frontend", color: "#0EA5E9" },
  { id: 2, name: "backend", color: "#10B981" },
  { id: 3, name: "urgent", color: "#EF4444" },
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
    tags: [{ id: 1, name: "frontend", color: "#0EA5E9" }],
    ...overrides,
  };
}

function render(element: ReactElement) {
  return renderTestingLibrary(<MemoryRouter>{element}</MemoryRouter>);
}

describe("TagInputDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <TagInputDialog
        open={false}
        message={null}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when open but no message", () => {
    const { container } = render(
      <TagInputDialog
        open
        message={null}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders attached tags and available tags", () => {
    const message = createMessage();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByText("Tags for this message")).toBeInTheDocument();
    // Attached tag (frontend) with remove button
    expect(screen.getByText("#frontend")).toBeInTheDocument();
    // Available tags (not attached)
    expect(screen.getByText("+ #backend")).toBeInTheDocument();
    expect(screen.getByText("+ #urgent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage all tags" })).toHaveAttribute("href", "/settings/tags");
  });

  it("keeps long tag catalogues reachable within a short viewport", () => {
    render(
      <TagInputDialog
        open
        message={createMessage()}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-y-auto", "overscroll-contain");
    expect(dialog.parentElement).toHaveClass("overflow-y-auto");
  });

  it("calls onRemoveTag when attached tag is clicked", () => {
    const message = createMessage();
    const onRemoveTag = vi.fn();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={onRemoveTag}
        onCreateTag={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove tag"));
    expect(onRemoveTag).toHaveBeenCalledWith(1, 1);
  });

  it("calls onAddTag when available tag is clicked", () => {
    const message = createMessage();
    const onAddTag = vi.fn();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("+ #backend"));
    expect(onAddTag).toHaveBeenCalledWith(1, 2);
  });

  it("clears the input after creating a new tag", async () => {
    const message = createMessage();
    const onCreateTag = vi.fn().mockResolvedValue(true);

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={onCreateTag}
      />,
    );

    const input = screen.getByPlaceholderText("e.g. read-later");
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(onCreateTag).toHaveBeenCalledWith("new-tag");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("preserves the input when creating a tag fails", async () => {
    const message = createMessage();
    const onCreateTag = vi.fn().mockResolvedValue(false);

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage="Create tag failed."
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={onCreateTag}
      />,
    );

    const input = screen.getByPlaceholderText("e.g. read-later");
    fireEvent.change(input, { target: { value: "keep-this" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("keep-this"));
    expect(input).toHaveValue("keep-this");
  });

  it("disables create button when tag name is empty", () => {
    const message = createMessage();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add tag" })).toBeDisabled();
  });

  it("shows submitting state", () => {
    const message = createMessage();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("displays error message", () => {
    const message = createMessage();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage="Failed to add tag."
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed to add tag.")).toBeInTheDocument();
  });

  it("shows no-tags-attached message when empty", () => {
    const message = createMessage({ tags: [] });

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByText("No tags attached yet.")).toBeInTheDocument();
  });

  it("shows all-tags-attached message when no available tags left", () => {
    const message = createMessage({
      tags: [
        { id: 1, name: "frontend", color: "#0EA5E9" },
        { id: 2, name: "backend", color: "#10B981" },
        { id: 3, name: "urgent", color: "#EF4444" },
      ],
    });

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    expect(screen.getByText("All available tags are already attached.")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={onClose}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes before opening the full tag manager", () => {
    const onClose = vi.fn();

    render(
      <TagInputDialog
        open
        message={createMessage()}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={onClose}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Manage all tags" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on escape key", () => {
    const message = createMessage();
    const onClose = vi.fn();

    render(
      <TagInputDialog
        open
        message={message}
        availableTags={availableTags}
        isSubmitting={false}
        errorMessage={null}
        onClose={onClose}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

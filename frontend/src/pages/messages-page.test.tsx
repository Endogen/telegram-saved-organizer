import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkDeleteMessages,
  bulkMoveMessages,
  deleteMessage,
  listMessages,
  moveMessageToCategory,
  TelegramNotConnectedError,
} from "@/api/messages";
import {
  addTagsToMessage,
  createTag,
  listTags,
  removeTagFromMessage,
} from "@/api/tags";
import { useCategories } from "@/hooks/use-categories";
import { MessagesPage } from "@/pages/messages-page";
import type { CategoryWithCount } from "@/types/category";
import type { MessageListItem, MessageTag } from "@/types/message";

vi.mock("@/api/messages", () => ({
  TelegramNotConnectedError: class TelegramNotConnectedError extends Error {},
  listMessages: vi.fn(),
  moveMessageToCategory: vi.fn(),
  deleteMessage: vi.fn(),
  bulkDeleteMessages: vi.fn(),
  bulkMoveMessages: vi.fn(),
}));

vi.mock("@/api/tags", () => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  addTagsToMessage: vi.fn(),
  removeTagFromMessage: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategories: vi.fn(),
}));

const categoriesFixture: CategoryWithCount[] = [
  {
    id: 2,
    name: "Audio",
    slug: "audio",
    icon: "music",
    color: "#2563EB",
    position: 2,
    is_default: true,
    message_count: 1,
  },
  {
    id: 3,
    name: "Links",
    slug: "links",
    icon: "link",
    color: "#0EA5E9",
    position: 3,
    is_default: true,
    message_count: 1,
  },
  {
    id: 7,
    name: "Text",
    slug: "text",
    icon: "message-square",
    color: "#6B7280",
    position: 7,
    is_default: true,
    message_count: 1,
  },
];

function createMessage(id: number, overrides: Partial<MessageListItem>): MessageListItem {
  const base: MessageListItem = {
    id,
    telegram_id: id + 1000,
    content: `message ${id}`,
    media_type: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    url: null,
    sender_name: "saved messages",
    date: "2026-02-18T09:00:00.000Z",
    category_id: 7,
    raw_data: {},
    created_at: "2026-02-18T09:00:00.000Z",
    updated_at: "2026-02-18T09:00:00.000Z",
    category: {
      id: 7,
      name: "Text",
      slug: "text",
      icon: "message-square",
      color: "#6B7280",
    },
    tags: [],
  };

  return {
    ...base,
    ...overrides,
    category: overrides.category ?? base.category,
    tags: overrides.tags ?? base.tags,
    raw_data: overrides.raw_data ?? base.raw_data,
  };
}

const messagesFixture: MessageListItem[] = [
  createMessage(101, {
    content: "Backend checklist",
    sender_name: "zoe",
    date: "2026-02-18T09:00:00.000Z",
    category_id: 7,
    category: {
      id: 7,
      name: "Text",
      slug: "text",
      icon: "message-square",
      color: "#6B7280",
    },
    tags: [
      { id: 10, name: "backend", color: null },
      { id: 11, name: "urgent", color: "#F97316" },
    ],
  }),
  createMessage(102, {
    content: "React animation reference",
    sender_name: "alex",
    date: "2026-02-17T09:00:00.000Z",
    category_id: 3,
    category: {
      id: 3,
      name: "Links",
      slug: "links",
      icon: "link",
      color: "#0EA5E9",
    },
    url: "https://motion.dev/docs",
    tags: [{ id: 12, name: "frontend", color: "#0EA5E9" }],
  }),
  createMessage(103, {
    content: "Weekly standup audio",
    sender_name: "maria",
    date: "2026-02-16T09:00:00.000Z",
    media_type: "audio/ogg",
    category_id: 2,
    category: {
      id: 2,
      name: "Audio",
      slug: "audio",
      icon: "music",
      color: "#2563EB",
    },
    tags: [
      { id: 12, name: "frontend", color: "#0EA5E9" },
      { id: 13, name: "meeting", color: null },
    ],
  }),
];

const knownTagsFixture: MessageTag[] = [
  { id: 10, name: "backend", color: null },
  { id: 11, name: "urgent", color: "#F97316" },
  { id: 12, name: "frontend", color: "#0EA5E9" },
  { id: 13, name: "meeting", color: null },
];

function renderMessagesPage(initialEntry = "/messages") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/messages" element={<MessagesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MessagesPage fallback", () => {
  beforeEach(() => {
    vi.mocked(listMessages).mockRejectedValue(new Error("API down"));
    vi.mocked(listTags).mockRejectedValue(new Error("API down"));
    vi.mocked(useCategories).mockReturnValue({
      categories: [],
      isLoading: false,
      isFallback: true,
      error: "API unavailable",
    });
  });

  it("shows fallback data when API is unavailable", async () => {
    renderMessagesPage();

    await waitFor(() => {
      expect(screen.getByText("Running with local fallback data.")).toBeInTheDocument();
    });

    // Should show sample messages
    expect(screen.getByText("4 messages")).toBeInTheDocument();
  });
});

describe("MessagesPage empty state", () => {
  beforeEach(() => {
    vi.mocked(listMessages).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 200,
    });
    vi.mocked(listTags).mockResolvedValue([]);
    vi.mocked(useCategories).mockReturnValue({
      categories: categoriesFixture,
      isLoading: false,
      isFallback: false,
      error: null,
    });
  });

  it("shows empty state when no messages exist", async () => {
    renderMessagesPage();

    await waitFor(() => {
      expect(screen.getByText("No messages yet.")).toBeInTheDocument();
    });

    expect(screen.getByText("Connect Telegram and run a scan to import Saved Messages.")).toBeInTheDocument();
  });
});

describe("MessagesPage filters", () => {
  beforeEach(() => {
    vi.mocked(listMessages).mockResolvedValue({
      items: messagesFixture,
      total: messagesFixture.length,
      page: 1,
      per_page: 200,
    });
    vi.mocked(listTags).mockResolvedValue(knownTagsFixture);
    vi.mocked(useCategories).mockReturnValue({
      categories: categoriesFixture,
      isLoading: false,
      isFallback: false,
      error: null,
    });
    vi.mocked(moveMessageToCategory).mockResolvedValue(messagesFixture[0]);
    vi.mocked(deleteMessage).mockResolvedValue();
    vi.mocked(bulkDeleteMessages).mockResolvedValue({ deleted_count: 0 });
    vi.mocked(bulkMoveMessages).mockResolvedValue({ moved_count: 0, category_id: categoriesFixture[0].id });
    vi.mocked(addTagsToMessage).mockResolvedValue(knownTagsFixture);
    vi.mocked(removeTagFromMessage).mockResolvedValue(knownTagsFixture);
    vi.mocked(createTag).mockResolvedValue({ id: 99, name: "new", color: null });
  });

  it("filters by search and clears active filters", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.change(screen.getByPlaceholderText("Search by text, URL, sender, or tag..."), {
      target: { value: "react" },
    });

    expect(screen.getByText("1 of 3 messages")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Backend checklist")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByText("3 messages")).toBeInTheDocument();
    expect(screen.getByText("Backend checklist")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();
  });

  it("applies category and tag filters from controls", async () => {
    renderMessagesPage("/messages?category=links");
    await screen.findByText("1 of 3 messages");

    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.queryByText("Backend checklist")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "" } });
    expect(screen.getByText("3 messages")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /#frontend/i }));
    expect(screen.getByText("2 of 3 messages")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /#meeting/i }));
    expect(screen.getByText("1 of 3 messages")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("React animation reference")).not.toBeInTheDocument();
    });
  });

  it("reorders visible cards when sort option changes", async () => {
    const { container } = renderMessagesPage();
    await screen.findByText("3 messages");

    const firstCardText = () => container.querySelector("article")?.textContent ?? "";
    expect(firstCardText()).toContain("Backend checklist");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "sender" } });

    await waitFor(() => {
      expect(firstCardText()).toContain("React animation reference");
    });
  });
});

describe("MessagesPage actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMessages).mockResolvedValue({
      items: messagesFixture,
      total: messagesFixture.length,
      page: 1,
      per_page: 200,
    });
    vi.mocked(listTags).mockResolvedValue(knownTagsFixture);
    vi.mocked(useCategories).mockReturnValue({
      categories: categoriesFixture,
      isLoading: false,
      isFallback: false,
      error: null,
    });
    vi.mocked(moveMessageToCategory).mockResolvedValue(messagesFixture[0]);
    vi.mocked(deleteMessage).mockResolvedValue();
    vi.mocked(bulkDeleteMessages).mockResolvedValue({ deleted_count: 0 });
    vi.mocked(bulkMoveMessages).mockResolvedValue({ moved_count: 0, category_id: categoriesFixture[0].id });
    vi.mocked(addTagsToMessage).mockResolvedValue(knownTagsFixture);
    vi.mocked(removeTagFromMessage).mockResolvedValue(knownTagsFixture);
    vi.mocked(createTag).mockResolvedValue({ id: 99, name: "new", color: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("opens detail modal via View full message button", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const viewButtons = screen.getAllByRole("button", { name: "View full message" });
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Message details")).toBeInTheDocument();
  });

  it("replaces message details with the requested action dialog", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getAllByRole("button", { name: "View full message" })[0]);
    await screen.findByText("Message details");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(await screen.findByText("Move message")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Message details")).not.toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });
  });

  it("opens move dialog from card menu", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to category" }));

    await waitFor(() => {
      expect(screen.getByText("Move message")).toBeInTheDocument();
    });
  });

  it("opens tag dialog from card menu", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });
  });

  it("deletes a message after confirmation", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));

    await waitFor(() => {
      expect(deleteMessage).toHaveBeenCalledWith(101, false);
    });

    await waitFor(() => {
      expect(screen.getByText("2 messages")).toBeInTheDocument();
    });
  });

  it("offers a local-only delete when Telegram is disconnected", async () => {
    vi.mocked(deleteMessage)
      .mockRejectedValueOnce(new TelegramNotConnectedError())
      .mockResolvedValueOnce();

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));

    await waitFor(() => {
      expect(deleteMessage).toHaveBeenNthCalledWith(1, 101, false);
      expect(deleteMessage).toHaveBeenNthCalledWith(2, 101, true);
    });
    expect(screen.getByText("2 messages")).toBeInTheDocument();
  });

  it("cancels delete when user declines confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(screen.getByText("3 messages")).toBeInTheDocument();
  });

  it("handles delete error", async () => {
    vi.mocked(deleteMessage).mockRejectedValue(new Error("Delete failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));

    await waitFor(() => {
      expect(screen.getByText("Delete failed.")).toBeInTheDocument();
    });
  });

  it("moves a message via move dialog", async () => {
    vi.mocked(moveMessageToCategory).mockResolvedValue({
      ...messagesFixture[0],
      category_id: 2,
      category: { id: 2, name: "Audio", slug: "audio", icon: "music", color: "#2563EB" },
    });

    renderMessagesPage();
    await screen.findByText("3 messages");

    // Open move dialog
    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to category" }));

    const dialogHeading = await screen.findByText("Move message");
    const dialogContainer = dialogHeading.closest("[role='presentation']") as HTMLElement;
    expect(dialogContainer).toBeTruthy();

    // Select a different category within the dialog and submit
    const dialogScope = within(dialogContainer);
    const select = dialogScope.getByRole("combobox");
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(dialogScope.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveMessageToCategory).toHaveBeenCalledWith(101, 2);
    });
  });

  it("handles move error in dialog", async () => {
    vi.mocked(moveMessageToCategory).mockRejectedValue(new Error("Move failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to category" }));

    const dialogHeading = await screen.findByText("Move message");
    const dialogContainer = dialogHeading.closest("[role='presentation']") as HTMLElement;
    expect(dialogContainer).toBeTruthy();

    const dialogScope = within(dialogContainer);
    const select = dialogScope.getByRole("combobox");
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(dialogScope.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(screen.getByText("Move failed.")).toBeInTheDocument();
    });
  });

  it("adds a tag to a message via tag dialog", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    // Click available tag to add
    const addButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.startsWith("+ #"));
    if (addButtons.length > 0) {
      fireEvent.click(addButtons[0]);
    }

    await waitFor(() => {
      expect(addTagsToMessage).toHaveBeenCalled();
    });
  });

  it("removes a tag from a message via tag dialog", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    // Remove attached tag
    const removeBtns = screen.getAllByTitle("Remove tag");
    if (removeBtns.length > 0) {
      fireEvent.click(removeBtns[0]);
    }

    await waitFor(() => {
      expect(removeTagFromMessage).toHaveBeenCalled();
    });
  });

  it("creates and attaches a new tag", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("e.g. read-later");
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith({ name: "new-tag" });
    });
  });

  it("enters bulk selection mode and selects messages", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));

    expect(screen.getByText("Bulk selection mode")).toBeInTheDocument();

    // Select all visible
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    expect(screen.getByText("3 selected of 3 visible messages")).toBeInTheDocument();

    // Clear selection
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("0 selected of 3 visible messages")).toBeInTheDocument();
  });

  it("performs bulk delete", async () => {
    vi.mocked(bulkDeleteMessages).mockResolvedValue({ deleted_count: 3 });

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(bulkDeleteMessages).toHaveBeenCalledWith([101, 102, 103], false);
    });
  });

  it("offers a local-only bulk delete when Telegram is disconnected", async () => {
    vi.mocked(bulkDeleteMessages)
      .mockRejectedValueOnce(new TelegramNotConnectedError())
      .mockResolvedValueOnce({ deleted_count: 3 });

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(bulkDeleteMessages).toHaveBeenNthCalledWith(1, [101, 102, 103], false);
      expect(bulkDeleteMessages).toHaveBeenNthCalledWith(2, [101, 102, 103], true);
    });
    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  });

  it("performs bulk move", async () => {
    vi.mocked(bulkMoveMessages).mockResolvedValue({ moved_count: 3, category_id: 2 });

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Move selected" }));

    await waitFor(() => {
      expect(bulkMoveMessages).toHaveBeenCalled();
    });
  });

  it("exits bulk selection mode", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    expect(screen.getByText("Bulk selection mode")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit bulk mode" }));
    expect(screen.queryByText("Bulk selection mode")).not.toBeInTheDocument();
  });

  it("selects/deselects individual messages via checkbox", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    // Click checkbox on first card to enter selection mode
    const checkboxes = screen.getAllByRole("checkbox", { name: "Select message" });
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(screen.getByText("Bulk selection mode")).toBeInTheDocument();
    });

    expect(screen.getByText("1 selected of 3 visible messages")).toBeInTheDocument();

    // Deselect
    const checkboxesAfter = screen.getAllByRole("checkbox", { name: "Select message" });
    fireEvent.click(checkboxesAfter[0]);

    expect(screen.getByText("0 selected of 3 visible messages")).toBeInTheDocument();
  });

  it("shows 'no matches' state when filter yields no results", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.change(screen.getByPlaceholderText("Search by text, URL, sender, or tag..."), {
      target: { value: "zzzznonexistent" },
    });

    expect(screen.getByText("No messages match these filters.")).toBeInTheDocument();
  });

  it("sorts by date ascending and category", async () => {
    const { container } = renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "date_asc" } });

    await waitFor(() => {
      const firstCard = container.querySelector("article");
      expect(firstCard?.textContent).toContain("Weekly standup audio");
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "category" } });

    await waitFor(() => {
      const firstCard = container.querySelector("article");
      expect(firstCard?.textContent).toContain("Weekly standup audio"); // Audio comes first alphabetically
    });
  });

  it("handles tag add/remove errors", async () => {
    vi.mocked(addTagsToMessage).mockRejectedValue(new Error("Tag add failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.startsWith("+ #"));
    if (addButtons.length > 0) {
      fireEvent.click(addButtons[0]);
    }

    await waitFor(() => {
      expect(screen.getByText("Tag add failed.")).toBeInTheDocument();
    });
  });

  it("handles create tag error", async () => {
    vi.mocked(createTag).mockRejectedValue(new Error("Create tag failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("e.g. read-later");
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => {
      expect(screen.getByText("Create tag failed.")).toBeInTheDocument();
    });
  });

  it("handles remove tag error", async () => {
    vi.mocked(removeTagFromMessage).mockRejectedValue(new Error("Remove tag failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage tags" }));

    await waitFor(() => {
      expect(screen.getByText("Manage tags")).toBeInTheDocument();
    });

    const removeBtns = screen.getAllByTitle("Remove tag");
    if (removeBtns.length > 0) {
      fireEvent.click(removeBtns[0]);
    }

    await waitFor(() => {
      expect(screen.getByText("Remove tag failed.")).toBeInTheDocument();
    });
  });

  it("handles bulk move error", async () => {
    vi.mocked(bulkMoveMessages).mockRejectedValue(new Error("Bulk move failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Move selected" }));

    await waitFor(() => {
      expect(screen.getByText("Bulk move failed.")).toBeInTheDocument();
    });
  });

  it("handles bulk delete error", async () => {
    vi.mocked(bulkDeleteMessages).mockRejectedValue(new Error("Bulk delete failed."));

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(screen.getByText("Bulk delete failed.")).toBeInTheDocument();
    });
  });

  it("opens detail from card menu 'View details'", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    const menuButtons = screen.getAllByRole("button", { name: "Message actions" });
    fireEvent.click(menuButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("closes detail dialog", async () => {
    renderMessagesPage();
    await screen.findByText("3 messages");

    // Open detail
    const viewButtons = screen.getAllByRole("button", { name: "View full message" });
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Close via escape
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("cancels bulk delete when user declines", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderMessagesPage();
    await screen.findByText("3 messages");

    fireEvent.click(screen.getByRole("button", { name: "Bulk select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(bulkDeleteMessages).not.toHaveBeenCalled();
  });
});

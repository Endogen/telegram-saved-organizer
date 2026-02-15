import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkDeleteMessages,
  bulkMoveMessages,
  deleteMessage,
  listMessages,
  moveMessageToCategory,
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
    await screen.findByText("Showing 3 of 3 messages.");

    fireEvent.change(screen.getByPlaceholderText("Search by text, URL, sender, or tag..."), {
      target: { value: "react" },
    });

    expect(screen.getByText("Showing 1 of 3 messages.")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Backend checklist")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByText("Showing 3 of 3 messages.")).toBeInTheDocument();
    expect(screen.getByText("Backend checklist")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();
  });

  it("applies category and tag filters from controls", async () => {
    renderMessagesPage("/messages?category=links");
    await screen.findByText("Showing 1 of 3 messages.");

    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.queryByText("Backend checklist")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "" } });
    expect(screen.getByText("Showing 3 of 3 messages.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /#frontend/i }));
    expect(screen.getByText("Showing 2 of 3 messages.")).toBeInTheDocument();
    expect(screen.getByText("React animation reference")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /#meeting/i }));
    expect(screen.getByText("Showing 1 of 3 messages.")).toBeInTheDocument();
    expect(screen.getByText("Weekly standup audio")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("React animation reference")).not.toBeInTheDocument();
    });
  });

  it("reorders visible cards when sort option changes", async () => {
    const { container } = renderMessagesPage();
    await screen.findByText("Showing 3 of 3 messages.");

    const firstCardText = () => container.querySelector("article")?.textContent ?? "";
    expect(firstCardText()).toContain("Backend checklist");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "sender" } });

    await waitFor(() => {
      expect(firstCardText()).toContain("React animation reference");
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkDeleteMessages,
  bulkMoveMessages,
  deleteMessage,
  listMessages,
  moveMessageToCategory,
} from "@/api/messages";
import type { MessageListItem, MessageListResponse } from "@/types/message";

function createMessage(id: number): MessageListItem {
  return {
    id,
    telegram_id: id + 1000,
    content: `Message ${id}`,
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
  };
}

function createListPayload(items: MessageListItem[]): MessageListResponse {
  return {
    items,
    total: items.length,
    page: 1,
    per_page: 50,
  };
}

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe("messages api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the list query string and validates the response payload", async () => {
    const payload = createListPayload([createMessage(1)]);
    fetchMock.mockResolvedValue(createResponse(payload));

    const result = await listMessages({
      page: 0,
      per_page: 4.8,
      sort: "date_desc",
      category: " links ",
      search: "  release notes ",
      tag: [" frontend ", "", "release"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/messages?page=1&per_page=4&sort=date_desc&category=links&search=release+notes&tag=frontend&tag=release",
      { credentials: "same-origin" },
    );
    expect(result).toEqual(payload);
  });

  it("throws when the list response shape is unexpected", async () => {
    fetchMock.mockResolvedValue(createResponse({ items: [] }));

    await expect(listMessages()).rejects.toThrow("Unexpected messages payload.");
  });

  it("surfaces error detail and falls back when detail is missing", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ detail: "No messages available." }, false));
    await expect(listMessages()).rejects.toThrow("No messages available.");

    fetchMock.mockResolvedValueOnce(createResponse({}, false));
    await expect(listMessages()).rejects.toThrow("Message request failed.");
  });

  it("sends patch and delete requests for single-message actions", async () => {
    const updated = createMessage(9);
    fetchMock.mockResolvedValueOnce(createResponse(updated));

    const moveResult = await moveMessageToCategory(9, 3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/messages/9",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ category_id: 3 }),
      }),
    );
    expect(moveResult).toEqual(updated);

    fetchMock.mockResolvedValueOnce(createResponse({ deleted: true }));
    await deleteMessage(9);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/messages/9",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends payloads for bulk operations", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ deleted_count: 2 }));
    const deleteResult = await bulkDeleteMessages([1, 2]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/messages/bulk-delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message_ids: [1, 2] }),
      }),
    );
    expect(deleteResult).toEqual({ deleted_count: 2 });

    fetchMock.mockResolvedValueOnce(createResponse({ moved_count: 2, category_id: 4 }));
    const moveResult = await bulkMoveMessages([1, 2], 4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/messages/bulk-move",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message_ids: [1, 2], category_id: 4 }),
      }),
    );
    expect(moveResult).toEqual({ moved_count: 2, category_id: 4 });
  });
});

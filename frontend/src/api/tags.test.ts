import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addTagsToMessage,
  createTag,
  deleteTag,
  listManagedTags,
  listTags,
  removeTagFromMessage,
  updateTag,
} from "@/api/tags";
import type { MessageTag } from "@/types/message";

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe("tags api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists tags", async () => {
    const payload: MessageTag[] = [{ id: 1, name: "frontend", color: "#0EA5E9" }];
    fetchMock.mockResolvedValue(createResponse(payload));

    await expect(listTags()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/tags", { credentials: "same-origin" });
  });

  it("lists tags with management counts", async () => {
    const payload = [{ id: 1, name: "frontend", color: "#0EA5E9", message_count: 4 }];
    fetchMock.mockResolvedValue(createResponse(payload));

    await expect(listManagedTags()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/tags", { credentials: "same-origin" });
  });

  it("normalizes the create-tag payload and validates required input", async () => {
    fetchMock.mockResolvedValue(createResponse({ id: 2, name: "release notes", color: null }));

    const result = await createTag({ name: "   release   notes   ", color: undefined });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "release notes", color: null }),
      }),
    );
    expect(result).toEqual({ id: 2, name: "release notes", color: null });

    await expect(createTag({ name: "   " })).rejects.toThrow("Tag name is required.");
  });

  it("deduplicates and sanitizes tag ids when attaching tags to a message", async () => {
    fetchMock.mockResolvedValue(
      createResponse({
        message_id: 42,
        tags: [{ id: 1, name: "frontend", color: null }],
      }),
    );

    const result = await addTagsToMessage(42, [1, 1, 2.9, 0, -3]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/messages/42/tags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tag_ids: [1, 2] }),
      }),
    );
    expect(result).toEqual([{ id: 1, name: "frontend", color: null }]);
  });

  it("requires at least one valid tag id for attach operations", async () => {
    await expect(addTagsToMessage(4, [0, -1])).rejects.toThrow("At least one tag id is required.");
  });

  it("updates and deletes tags", async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse({ id: 2, name: "reading", color: null }))
      .mockResolvedValueOnce(createResponse({ deleted: true }));

    await updateTag(2, { name: "  reading  ", color: null });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/tags/2", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "reading", color: null }),
    }));

    await expect(deleteTag(2)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/tags/2", expect.objectContaining({ method: "DELETE" }));
  });

  it("removes a tag from a message and maps API errors", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        message_id: 9,
        tags: [{ id: 2, name: "backend", color: null }],
      }),
    );

    await expect(removeTagFromMessage(9, 5)).resolves.toEqual([{ id: 2, name: "backend", color: null }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/messages/9/tags/5",
      expect.objectContaining({ method: "DELETE" }),
    );

    fetchMock.mockResolvedValueOnce(createResponse({ detail: "Tag not found." }, false));
    await expect(removeTagFromMessage(9, 5)).rejects.toThrow("Tag not found.");

    fetchMock.mockResolvedValueOnce(createResponse({}, false));
    await expect(removeTagFromMessage(9, 5)).rejects.toThrow("Tag request failed.");
  });
});

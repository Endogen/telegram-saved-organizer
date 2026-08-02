import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCategory, deleteCategory, updateCategory } from "@/api/categories";

function response(payload: unknown): Response {
  return { ok: true, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

describe("categories api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("normalizes and creates a category", async () => {
    fetchMock.mockResolvedValue(response({ id: 9, name: "Read later" }));

    await createCategory({
      name: "  Read   later ",
      icon: " bookmark ",
      color: "#22c55e",
      position: 9.8,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/categories", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Read later", icon: "bookmark", color: "#22C55E", position: 9 }),
    }));
  });

  it("updates and deletes a category", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ id: 9, name: "Reading" }))
      .mockResolvedValueOnce(response({ deleted: true, moved_message_count: 2, destination_category_id: 8 }));

    await updateCategory(9, { name: "Reading", icon: "bookmark", color: "#2563EB", position: 10 });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/categories/9", expect.objectContaining({ method: "PATCH" }));

    await expect(deleteCategory(9)).resolves.toEqual({
      deleted: true,
      moved_message_count: 2,
      destination_category_id: 8,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/categories/9", expect.objectContaining({ method: "DELETE" }));
  });

  it("rejects invalid local input before requesting", async () => {
    await expect(createCategory({ name: " ", icon: "folder", color: "#22C55E", position: 1 }))
      .rejects.toThrow("Category name is required.");
    await expect(createCategory({ name: "Valid", icon: "folder", color: "green", position: 1 }))
      .rejects.toThrow("Enter a valid six-digit hex color.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

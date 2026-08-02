import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/categories", () => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategories: vi.fn(),
  notifyCategoriesChanged: vi.fn(),
}));

import { createCategory, deleteCategory, updateCategory } from "@/api/categories";
import { notifyCategoriesChanged, useCategories } from "@/hooks/use-categories";
import { CategoriesPage } from "@/pages/categories-page";

const categories = [
  {
    id: 3,
    name: "Links",
    slug: "links",
    icon: "link",
    color: "#0EA5E9",
    position: 3,
    is_default: true,
    message_count: 4,
  },
  {
    id: 9,
    name: "Read later",
    slug: "read-later",
    icon: "bookmark",
    color: "#22C55E",
    position: 9,
    is_default: false,
    message_count: 2,
  },
];

describe("CategoriesPage", () => {
  beforeEach(() => {
    vi.mocked(createCategory).mockReset();
    vi.mocked(updateCategory).mockReset();
    vi.mocked(deleteCategory).mockReset();
    vi.mocked(notifyCategoriesChanged).mockReset();
    vi.mocked(useCategories).mockReturnValue({
      categories,
      isLoading: false,
      isFallback: false,
      error: null,
    });
    vi.mocked(createCategory).mockResolvedValue({ ...categories[1], id: 10, slug: "research", name: "Research" });
    vi.mocked(updateCategory).mockResolvedValue({ ...categories[1], name: "Reading", slug: "reading" });
    vi.mocked(deleteCategory).mockResolvedValue({ deleted: true, moved_message_count: 2, destination_category_id: 8 });
  });

  function renderPage() {
    return render(<MemoryRouter><CategoriesPage /></MemoryRouter>);
  }

  it("shows category metadata and protects built-in categories", () => {
    renderPage();

    expect(screen.getByText("4 messages · Order 3 · /links")).toBeInTheDocument();
    expect(screen.getByText("2 messages · Order 9 · /read-later")).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeEnabled();
  });

  it("creates a category from the dedicated dialog", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New category" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({
      name: "Research",
      icon: "message-square",
      color: "#0F766E",
      position: 10,
    }));
    expect(await screen.findByText("Created “Research”.")).toBeInTheDocument();
    expect(notifyCategoriesChanged).toHaveBeenCalledTimes(1);
  });

  it("edits and deletes a custom category with explicit confirmation", async () => {
    renderPage();
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[1]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Reading" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith(9, expect.objectContaining({ name: "Reading" })));
    await waitFor(() => expect(document.body.firstElementChild).not.toHaveAttribute("aria-hidden"));

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(screen.getByText("2 messages will be moved to Other. This category itself cannot be recovered.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));

    await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith(9));
    expect(await screen.findByText("Deleted “Read later”. 2 messages moved to Other.")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/tags", () => ({
  listManagedTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

import { createTag, deleteTag, listManagedTags, updateTag } from "@/api/tags";
import { TagsPage } from "@/pages/tags-page";

const tags = [
  { id: 1, name: "frontend", color: "#0EA5E9", message_count: 4 },
  { id: 2, name: "urgent", color: null, message_count: 1 },
];

describe("TagsPage", () => {
  beforeEach(() => {
    vi.mocked(listManagedTags).mockReset();
    vi.mocked(createTag).mockReset();
    vi.mocked(updateTag).mockReset();
    vi.mocked(deleteTag).mockReset();
    vi.mocked(listManagedTags).mockResolvedValue(tags);
    vi.mocked(createTag).mockResolvedValue({ id: 3, name: "research", color: "#0EA5E9" });
    vi.mocked(updateTag).mockResolvedValue({ id: 1, name: "web", color: null });
    vi.mocked(deleteTag).mockResolvedValue(undefined);
  });

  it("loads reusable tags with global assignment counts", async () => {
    render(<TagsPage />);

    expect(await screen.findByText("#frontend")).toBeInTheDocument();
    expect(screen.getByText("4 messages")).toBeInTheDocument();
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });

  it("creates and edits a tag", async () => {
    render(<TagsPage />);
    await screen.findByText("#frontend");

    fireEvent.click(screen.getByRole("button", { name: "New tag" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    await waitFor(() => expect(createTag).toHaveBeenCalledWith({ name: "research", color: "#0EA5E9" }));
    expect(await screen.findByText("#research")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit #frontend" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "web" } });
    fireEvent.click(screen.getByLabelText("Use a custom color"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateTag).toHaveBeenCalledWith(1, { name: "web", color: null }));
    expect(await screen.findByText("#web")).toBeInTheDocument();
  });

  it("deletes a tag without deleting its messages", async () => {
    render(<TagsPage />);
    await screen.findByText("#frontend");

    fireEvent.click(screen.getByRole("button", { name: "Delete #frontend" }));
    expect(screen.getByText("This tag will be removed from 4 messages. Messages themselves will not be deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));

    await waitFor(() => expect(deleteTag).toHaveBeenCalledWith(1));
    expect(screen.queryByText("#frontend")).not.toBeInTheDocument();
    expect(screen.getByText("Deleted #frontend and removed it from 4 messages.")).toBeInTheDocument();
  });
});

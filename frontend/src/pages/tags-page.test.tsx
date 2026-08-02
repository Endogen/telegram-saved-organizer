import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/tags", () => ({
  listManagedTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

import { createTag, deleteTag, listManagedTags, updateTag } from "@/api/tags";
import { notifyOrganizationChanged } from "@/lib/organization-events";
import { TagsPage } from "@/pages/tags-page";

const tags = [
  { id: 1, name: "frontend", color: "#0EA5E9", message_count: 4 },
  { id: 2, name: "urgent", color: null, message_count: 1 },
];

function renderPage() {
  return render(<MemoryRouter><TagsPage /></MemoryRouter>);
}

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
    renderPage();

    expect(await screen.findByText("#frontend")).toBeInTheDocument();
    expect(screen.getByText("4 messages")).toBeInTheDocument();
    expect(screen.getByText("1 message")).toBeInTheDocument();
    const coloredTag = screen.getByText("#frontend").parentElement;
    expect(coloredTag).toHaveClass("bg-[hsl(var(--muted))]", "text-[hsl(var(--foreground))]");
    expect(coloredTag).not.toHaveStyle({ color: tags[0].color });
    expect(coloredTag).not.toHaveStyle({ backgroundColor: `${tags[0].color}14` });
    expect(coloredTag?.querySelector("svg")).toHaveStyle({ color: tags[0].color });
  });

  it("creates and edits a tag", async () => {
    renderPage();
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
    renderPage();
    await screen.findByText("#frontend");

    fireEvent.click(screen.getByRole("button", { name: "Delete #frontend" }));
    expect(screen.getByText("This tag will be removed from 4 messages. Messages themselves will not be deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));

    await waitFor(() => expect(deleteTag).toHaveBeenCalledWith(1));
    expect(screen.queryByText("#frontend")).not.toBeInTheDocument();
    expect(screen.getByText("Deleted #frontend and removed it from 4 messages.")).toBeInTheDocument();
  });

  it("links each tag to its filtered message library", async () => {
    renderPage();
    await screen.findByText("#frontend");

    expect(screen.getByRole("link", { name: "View messages tagged #frontend" }))
      .toHaveAttribute("href", "/messages?tag=frontend");
    expect(screen.getByRole("link", { name: "View messages tagged #urgent" }))
      .toHaveAttribute("href", "/messages?tag=urgent");
  });

  it("refreshes assignment counts when tags change in another view", async () => {
    vi.mocked(listManagedTags)
      .mockResolvedValueOnce(tags)
      .mockResolvedValueOnce([{ ...tags[0], message_count: 7 }, tags[1]]);
    renderPage();
    await screen.findByText("4 messages");

    act(() => notifyOrganizationChanged("tags"));

    expect(await screen.findByText("7 messages")).toBeInTheDocument();
    expect(listManagedTags).toHaveBeenCalledTimes(2);
  });
});

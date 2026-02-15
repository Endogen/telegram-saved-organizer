import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Archive, FolderKanban } from "lucide-react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Sidebar, type SidebarPrimaryItem } from "@/components/layout/sidebar";
import {
  MESSAGE_DRAG_END_EVENT,
  MESSAGE_DRAG_START_EVENT,
  MESSAGE_DROP_TO_CATEGORY_EVENT,
  readMessageDropToCategoryEvent,
} from "@/lib/message-drag-events";

const items: SidebarPrimaryItem[] = [
  { to: "/", label: "Dashboard", icon: FolderKanban, end: true },
  { to: "/messages", label: "Messages", icon: Archive },
];

const categories = [
  {
    id: 1,
    name: "General",
    slug: "general",
    icon: "message-square",
    color: "#0f766e",
    position: 0,
    is_default: true,
    message_count: 3,
  },
  {
    id: 2,
    name: "Links",
    slug: "links",
    icon: "link",
    color: "#0284c7",
    position: 1,
    is_default: true,
    message_count: 4,
  },
];

function renderSidebar(
  overrides: Partial<ComponentProps<typeof Sidebar>> = {},
  initialEntry = "/messages?category=links",
): ComponentProps<typeof Sidebar> {
  const props: ComponentProps<typeof Sidebar> = {
    items,
    categories,
    isCategoriesLoading: false,
    isCategoriesFallback: false,
    categoriesError: null,
    isOpen: true,
    onClose: vi.fn(),
    ...overrides,
  };

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Sidebar {...props} />
    </MemoryRouter>,
  );

  return props;
}

describe("Sidebar", () => {
  it("renders navigation and category counts", () => {
    const props = renderSidebar();

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();

    const allMessagesLink = screen.getByRole("link", { name: /All Messages/ });
    expect(within(allMessagesLink).getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /General/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Links/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Messages" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows loading, empty, and fallback category states", () => {
    renderSidebar({ isCategoriesLoading: true });
    expect(screen.getByText("Syncing")).toBeInTheDocument();

    renderSidebar({ categories: [], isCategoriesLoading: false, isCategoriesFallback: true, categoriesError: "API unavailable" });
    expect(screen.getByText("No categories available.")).toBeInTheDocument();
    expect(screen.getByText("Using fallback categories.")).toBeInTheDocument();
    expect(screen.getByText("API unavailable")).toBeInTheDocument();
  });

  it("emits drop events when a dragged message is dropped onto another category", () => {
    const onDropEvent = vi.fn<(event: Event) => void>();
    const onDragEndEvent = vi.fn<(event: Event) => void>();

    window.addEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, onDropEvent as EventListener);
    window.addEventListener(MESSAGE_DRAG_END_EVENT, onDragEndEvent as EventListener);

    try {
      renderSidebar();

      act(() => {
        window.dispatchEvent(new CustomEvent(MESSAGE_DRAG_START_EVENT, { detail: { messageId: 901, categoryId: 1 } }));
      });
      expect(screen.getByText("Drop a message on a category to move it.")).toBeInTheDocument();

      const targetCategoryLink = screen.getByRole("link", { name: /Links/ });
      const dataTransfer = {
        getData: (key: string) => (key === "application/x-saved-message-id" ? "901" : ""),
      } as DataTransfer;

      fireEvent.drop(targetCategoryLink, { dataTransfer });

      expect(onDropEvent).toHaveBeenCalledTimes(1);
      const [dropEvent] = onDropEvent.mock.calls[0];
      expect(readMessageDropToCategoryEvent(dropEvent)).toEqual({ messageId: 901, categoryId: 2 });
      expect(onDragEndEvent).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, onDropEvent as EventListener);
      window.removeEventListener(MESSAGE_DRAG_END_EVENT, onDragEndEvent as EventListener);
    }
  });
});

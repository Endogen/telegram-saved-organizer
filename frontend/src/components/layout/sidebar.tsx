import { type DragEvent, useEffect, useState } from "react";
import {
  Archive,
  Code2,
  FileText,
  FolderKanban,
  ImageIcon,
  Link2,
  MessageSquareText,
  Music2,
  type LucideIcon,
  Video,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import {
  announceMessageDragEnd,
  announceMessageDropToCategory,
  getDraggedMessageId,
  MESSAGE_DRAG_END_EVENT,
  MESSAGE_DRAG_START_EVENT,
  readMessageDragStartEvent,
  type MessageDragStartDetail,
} from "@/lib/message-drag-events";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import type { CategoryWithCount } from "@/types/category";

export type SidebarPrimaryItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

type SidebarProps = {
  items: SidebarPrimaryItem[];
  categories: CategoryWithCount[];
  isCategoriesLoading: boolean;
  isCategoriesFallback: boolean;
  categoriesError: string | null;
  isOpen: boolean;
  onClose: () => void;
};

const categoryIconMap: Record<string, LucideIcon> = {
  video: Video,
  music: Music2,
  link: Link2,
  code: Code2,
  image: ImageIcon,
  "file-text": FileText,
  "message-square": MessageSquareText,
  archive: Archive,
};

function resolveCategoryIcon(iconName: string): LucideIcon {
  return categoryIconMap[iconName.toLowerCase()] ?? FolderKanban;
}

function navItemClassName(isActive: boolean): string {
  return cn(
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
  );
}

export function Sidebar({
  items,
  categories,
  isCategoriesLoading,
  isCategoriesFallback,
  categoriesError,
  isOpen,
  onClose,
}: SidebarProps) {
  const location = useLocation();
  const activeCategory =
    location.pathname.startsWith("/messages") ? new URLSearchParams(location.search).get("category") ?? "all" : null;
  const totalMessageCount = categories.reduce((sum, category) => sum + category.message_count, 0);
  const [activeDrag, setActiveDrag] = useState<MessageDragStartDetail | null>(null);
  const [dropCategoryId, setDropCategoryId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleDragStart(event: Event) {
      const detail = readMessageDragStartEvent(event);
      if (detail === null) {
        return;
      }
      setActiveDrag(detail);
    }

    function handleDragEnd() {
      setActiveDrag(null);
      setDropCategoryId(null);
    }

    window.addEventListener(MESSAGE_DRAG_START_EVENT, handleDragStart);
    window.addEventListener(MESSAGE_DRAG_END_EVENT, handleDragEnd);
    return () => {
      window.removeEventListener(MESSAGE_DRAG_START_EVENT, handleDragStart);
      window.removeEventListener(MESSAGE_DRAG_END_EVENT, handleDragEnd);
    };
  }, []);

  function handleCategoryDragOver(event: DragEvent<HTMLAnchorElement>, categoryId: number) {
    const messageId = getDraggedMessageId(event.dataTransfer);
    if (messageId === null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = activeDrag?.categoryId === categoryId ? "none" : "move";
    if (dropCategoryId !== categoryId) {
      setDropCategoryId(categoryId);
    }
  }

  function handleCategoryDragLeave(event: DragEvent<HTMLAnchorElement>, categoryId: number) {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget !== null && event.currentTarget.contains(nextTarget)) {
      return;
    }

    if (dropCategoryId === categoryId) {
      setDropCategoryId(null);
    }
  }

  function handleCategoryDrop(event: DragEvent<HTMLAnchorElement>, category: CategoryWithCount) {
    event.preventDefault();
    setDropCategoryId(null);

    const messageId = getDraggedMessageId(event.dataTransfer);
    if (messageId === null) {
      return;
    }

    if (activeDrag?.categoryId === category.id) {
      announceMessageDragEnd();
      return;
    }

    announceMessageDropToCategory({ messageId, categoryId: category.id });
    announceMessageDragEnd();
  }

  return (
    <>
      <AnimatePresence>
        {isOpen ? (
          <motion.button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-slate-950/40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
        ) : null}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 -translate-x-full flex-col border-r border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.95)] transition-transform duration-300 md:static md:z-0 md:w-64 md:translate-x-0 md:rounded-2xl md:border md:bg-[hsl(var(--card)/0.82)] md:shadow-sm md:backdrop-blur",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-[hsl(var(--border)/0.75)] px-4 py-4 md:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted-foreground))]">
            Workspace
          </p>
          <h2 className="mt-1 text-base font-semibold text-[hsl(var(--foreground))]">Saved Messages</h2>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 md:p-4">
          <div>
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Navigation
            </p>
            <div className="mt-2 space-y-1">
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => navItemClassName(isActive)} onClick={onClose}>
                  <Icon className="size-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between px-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                Categories
              </p>
              {isCategoriesLoading ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                  Syncing
                </span>
              ) : null}
            </div>

            <div className="mt-2 space-y-1">
              {isCategoriesLoading ? (
                <div className="space-y-2 rounded-lg border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--background)/0.55)] p-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-10/12" />
                </div>
              ) : (
                <>
                  <Link to="/messages" className={navItemClassName(activeCategory === "all")} onClick={onClose}>
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderKanban className="size-4 shrink-0" />
                      <span className="truncate">All Messages</span>
                    </span>
                    <span className="ml-auto rounded-full bg-[hsl(var(--background)/0.8)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                      {totalMessageCount}
                    </span>
                  </Link>

                  {categories.length > 0 ? (
                    categories.map((category) => {
                      const Icon = resolveCategoryIcon(category.icon);
                      const isActive = activeCategory === category.slug;
                      const isDropTarget = dropCategoryId === category.id;
                      const isDropBlocked = isDropTarget && activeDrag?.categoryId === category.id;

                      return (
                        <Link
                          key={category.id}
                          to={`/messages?category=${encodeURIComponent(category.slug)}`}
                          className={cn(
                            navItemClassName(isActive),
                            isDropTarget && !isDropBlocked && "ring-2 ring-[hsl(var(--primary)/0.5)] ring-offset-1",
                            isDropTarget && isDropBlocked && "ring-2 ring-red-500/45 ring-offset-1",
                          )}
                          onClick={onClose}
                          onDragOver={(event) => handleCategoryDragOver(event, category.id)}
                          onDragLeave={(event) => handleCategoryDragLeave(event, category.id)}
                          onDrop={(event) => handleCategoryDrop(event, category)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon className="size-4 shrink-0" style={{ color: category.color }} />
                            <span className="truncate">{category.name}</span>
                          </span>
                          <span className="ml-auto rounded-full bg-[hsl(var(--background)/0.8)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                            {category.message_count}
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <StatePanel
                      title="No categories available."
                      description="Run a scan to seed categories and message counts."
                      className="text-xs"
                    />
                  )}
                </>
              )}
            </div>

            {!isCategoriesLoading && isCategoriesFallback && categoriesError ? (
              <StatePanel
                tone="warning"
                title="Using fallback categories."
                description={categoriesError}
                className="mt-2 text-xs"
              />
            ) : null}

            {activeDrag !== null ? (
              <p className="mt-2 rounded-md border border-[hsl(var(--primary)/0.25)] bg-[hsl(var(--primary)/0.1)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--primary))]">
                Drop a message on a category to move it.
              </p>
            ) : null}
          </div>
        </nav>
      </aside>
    </>
  );
}

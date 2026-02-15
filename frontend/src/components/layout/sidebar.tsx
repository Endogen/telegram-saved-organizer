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

import { cn } from "@/lib/utils";
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

export function Sidebar({ items, categories, isCategoriesLoading, isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const activeCategory =
    location.pathname.startsWith("/messages") ? new URLSearchParams(location.search).get("category") ?? "all" : null;
  const totalMessageCount = categories.reduce((sum, category) => sum + category.message_count, 0);

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
              <Link to="/messages" className={navItemClassName(activeCategory === "all")} onClick={onClose}>
                <span className="flex min-w-0 items-center gap-2">
                  <FolderKanban className="size-4 shrink-0" />
                  <span className="truncate">All Messages</span>
                </span>
                <span className="ml-auto rounded-full bg-[hsl(var(--background)/0.8)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                  {totalMessageCount}
                </span>
              </Link>

              {categories.map((category) => {
                const Icon = resolveCategoryIcon(category.icon);
                const isActive = activeCategory === category.slug;

                return (
                  <Link
                    key={category.id}
                    to={`/messages?category=${encodeURIComponent(category.slug)}`}
                    className={navItemClassName(isActive)}
                    onClick={onClose}
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
              })}
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { FolderKanban, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { useUiStore } from "@/stores/ui-store";

const sampleMessages = [
  {
    id: 1,
    preview: "FastAPI async patterns and testing notes.",
    category: "Text",
    categorySlug: "text",
    date: "Today",
  },
  {
    id: 2,
    preview: "https://github.com/telethon/telethon release highlights",
    category: "Repositories",
    categorySlug: "repositories",
    date: "Yesterday",
  },
  {
    id: 3,
    preview: "Voice memo from design sync and action items.",
    category: "Audio",
    categorySlug: "audio",
    date: "2 days ago",
  },
];

function formatCategoryFilter(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function MessagesPage() {
  const [searchParams] = useSearchParams();
  const searchQuery = useUiStore((state) => state.searchQuery);
  const setSearchQuery = useUiStore((state) => state.setSearchQuery);
  const categoryFilter = searchParams.get("category")?.trim().toLowerCase() ?? "";

  const filtered = sampleMessages.filter((message) => {
    const matchesSearch = message.preview.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const matchesCategory = categoryFilter.length === 0 || message.categorySlug === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Messages</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Starter message grid with layout, enter/exit, and hover animations.
            {categoryFilter.length > 0 ? ` Active category: ${formatCategoryFilter(categoryFilter)}.` : ""}
          </p>
        </div>

        <label className="relative block w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search messages..."
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </label>
      </div>

      <motion.div layout className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence>
          {filtered.map((message) => (
            <motion.article
              key={message.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              whileHover={{ y: -4, transition: { duration: 0.15 } }}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.95)] p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary)/0.16)] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--primary))]">
                  <FolderKanban className="size-3.5" />
                  {message.category}
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{message.date}</span>
              </div>
              <p className="mt-3 text-sm text-[hsl(var(--foreground))]">{message.preview}</p>
            </motion.article>
          ))}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.7)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
          No messages match the current search and category filter.
        </p>
      ) : null}
    </section>
  );
}

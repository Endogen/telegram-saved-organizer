import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { MessageGrid } from "@/components/messages/message-grid";
import { Button } from "@/components/ui/button";
import type { MessageListItem } from "@/types/message";

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const sampleMessages: MessageListItem[] = [
  {
    id: 1,
    telegram_id: 1401,
    content:
      "FastAPI async endpoint checklist: use AsyncSession dependencies, ASGITransport in tests, and avoid sync threadpool deps in this sandbox.",
    media_type: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    url: null,
    sender_name: "Saved Messages",
    date: isoHoursAgo(2),
    category_id: 7,
    raw_data: {},
    created_at: isoHoursAgo(2),
    updated_at: isoHoursAgo(2),
    category: {
      id: 7,
      name: "Text",
      slug: "text",
      icon: "message-square",
      color: "#6B7280",
    },
    tags: [
      { id: 1, name: "backend", color: "#0EA5E9" },
      { id: 2, name: "tests", color: "#10B981" },
    ],
  },
  {
    id: 2,
    telegram_id: 1402,
    content: "Telethon 1.42 release notes and migration tips.",
    media_type: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    url: "https://github.com/LonamiWebs/Telethon/releases",
    sender_name: "Saved Messages",
    date: isoHoursAgo(20),
    category_id: 4,
    raw_data: {},
    created_at: isoHoursAgo(20),
    updated_at: isoHoursAgo(20),
    category: {
      id: 4,
      name: "Repositories",
      slug: "repositories",
      icon: "code",
      color: "#4F46E5",
    },
    tags: [
      { id: 3, name: "telegram", color: "#8B5CF6" },
      { id: 4, name: "release", color: null },
    ],
  },
  {
    id: 3,
    telegram_id: 1403,
    content: null,
    media_type: "audio/ogg",
    file_name: "standup-notes.ogg",
    file_size: 280194,
    mime_type: "audio/ogg",
    url: null,
    sender_name: "Saved Messages",
    date: isoHoursAgo(52),
    category_id: 2,
    raw_data: {},
    created_at: isoHoursAgo(52),
    updated_at: isoHoursAgo(52),
    category: {
      id: 2,
      name: "Audio",
      slug: "audio",
      icon: "music",
      color: "#2563EB",
    },
    tags: [{ id: 5, name: "meeting", color: "#F59E0B" }],
  },
  {
    id: 4,
    telegram_id: 1404,
    content: "UI motion references for card grid enter/exit and drag affordances.",
    media_type: "document",
    file_name: "motion-notes.pdf",
    file_size: 481023,
    mime_type: "application/pdf",
    url: "https://motion.dev/docs",
    sender_name: "Saved Messages",
    date: isoHoursAgo(130),
    category_id: 6,
    raw_data: {},
    created_at: isoHoursAgo(130),
    updated_at: isoHoursAgo(130),
    category: {
      id: 6,
      name: "Documents",
      slug: "documents",
      icon: "file-text",
      color: "#F59E0B",
    },
    tags: [],
  },
];

function formatCategoryFilter(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type SortOption = "date_desc" | "date_asc" | "category" | "sender";

const sortOptions: { value: SortOption; label: string }[] = [
  { value: "date_desc", label: "Date (newest)" },
  { value: "date_asc", label: "Date (oldest)" },
  { value: "category", label: "Category" },
  { value: "sender", label: "Sender" },
];

type TagFilterOption = {
  key: string;
  label: string;
  count: number;
};

function compareByDate(first: MessageListItem, second: MessageListItem): number {
  const firstTimestamp = Date.parse(first.date);
  const secondTimestamp = Date.parse(second.date);
  const safeFirst = Number.isNaN(firstTimestamp) ? 0 : firstTimestamp;
  const safeSecond = Number.isNaN(secondTimestamp) ? 0 : secondTimestamp;
  return safeSecond - safeFirst;
}

export function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const categoryFilter = searchParams.get("category")?.trim().toLowerCase() ?? "";

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const availableCategories = useMemo(() => {
    const categoryBySlug = new Map<string, string>();

    for (const message of sampleMessages) {
      if (!categoryBySlug.has(message.category.slug)) {
        categoryBySlug.set(message.category.slug, message.category.name);
      }
    }

    return [...categoryBySlug.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, []);

  const availableTags = useMemo(() => {
    const tagMap = new Map<string, TagFilterOption>();

    for (const message of sampleMessages) {
      for (const tag of message.tags) {
        const key = tag.name.trim().toLowerCase();
        if (key.length === 0) {
          continue;
        }

        const existing = tagMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          tagMap.set(key, { key, label: tag.name, count: 1 });
        }
      }
    }

    return [...tagMap.values()].sort((first, second) => first.label.localeCompare(second.label));
  }, []);

  const filteredAndSorted = useMemo(() => {
    const filtered = sampleMessages.filter((message) => {
      const searchableContent = [
        message.content ?? "",
        message.url ?? "",
        message.sender_name ?? "",
        message.tags.map((tag) => tag.name).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      const messageTags = new Set(message.tags.map((tag) => tag.name.trim().toLowerCase()));
      const matchesSearch = searchableContent.includes(normalizedSearchQuery);
      const matchesCategory = categoryFilter.length === 0 || message.category.slug === categoryFilter;
      const matchesTags =
        selectedTagFilters.length === 0 || selectedTagFilters.every((tagFilter) => messageTags.has(tagFilter));

      return matchesSearch && matchesCategory && matchesTags;
    });

    return filtered.sort((first, second) => {
      if (sortOption === "date_desc") {
        return compareByDate(first, second);
      }

      if (sortOption === "date_asc") {
        return compareByDate(second, first);
      }

      if (sortOption === "category") {
        const byCategory = first.category.name.localeCompare(second.category.name);
        if (byCategory !== 0) {
          return byCategory;
        }
        return compareByDate(first, second);
      }

      const firstSender = (first.sender_name ?? "").trim().toLowerCase();
      const secondSender = (second.sender_name ?? "").trim().toLowerCase();
      const bySender = firstSender.localeCompare(secondSender);
      if (bySender !== 0) {
        return bySender;
      }
      return compareByDate(first, second);
    });
  }, [categoryFilter, normalizedSearchQuery, selectedTagFilters, sortOption]);

  const hasActiveFilters =
    normalizedSearchQuery.length > 0 ||
    categoryFilter.length > 0 ||
    selectedTagFilters.length > 0 ||
    sortOption !== "date_desc";

  function setCategoryParam(nextCategory: string) {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextCategory.length === 0) {
      nextSearchParams.delete("category");
    } else {
      nextSearchParams.set("category", nextCategory);
    }

    setSearchParams(nextSearchParams);
  }

  function toggleTagFilter(tagKey: string) {
    setSelectedTagFilters((currentFilters) => {
      if (currentFilters.includes(tagKey)) {
        return currentFilters.filter((existingTag) => existingTag !== tagKey);
      }
      return [...currentFilters, tagKey];
    });
  }

  function clearFilters() {
    setSearchQuery("");
    setSelectedTagFilters([]);
    setSortOption("date_desc");
    setCategoryParam("");
  }

  return (
    <section>
      <div>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Messages</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Search by content, URL, sender, and tags. Layer filters to narrow down your Saved Messages quickly.
          {categoryFilter.length > 0 ? ` Active category: ${formatCategoryFilter(categoryFilter)}.` : ""}
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.72)] p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="relative block">
            <span className="sr-only">Search messages</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by text, URL, sender, or tag..."
              className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              Category
            </span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryParam(event.target.value.trim().toLowerCase())}
              className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            >
              <option value="">All categories</option>
              {availableCategories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              Sort
            </span>
            <select
              value={sortOption}
              onChange={(event) => setSortOption(event.target.value as SortOption)}
              className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {hasActiveFilters ? (
            <Button variant="outline" size="sm" className="h-10 gap-1.5 lg:self-end" onClick={clearFilters}>
              <X className="size-3.5" />
              Clear filters
            </Button>
          ) : (
            <div className="hidden lg:block" />
          )}
        </div>

        <div className="mt-3 rounded-lg border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--background)/0.75)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              Tag filter
            </p>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {selectedTagFilters.length} selected
            </span>
          </div>

          {availableTags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const isActive = selectedTagFilters.includes(tag.key);
                return (
                  <button
                    key={tag.key}
                    type="button"
                    onClick={() => toggleTagFilter(tag.key)}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/0.45)] hover:text-[hsl(var(--foreground))]",
                    ].join(" ")}
                  >
                    <span>#{tag.label}</span>
                    <span className="rounded-full bg-[hsl(var(--muted)/0.85)] px-1.5 py-0.5 text-[10px] leading-none">
                      {tag.count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">No tags available yet.</p>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
        Showing {filteredAndSorted.length} of {sampleMessages.length} messages.
      </p>

      <MessageGrid messages={filteredAndSorted} />

      {filteredAndSorted.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.7)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
          No messages match the current search and filter controls.
        </p>
      ) : null}
    </section>
  );
}

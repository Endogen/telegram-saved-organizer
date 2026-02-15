import { Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { MessageGrid } from "@/components/messages/message-grid";
import { useUiStore } from "@/stores/ui-store";
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

export function MessagesPage() {
  const [searchParams] = useSearchParams();
  const searchQuery = useUiStore((state) => state.searchQuery);
  const setSearchQuery = useUiStore((state) => state.setSearchQuery);
  const categoryFilter = searchParams.get("category")?.trim().toLowerCase() ?? "";

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filtered = sampleMessages.filter((message) => {
    const searchableContent = [
      message.content ?? "",
      message.url ?? "",
      message.sender_name ?? "",
      message.tags.map((tag) => tag.name).join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = searchableContent.includes(normalizedSearchQuery);
    const matchesCategory = categoryFilter.length === 0 || message.category.slug === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Messages</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Message cards now include category badges, preview text, relative dates, and tags.
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

      <MessageGrid messages={filtered} />

      {filtered.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.7)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
          No messages match the current search and category filter.
        </p>
      ) : null}
    </section>
  );
}

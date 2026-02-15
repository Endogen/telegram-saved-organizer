import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare2, Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  bulkDeleteMessages,
  bulkMoveMessages,
  deleteMessage,
  listMessages,
  moveMessageToCategory,
} from "@/api/messages";
import { addTagsToMessage, createTag, listTags, removeTagFromMessage } from "@/api/tags";
import { MoveDialog } from "@/components/categories/move-dialog";
import { BulkActions } from "@/components/messages/bulk-actions";
import { MessageGrid } from "@/components/messages/message-grid";
import { TagInputDialog } from "@/components/tags/tag-input";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-categories";
import { MESSAGE_DROP_TO_CATEGORY_EVENT, readMessageDropToCategoryEvent } from "@/lib/message-drag-events";
import type { CategoryWithCount } from "@/types/category";
import type { MessageListItem, MessageTag } from "@/types/message";

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

function compareByDate(first: MessageListItem, second: MessageListItem): number {
  const firstTimestamp = Date.parse(first.date);
  const secondTimestamp = Date.parse(second.date);
  const safeFirst = Number.isNaN(firstTimestamp) ? 0 : firstTimestamp;
  const safeSecond = Number.isNaN(secondTimestamp) ? 0 : secondTimestamp;
  return safeSecond - safeFirst;
}

function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase();
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function mergeTags(current: MessageTag[], incoming: MessageTag[]): MessageTag[] {
  const byId = new Map<number, MessageTag>();

  for (const tag of current) {
    byId.set(tag.id, tag);
  }
  for (const tag of incoming) {
    byId.set(tag.id, tag);
  }

  return [...byId.values()].sort((first, second) => first.name.localeCompare(second.name));
}

function deriveTagsFromMessages(messages: MessageListItem[]): MessageTag[] {
  return mergeTags(
    [],
    messages.flatMap((message) => message.tags),
  );
}

function deriveCategoriesFromMessages(messages: MessageListItem[]): CategoryWithCount[] {
  const byId = new Map<number, CategoryWithCount>();

  for (const message of messages) {
    const existing = byId.get(message.category.id);
    if (existing) {
      existing.message_count += 1;
      continue;
    }

    byId.set(message.category.id, {
      id: message.category.id,
      name: message.category.name,
      slug: message.category.slug,
      icon: message.category.icon,
      color: message.category.color,
      position: message.category.id,
      is_default: false,
      message_count: 1,
    });
  }

  return [...byId.values()].sort((first, second) => {
    if (first.position !== second.position) {
      return first.position - second.position;
    }
    return first.id - second.id;
  });
}

function createLocalTag(name: string, existingTags: MessageTag[]): MessageTag {
  const maxId = existingTags.reduce((currentMax, tag) => Math.max(currentMax, tag.id), 0);
  return { id: maxId + 1, name, color: null };
}

function localMoveMessage(
  messages: MessageListItem[],
  messageId: number,
  targetCategory: CategoryWithCount,
): MessageListItem[] {
  const now = new Date().toISOString();

  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return {
      ...message,
      category_id: targetCategory.id,
      category: {
        id: targetCategory.id,
        name: targetCategory.name,
        slug: targetCategory.slug,
        icon: targetCategory.icon,
        color: targetCategory.color,
      },
      updated_at: now,
    };
  });
}

function localMoveMessages(
  messages: MessageListItem[],
  messageIds: number[],
  targetCategory: CategoryWithCount,
): MessageListItem[] {
  const targetIds = new Set(messageIds);
  const now = new Date().toISOString();

  return messages.map((message) => {
    if (!targetIds.has(message.id)) {
      return message;
    }

    return {
      ...message,
      category_id: targetCategory.id,
      category: {
        id: targetCategory.id,
        name: targetCategory.name,
        slug: targetCategory.slug,
        icon: targetCategory.icon,
        color: targetCategory.color,
      },
      updated_at: now,
    };
  });
}

function localAddTag(messages: MessageListItem[], messageId: number, tag: MessageTag): MessageListItem[] {
  const now = new Date().toISOString();

  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    if (message.tags.some((currentTag) => currentTag.id === tag.id)) {
      return message;
    }

    return { ...message, tags: [...message.tags, tag], updated_at: now };
  });
}

function localRemoveTag(messages: MessageListItem[], messageId: number, tagId: number): MessageListItem[] {
  const now = new Date().toISOString();

  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return {
      ...message,
      tags: message.tags.filter((tag) => tag.id !== tagId),
      updated_at: now,
    };
  });
}

export function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<MessageListItem[]>(sampleMessages);
  const [knownTags, setKnownTags] = useState<MessageTag[]>(deriveTagsFromMessages(sampleMessages));
  const [isApiBackedData, setIsApiBackedData] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const [moveDialogMessageId, setMoveDialogMessageId] = useState<number | null>(null);
  const [tagDialogMessageId, setTagDialogMessageId] = useState<number | null>(null);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<number | null>(null);
  const [isMoveSubmitting, setIsMoveSubmitting] = useState(false);
  const [isTagSubmitting, setIsTagSubmitting] = useState(false);
  const [isBulkSelectionMode, setIsBulkSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const [bulkMoveCategoryId, setBulkMoveCategoryId] = useState<number | null>(null);
  const [bulkActionPending, setBulkActionPending] = useState<"move" | "delete" | null>(null);
  const [moveDialogError, setMoveDialogError] = useState<string | null>(null);
  const [tagDialogError, setTagDialogError] = useState<string | null>(null);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const { categories: fetchedCategories } = useCategories();
  const categoryFilter = searchParams.get("category")?.trim().toLowerCase() ?? "";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    let isCanceled = false;

    async function hydrateFromApi() {
      try {
        const messageResponse = await listMessages({ page: 1, per_page: 200, sort: "date_desc" });
        if (isCanceled) {
          return;
        }

        setMessages(messageResponse.items);
        setIsApiBackedData(true);
        setStatusMessage(null);

        try {
          const apiTags = await listTags();
          if (!isCanceled) {
            setKnownTags(mergeTags(apiTags, deriveTagsFromMessages(messageResponse.items)));
          }
        } catch {
          if (!isCanceled) {
            setKnownTags(deriveTagsFromMessages(messageResponse.items));
          }
        }
      } catch {
        if (isCanceled) {
          return;
        }

        setMessages(sampleMessages);
        setKnownTags(deriveTagsFromMessages(sampleMessages));
        setIsApiBackedData(false);
        setStatusMessage("API unavailable. Showing local sample messages with local-only actions.");
      }
    }

    void hydrateFromApi();

    return () => {
      isCanceled = true;
    };
  }, []);

  const actionCategories = useMemo(
    () => (fetchedCategories.length > 0 ? fetchedCategories : deriveCategoriesFromMessages(messages)),
    [fetchedCategories, messages],
  );

  useEffect(() => {
    if (actionCategories.length === 0) {
      setBulkMoveCategoryId(null);
      return;
    }

    setBulkMoveCategoryId((currentCategoryId) => {
      if (currentCategoryId !== null && actionCategories.some((category) => category.id === currentCategoryId)) {
        return currentCategoryId;
      }

      return actionCategories[0].id;
    });
  }, [actionCategories]);

  const availableCategories = useMemo(
    () =>
      [...actionCategories]
        .map((category) => ({ slug: category.slug, name: category.name }))
        .sort((first, second) => first.name.localeCompare(second.name)),
    [actionCategories],
  );

  const availableTags = useMemo(() => {
    const tagCounts = new Map<string, number>();

    for (const message of messages) {
      for (const tag of message.tags) {
        const key = normalizeTagKey(tag.name);
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
    }

    return mergeTags(knownTags, deriveTagsFromMessages(messages)).map((tag) => ({
      key: normalizeTagKey(tag.name),
      label: tag.name,
      count: tagCounts.get(normalizeTagKey(tag.name)) ?? 0,
      id: tag.id,
      color: tag.color,
    }));
  }, [knownTags, messages]);

  const filteredAndSorted = useMemo(() => {
    const filtered = messages.filter((message) => {
      const searchableContent = [
        message.content ?? "",
        message.url ?? "",
        message.sender_name ?? "",
        message.tags.map((tag) => tag.name).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      const messageTags = new Set(message.tags.map((tag) => normalizeTagKey(tag.name)));
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
  }, [categoryFilter, messages, normalizedSearchQuery, selectedTagFilters, sortOption]);

  useEffect(() => {
    if (!isBulkSelectionMode) {
      return;
    }

    const visibleIds = new Set(filteredAndSorted.map((message) => message.id));
    setSelectedMessageIds((currentIds) => {
      const nextIds = currentIds.filter((messageId) => visibleIds.has(messageId));
      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });
  }, [filteredAndSorted, isBulkSelectionMode]);

  useEffect(() => {
    if (isBulkSelectionMode) {
      return;
    }

    setSelectedMessageIds([]);
    setBulkActionError(null);
  }, [isBulkSelectionMode]);

  const activeMoveMessage = useMemo(
    () => messages.find((message) => message.id === moveDialogMessageId) ?? null,
    [messages, moveDialogMessageId],
  );
  const activeTagMessage = useMemo(
    () => messages.find((message) => message.id === tagDialogMessageId) ?? null,
    [messages, tagDialogMessageId],
  );

  useEffect(() => {
    if (moveDialogMessageId !== null && activeMoveMessage === null) {
      setMoveDialogMessageId(null);
    }
  }, [activeMoveMessage, moveDialogMessageId]);

  useEffect(() => {
    if (tagDialogMessageId !== null && activeTagMessage === null) {
      setTagDialogMessageId(null);
    }
  }, [activeTagMessage, tagDialogMessageId]);

  const hasActiveFilters =
    normalizedSearchQuery.length > 0 ||
    categoryFilter.length > 0 ||
    selectedTagFilters.length > 0 ||
    sortOption !== "date_desc";

  const moveSingleMessageToCategory = useCallback(
    async (messageId: number, categoryId: number) => {
      if (isApiBackedData) {
        const updatedMessage = await moveMessageToCategory(messageId, categoryId);
        setMessages((currentMessages) =>
          currentMessages.map((message) => (message.id === messageId ? updatedMessage : message)),
        );
        return;
      }

      const targetCategory = actionCategories.find((category) => category.id === categoryId);
      if (!targetCategory) {
        throw new Error("Selected category was not found.");
      }

      setMessages((currentMessages) => localMoveMessage(currentMessages, messageId, targetCategory));
    },
    [actionCategories, isApiBackedData],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleDropToCategory(event: Event) {
      const detail = readMessageDropToCategoryEvent(event);
      if (detail === null) {
        return;
      }

      const targetMessage = messages.find((message) => message.id === detail.messageId);
      if (targetMessage === undefined || targetMessage.category_id === detail.categoryId) {
        return;
      }

      setPageError(null);
      void moveSingleMessageToCategory(detail.messageId, detail.categoryId).catch((error) => {
        setPageError(toErrorMessage(error, "Unable to move this message right now."));
      });
    }

    window.addEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, handleDropToCategory);
    return () => {
      window.removeEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, handleDropToCategory);
    };
  }, [messages, moveSingleMessageToCategory]);

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

  function activateBulkSelectionMode() {
    setBulkActionError(null);
    setIsBulkSelectionMode(true);
  }

  function exitBulkSelectionMode() {
    setIsBulkSelectionMode(false);
  }

  function handleMessageSelectionChange(message: MessageListItem, isSelected: boolean) {
    setBulkActionError(null);

    if (isSelected) {
      setIsBulkSelectionMode(true);
    }

    setSelectedMessageIds((currentIds) => {
      if (isSelected) {
        if (currentIds.includes(message.id)) {
          return currentIds;
        }
        return [...currentIds, message.id];
      }

      return currentIds.filter((messageId) => messageId !== message.id);
    });
  }

  function handleSelectAllFiltered() {
    setBulkActionError(null);
    setIsBulkSelectionMode(true);
    setSelectedMessageIds(filteredAndSorted.map((message) => message.id));
  }

  function clearSelectedMessages() {
    setBulkActionError(null);
    setSelectedMessageIds([]);
  }

  async function handleMoveMessage(messageId: number, categoryId: number) {
    setMoveDialogError(null);
    setIsMoveSubmitting(true);

    try {
      await moveSingleMessageToCategory(messageId, categoryId);

      setMoveDialogMessageId(null);
    } catch (error) {
      setMoveDialogError(toErrorMessage(error, "Unable to move this message right now."));
    } finally {
      setIsMoveSubmitting(false);
    }
  }

  async function handleAddTag(messageId: number, tagId: number) {
    setTagDialogError(null);
    setIsTagSubmitting(true);

    try {
      if (isApiBackedData) {
        const updatedTags = await addTagsToMessage(messageId, [tagId]);
        setKnownTags((currentTags) => mergeTags(currentTags, updatedTags));
        setMessages((currentMessages) =>
          currentMessages.map((message) => (message.id === messageId ? { ...message, tags: updatedTags } : message)),
        );
      } else {
        const tag = knownTags.find((entry) => entry.id === tagId);
        if (!tag) {
          throw new Error("Selected tag was not found.");
        }
        setMessages((currentMessages) => localAddTag(currentMessages, messageId, tag));
      }
    } catch (error) {
      setTagDialogError(toErrorMessage(error, "Unable to add that tag."));
    } finally {
      setIsTagSubmitting(false);
    }
  }

  async function handleRemoveTag(messageId: number, tagId: number) {
    setTagDialogError(null);
    setIsTagSubmitting(true);

    try {
      if (isApiBackedData) {
        const updatedTags = await removeTagFromMessage(messageId, tagId);
        setKnownTags((currentTags) => mergeTags(currentTags, updatedTags));
        setMessages((currentMessages) =>
          currentMessages.map((message) => (message.id === messageId ? { ...message, tags: updatedTags } : message)),
        );
      } else {
        setMessages((currentMessages) => localRemoveTag(currentMessages, messageId, tagId));
      }
    } catch (error) {
      setTagDialogError(toErrorMessage(error, "Unable to remove that tag."));
    } finally {
      setIsTagSubmitting(false);
    }
  }

  async function handleCreateAndAttachTag(name: string) {
    const normalizedName = name.trim().replace(/\s+/g, " ");
    if (normalizedName.length === 0 || activeTagMessage === null) {
      return;
    }

    setTagDialogError(null);
    setIsTagSubmitting(true);

    try {
      if (isApiBackedData) {
        const created = await createTag({ name: normalizedName });
        const updatedTags = await addTagsToMessage(activeTagMessage.id, [created.id]);
        setKnownTags((currentTags) => mergeTags(currentTags, [created, ...updatedTags]));
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === activeTagMessage.id ? { ...message, tags: updatedTags } : message,
          ),
        );
      } else {
        const existingTag = knownTags.find(
          (tag) => normalizeTagKey(tag.name) === normalizeTagKey(normalizedName),
        );
        const tagToAttach = existingTag ?? createLocalTag(normalizedName, knownTags);
        setKnownTags((currentTags) => mergeTags(currentTags, [tagToAttach]));
        setMessages((currentMessages) => localAddTag(currentMessages, activeTagMessage.id, tagToAttach));
      }
    } catch (error) {
      setTagDialogError(toErrorMessage(error, "Unable to create tag."));
    } finally {
      setIsTagSubmitting(false);
    }
  }

  async function handleDeleteMessage(targetMessage: MessageListItem) {
    const hasConfirmed = window.confirm("Delete this message from the organizer? This cannot be undone.");
    if (!hasConfirmed) {
      return;
    }

    setPageError(null);
    setPendingDeleteMessageId(targetMessage.id);

    try {
      if (isApiBackedData) {
        await deleteMessage(targetMessage.id);
      }

      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== targetMessage.id),
      );
      setSelectedMessageIds((currentIds) =>
        currentIds.filter((messageId) => messageId !== targetMessage.id),
      );
      if (moveDialogMessageId === targetMessage.id) {
        setMoveDialogMessageId(null);
      }
      if (tagDialogMessageId === targetMessage.id) {
        setTagDialogMessageId(null);
      }
    } catch (error) {
      setPageError(toErrorMessage(error, "Unable to delete this message right now."));
    } finally {
      setPendingDeleteMessageId(null);
    }
  }

  async function handleBulkMove() {
    if (selectedMessageIds.length === 0) {
      return;
    }
    if (bulkMoveCategoryId === null) {
      setBulkActionError("Select a category before moving messages.");
      return;
    }

    const targetCategory = actionCategories.find((category) => category.id === bulkMoveCategoryId);
    if (!targetCategory) {
      setBulkActionError("Selected category was not found.");
      return;
    }

    const targetMessageIds = [...selectedMessageIds];
    setPageError(null);
    setBulkActionError(null);
    setBulkActionPending("move");

    try {
      if (isApiBackedData) {
        await bulkMoveMessages(targetMessageIds, bulkMoveCategoryId);
      }

      setMessages((currentMessages) =>
        localMoveMessages(currentMessages, targetMessageIds, targetCategory),
      );
      setSelectedMessageIds([]);
    } catch (error) {
      setBulkActionError(toErrorMessage(error, "Unable to move selected messages right now."));
    } finally {
      setBulkActionPending(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedMessageIds.length === 0) {
      return;
    }

    const hasConfirmed = window.confirm(
      `Delete ${selectedMessageIds.length} selected message${selectedMessageIds.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!hasConfirmed) {
      return;
    }

    const targetMessageIds = [...selectedMessageIds];
    const targetIdSet = new Set(targetMessageIds);
    setPageError(null);
    setBulkActionError(null);
    setBulkActionPending("delete");

    try {
      if (isApiBackedData) {
        await bulkDeleteMessages(targetMessageIds);
      }

      setMessages((currentMessages) =>
        currentMessages.filter((message) => !targetIdSet.has(message.id)),
      );
      setSelectedMessageIds([]);

      if (moveDialogMessageId !== null && targetIdSet.has(moveDialogMessageId)) {
        setMoveDialogMessageId(null);
      }
      if (tagDialogMessageId !== null && targetIdSet.has(tagDialogMessageId)) {
        setTagDialogMessageId(null);
      }
    } catch (error) {
      setBulkActionError(toErrorMessage(error, "Unable to delete selected messages right now."));
    } finally {
      setBulkActionPending(null);
    }
  }

  return (
    <section>
      <div>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Messages</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Search by content, URL, sender, and tags. Layer filters to narrow down your Saved Messages quickly.
          {categoryFilter.length > 0 ? ` Active category: ${formatCategoryFilter(categoryFilter)}.` : ""}
        </p>
        {statusMessage ? (
          <p className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.6)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            {statusMessage}
          </p>
        ) : null}
        {pageError ? (
          <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {pageError}
          </p>
        ) : null}
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
                    key={tag.id}
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Showing {filteredAndSorted.length} of {messages.length} messages.
        </p>

        {!isBulkSelectionMode ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={activateBulkSelectionMode}
            disabled={filteredAndSorted.length === 0}
          >
            <CheckSquare2 className="size-3.5" />
            Bulk select
          </Button>
        ) : null}
      </div>

      {isBulkSelectionMode ? (
        <BulkActions
          selectedCount={selectedMessageIds.length}
          filteredCount={filteredAndSorted.length}
          categories={actionCategories}
          selectedCategoryId={bulkMoveCategoryId}
          isMoveSubmitting={bulkActionPending === "move"}
          isDeleteSubmitting={bulkActionPending === "delete"}
          errorMessage={bulkActionError}
          onSelectAllFiltered={handleSelectAllFiltered}
          onClearSelection={clearSelectedMessages}
          onSelectedCategoryChange={setBulkMoveCategoryId}
          onBulkMove={() => {
            void handleBulkMove();
          }}
          onBulkDelete={() => {
            void handleBulkDelete();
          }}
          onExit={exitBulkSelectionMode}
        />
      ) : null}

      <MessageGrid
        messages={filteredAndSorted}
        pendingDeleteMessageId={pendingDeleteMessageId}
        isSelectionMode={isBulkSelectionMode}
        selectedMessageIds={selectedMessageIds}
        onMoveRequest={(message) => {
          setMoveDialogError(null);
          setMoveDialogMessageId(message.id);
        }}
        onTagRequest={(message) => {
          setTagDialogError(null);
          setTagDialogMessageId(message.id);
        }}
        onDeleteRequest={(message) => {
          void handleDeleteMessage(message);
        }}
        onSelectionChange={handleMessageSelectionChange}
      />

      {filteredAndSorted.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.7)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
          No messages match the current search and filter controls.
        </p>
      ) : null}

      <MoveDialog
        open={moveDialogMessageId !== null}
        message={activeMoveMessage}
        categories={actionCategories}
        isSubmitting={isMoveSubmitting}
        errorMessage={moveDialogError}
        onClose={() => {
          setMoveDialogError(null);
          setMoveDialogMessageId(null);
        }}
        onSubmit={handleMoveMessage}
      />

      <TagInputDialog
        open={tagDialogMessageId !== null}
        message={activeTagMessage}
        availableTags={availableTags.map(({ id, label, color }) => ({ id, name: label, color }))}
        isSubmitting={isTagSubmitting}
        errorMessage={tagDialogError}
        onClose={() => {
          setTagDialogError(null);
          setTagDialogMessageId(null);
        }}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
        onCreateTag={handleCreateAndAttachTag}
      />
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare2, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useSearchParams } from "react-router";

import {
  bulkDeleteMessages,
  bulkMoveMessages,
  deleteMessage,
  listMessages,
  moveMessageToCategory,
  TelegramConnectionChangedError,
  TelegramNotConnectedError,
} from "@/api/messages";
import { addTagsToMessage, createTag, listTags, removeTagFromMessage } from "@/api/tags";
import { MoveDialog } from "@/components/categories/move-dialog";
import { BulkActions } from "@/components/messages/bulk-actions";
import { MessageDetail } from "@/components/messages/message-detail";
import { MessageGrid } from "@/components/messages/message-grid";
import { MessageGridSkeleton } from "@/components/messages/message-grid-skeleton";
import { TagInputDialog } from "@/components/tags/tag-input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import { useCategories } from "@/hooks/use-categories";
import { MESSAGE_DROP_TO_CATEGORY_EVENT, readMessageDropToCategoryEvent } from "@/lib/message-drag-events";
import type { CategoryWithCount } from "@/types/category";
import type { MessageListItem, MessageTag } from "@/types/message";

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

export function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [knownTags, setKnownTags] = useState<MessageTag[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalMessages, setTotalMessages] = useState(0);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const [moveDialogMessageId, setMoveDialogMessageId] = useState<number | null>(null);
  const [tagDialogMessageId, setTagDialogMessageId] = useState<number | null>(null);
  const [detailDialogMessageId, setDetailDialogMessageId] = useState<number | null>(null);
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
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(60);
  const gridTopRef = useRef<HTMLDivElement | null>(null);
  const { categories: fetchedCategories } = useCategories();
  const categoryFilter = searchParams.get("category")?.trim().toLowerCase() ?? "";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(normalizedSearchQuery);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [normalizedSearchQuery]);

  useEffect(() => {
    let isCanceled = false;

    async function hydrateTags() {
      try {
        const apiTags = await listTags();
        if (!isCanceled) setKnownTags(apiTags);
      } catch {
        // The message library remains usable when the optional tag catalogue
        // cannot be loaded; tags present on the current page are still shown.
      }
    }

    void hydrateTags();

    return () => {
      isCanceled = true;
    };
  }, []);

  useEffect(() => {
    let isCanceled = false;

    async function hydrateMessages() {
      setIsInitialLoading(true);
      setLoadError(null);
      try {
        const messageResponse = await listMessages({
          page: currentPage,
          per_page: itemsPerPage,
          sort: sortOption,
          category: categoryFilter || undefined,
          search: debouncedSearchQuery || undefined,
          tag: selectedTagFilters.length > 0 ? selectedTagFilters : undefined,
        });
        if (isCanceled) return;
        setMessages(messageResponse.items);
        setTotalMessages(messageResponse.total);
        setKnownTags((currentTags) => mergeTags(currentTags, deriveTagsFromMessages(messageResponse.items)));
      } catch (error) {
        if (isCanceled) return;
        setMessages([]);
        setTotalMessages(0);
        setLoadError(toErrorMessage(error, "Unable to load your messages right now."));
      } finally {
        if (!isCanceled) setIsInitialLoading(false);
      }
    }

    void hydrateMessages();
    return () => {
      isCanceled = true;
    };
  }, [
    categoryFilter,
    currentPage,
    debouncedSearchQuery,
    itemsPerPage,
    reloadRevision,
    selectedTagFilters,
    sortOption,
  ]);

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

  const filteredAndSorted = messages;

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFilter, normalizedSearchQuery, selectedTagFilters, sortOption]);

  const totalPages = Math.max(1, Math.ceil(totalMessages / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedMessages = messages;

  useEffect(() => {
    if (!isInitialLoading && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, isInitialLoading, totalPages]);

  function goToPage(page: number) {
    const clamped = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(clamped);
    gridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
  const activeDetailMessage = useMemo(
    () => messages.find((message) => message.id === detailDialogMessageId) ?? null,
    [detailDialogMessageId, messages],
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

  useEffect(() => {
    if (detailDialogMessageId !== null && activeDetailMessage === null) {
      setDetailDialogMessageId(null);
    }
  }, [activeDetailMessage, detailDialogMessageId]);

  const hasActiveFilters =
    normalizedSearchQuery.length > 0 ||
    categoryFilter.length > 0 ||
    selectedTagFilters.length > 0 ||
    sortOption !== "date_desc";
  const hasResults = messages.length > 0;

  const moveSingleMessageToCategory = useCallback(
    async (messageId: number, categoryId: number) => {
      const updatedMessage = await moveMessageToCategory(messageId, categoryId);
      setMessages((currentMessages) =>
        currentMessages.map((message) => (message.id === messageId ? updatedMessage : message)),
      );
    },
    [],
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
      const updatedTags = await addTagsToMessage(messageId, [tagId]);
      setKnownTags((currentTags) => mergeTags(currentTags, updatedTags));
      setMessages((currentMessages) =>
        currentMessages.map((message) => (message.id === messageId ? { ...message, tags: updatedTags } : message)),
      );
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
      const updatedTags = await removeTagFromMessage(messageId, tagId);
      setKnownTags((currentTags) => mergeTags(currentTags, updatedTags));
      setMessages((currentMessages) =>
        currentMessages.map((message) => (message.id === messageId ? { ...message, tags: updatedTags } : message)),
      );
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
      const created = await createTag({ name: normalizedName });
      const updatedTags = await addTagsToMessage(activeTagMessage.id, [created.id]);
      setKnownTags((currentTags) => mergeTags(currentTags, [created, ...updatedTags]));
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === activeTagMessage.id ? { ...message, tags: updatedTags } : message,
        ),
      );
    } catch (error) {
      setTagDialogError(toErrorMessage(error, "Unable to create tag."));
    } finally {
      setIsTagSubmitting(false);
    }
  }

  async function handleDeleteMessage(targetMessage: MessageListItem, localOnly = false) {
    if (!localOnly) {
      const hasConfirmed = window.confirm("Delete this message from the organizer and Telegram? This cannot be undone.");
      if (!hasConfirmed) {
        return;
      }
    }

    setPageError(null);
    setPendingDeleteMessageId(targetMessage.id);

    try {
      await deleteMessage(targetMessage.id, localOnly);

      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== targetMessage.id),
      );
      setTotalMessages((currentTotal) => Math.max(0, currentTotal - 1));
      setSelectedMessageIds((currentIds) =>
        currentIds.filter((messageId) => messageId !== targetMessage.id),
      );
      if (moveDialogMessageId === targetMessage.id) {
        setMoveDialogMessageId(null);
      }
      if (tagDialogMessageId === targetMessage.id) {
        setTagDialogMessageId(null);
      }
      if (detailDialogMessageId === targetMessage.id) {
        setDetailDialogMessageId(null);
      }
    } catch (error) {
      if (
        error instanceof TelegramNotConnectedError
        || error instanceof TelegramConnectionChangedError
      ) {
        const deleteLocally = window.confirm(
          error instanceof TelegramConnectionChangedError
            ? "This message was imported from a previous Telegram connection. Delete it locally only? No Telegram message will be changed."
            : "Telegram is not connected. Delete this message locally only? It will remain in your Telegram Saved Messages.",
        );
        if (deleteLocally) {
          await handleDeleteMessage(targetMessage, true);
          return;
        }
      } else {
        setPageError(toErrorMessage(error, "Unable to delete this message right now."));
      }
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
      await bulkMoveMessages(targetMessageIds, bulkMoveCategoryId);

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

  async function handleBulkDelete(localOnly = false) {
    if (selectedMessageIds.length === 0) {
      return;
    }

    if (!localOnly) {
      const hasConfirmed = window.confirm(
        `Delete ${selectedMessageIds.length} selected message${selectedMessageIds.length === 1 ? "" : "s"} from the organizer and Telegram? This cannot be undone.`,
      );
      if (!hasConfirmed) {
        return;
      }
    }

    const targetMessageIds = [...selectedMessageIds];
    const targetIdSet = new Set(targetMessageIds);
    setPageError(null);
    setBulkActionError(null);
    setBulkActionPending("delete");

    try {
      await bulkDeleteMessages(targetMessageIds, localOnly);

      setMessages((currentMessages) =>
        currentMessages.filter((message) => !targetIdSet.has(message.id)),
      );
      setTotalMessages((currentTotal) => Math.max(0, currentTotal - targetMessageIds.length));
      setSelectedMessageIds([]);

      if (moveDialogMessageId !== null && targetIdSet.has(moveDialogMessageId)) {
        setMoveDialogMessageId(null);
      }
      if (tagDialogMessageId !== null && targetIdSet.has(tagDialogMessageId)) {
        setTagDialogMessageId(null);
      }
      if (detailDialogMessageId !== null && targetIdSet.has(detailDialogMessageId)) {
        setDetailDialogMessageId(null);
      }
    } catch (error) {
      if (
        error instanceof TelegramNotConnectedError
        || error instanceof TelegramConnectionChangedError
      ) {
        const deleteLocally = window.confirm(
          error instanceof TelegramConnectionChangedError
            ? "Some selected messages belong to a previous Telegram connection. Delete them locally only? No Telegram messages will be changed."
            : "Telegram is not connected. Delete selected messages locally only? They will remain in your Telegram Saved Messages.",
        );
        if (deleteLocally) {
          await handleBulkDelete(true);
          return;
        }
      } else {
        setBulkActionError(toErrorMessage(error, "Unable to delete selected messages right now."));
      }
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
        {loadError ? (
          <StatePanel
            tone="error"
            title="Messages could not be loaded."
            description={loadError}
            className="mt-2 text-xs"
            action={(
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadRevision((current) => current + 1)}
              >
                Try again
              </Button>
            )}
          />
        ) : null}
        {pageError ? (
          <StatePanel tone="error" title="Message action failed." description={pageError} className="mt-2 text-xs" />
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
              disabled={isInitialLoading}
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
              disabled={isInitialLoading}
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
              disabled={isInitialLoading}
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
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 lg:self-end"
              onClick={clearFilters}
              disabled={isInitialLoading}
            >
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

          {isInitialLoading ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ) : availableTags.length > 0 ? (
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

      <div ref={gridTopRef} className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {isInitialLoading
            ? "Loading messages..."
            : `${totalMessages} ${hasActiveFilters ? "matching " : ""}message${totalMessages === 1 ? "" : "s"}`}
          {!isInitialLoading && totalMessages > itemsPerPage
            ? ` · Page ${safePage} of ${totalPages}`
            : ""}
        </p>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            Per page
            <select
              value={itemsPerPage}
              onChange={(event) => {
                setItemsPerPage(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            >
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={120}>120</option>
              <option value={200}>200</option>
            </select>
          </label>

          {!isBulkSelectionMode ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={activateBulkSelectionMode}
              disabled={isInitialLoading || messages.length === 0}
            >
              <CheckSquare2 className="size-3.5" />
              Bulk select
            </Button>
          ) : null}
        </div>
      </div>

      {isBulkSelectionMode && !isInitialLoading ? (
        <BulkActions
          selectedCount={selectedMessageIds.length}
          filteredCount={messages.length}
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

      {isInitialLoading ? (
        <MessageGridSkeleton />
      ) : (
        <MessageGrid
          messages={paginatedMessages}
          pendingDeleteMessageId={pendingDeleteMessageId}
          isSelectionMode={isBulkSelectionMode}
          selectedMessageIds={selectedMessageIds}
          onOpenDetailRequest={(message) => {
            setDetailDialogMessageId(message.id);
          }}
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
      )}

      {!isInitialLoading && loadError === null && totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => goToPage(safePage - 1)}
            disabled={safePage <= 1}
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((page) => {
              if (totalPages <= 7) return true;
              if (page === 1 || page === totalPages) return true;
              if (Math.abs(page - safePage) <= 1) return true;
              return false;
            })
            .reduce<(number | "ellipsis")[]>((acc, page, idx, arr) => {
              if (idx > 0) {
                const prev = arr[idx - 1];
                if (page - prev > 1) acc.push("ellipsis");
              }
              acc.push(page);
              return acc;
            }, [])
            .map((item, idx) =>
              item === "ellipsis" ? (
                <span key={`ellipsis-${idx}`} className="px-1 text-sm text-[hsl(var(--muted-foreground))]">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  variant={item === safePage ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0 text-xs"
                  onClick={() => goToPage(item)}
                >
                  {item}
                </Button>
              ),
            )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => goToPage(safePage + 1)}
            disabled={safePage >= totalPages}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}

      {!isInitialLoading && loadError === null && !hasResults ? (
        <StatePanel
          className="mt-5"
          title={hasActiveFilters ? "No messages match these filters." : "No messages yet."}
          description={
            hasActiveFilters
              ? "Adjust search or filter controls to broaden results."
              : "Connect Telegram and run a scan to import Saved Messages."
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={clearFilters}>
                <X className="size-3.5" />
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : null}

      <MessageDetail
        open={detailDialogMessageId !== null}
        message={activeDetailMessage}
        isDeletePending={pendingDeleteMessageId === detailDialogMessageId}
        onClose={() => {
          setDetailDialogMessageId(null);
        }}
        onMoveRequest={(message) => {
          setDetailDialogMessageId(null);
          setMoveDialogError(null);
          setMoveDialogMessageId(message.id);
        }}
        onTagRequest={(message) => {
          setDetailDialogMessageId(null);
          setTagDialogError(null);
          setTagDialogMessageId(message.id);
        }}
        onDeleteRequest={(message) => {
          void handleDeleteMessage(message);
        }}
      />

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

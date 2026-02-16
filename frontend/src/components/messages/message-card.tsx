import { type DragEvent, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Check,
  Code2,
  Eye,
  FileText,
  FolderInput,
  FolderKanban,
  GripVertical,
  ImageIcon,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Music2,
  Tags,
  Trash2,
  type LucideIcon,
  Video,
} from "lucide-react";

import type { MessageListItem } from "@/types/message";
import { announceMessageDragEnd, announceMessageDragStart, setDraggedMessageId } from "@/lib/message-drag-events";

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

function resolveMediaIcon(mediaType: string | null, hasUrl: boolean): LucideIcon {
  const normalizedType = mediaType?.toLowerCase() ?? "";
  if (normalizedType.includes("video")) {
    return Video;
  }
  if (normalizedType.includes("audio") || normalizedType.includes("voice")) {
    return Music2;
  }
  if (normalizedType.includes("photo") || normalizedType.includes("image")) {
    return ImageIcon;
  }
  if (normalizedType.includes("document") || normalizedType.includes("file") || normalizedType.includes("pdf")) {
    return FileText;
  }
  if (hasUrl) {
    return Link2;
  }
  return MessageSquareText;
}

function resolveMediaLabel(mediaType: string | null, hasUrl: boolean): string {
  const normalizedType = mediaType?.toLowerCase() ?? "";
  if (normalizedType.includes("video")) {
    return "Video";
  }
  if (normalizedType.includes("audio") || normalizedType.includes("voice")) {
    return "Audio";
  }
  if (normalizedType.includes("photo") || normalizedType.includes("image")) {
    return "Image";
  }
  if (normalizedType.includes("document") || normalizedType.includes("file") || normalizedType.includes("pdf")) {
    return "Document";
  }
  if (hasUrl) {
    return "Link";
  }
  return "Text";
}

function parseUrlDomain(rawUrl: string | null): string | null {
  if (rawUrl === null || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, "") || rawUrl;
  } catch {
    return rawUrl;
  }
}

function formatRelativeDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  const diffMs = parsed.getTime() - Date.now();
  const absDiff = Math.abs(diffMs);

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absDiff < hourMs) {
    return formatter.format(Math.round(diffMs / minuteMs), "minute");
  }
  if (absDiff < dayMs) {
    return formatter.format(Math.round(diffMs / hourMs), "hour");
  }
  if (absDiff < weekMs) {
    return formatter.format(Math.round(diffMs / dayMs), "day");
  }
  if (absDiff < monthMs) {
    return formatter.format(Math.round(diffMs / weekMs), "week");
  }
  if (absDiff < yearMs) {
    return formatter.format(Math.round(diffMs / monthMs), "month");
  }
  return formatter.format(Math.round(diffMs / yearMs), "year");
}

function withAlpha(color: string | null, alphaHex: string): string | null {
  if (color === null || !/^#[0-9a-f]{6}$/i.test(color)) {
    return null;
  }
  return `${color}${alphaHex}`;
}

type MessageCardProps = {
  message: MessageListItem;
  isDeletePending?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onOpenDetailRequest: (message: MessageListItem) => void;
  onMoveRequest: (message: MessageListItem) => void;
  onTagRequest: (message: MessageListItem) => void;
  onDeleteRequest: (message: MessageListItem) => void;
  onSelectionChange?: (message: MessageListItem, isSelected: boolean) => void;
};

export function MessageCard({
  message,
  isDeletePending = false,
  isSelectionMode = false,
  isSelected = false,
  onOpenDetailRequest,
  onMoveRequest,
  onTagRequest,
  onDeleteRequest,
  onSelectionChange,
}: MessageCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const CategoryIcon = resolveCategoryIcon(message.category.icon);
  const urlDomain = parseUrlDomain(message.url);
  const hasUrl = message.url !== null && message.url.trim().length > 0;
  const MediaIcon = resolveMediaIcon(message.media_type, hasUrl);
  const mediaLabel = resolveMediaLabel(message.media_type, hasUrl);
  const rawPreview =
    message.content !== null && message.content.trim().length > 0
      ? message.content.trim()
      : "No text preview available for this message.";
  const previewText = rawPreview.length > 280 ? `${rawPreview.slice(0, 280)}…` : rawPreview;
  const cardEnterAnimation = shouldReduceMotion ? false : { opacity: 0, y: 20, scale: 0.98 };
  const cardExitAnimation = shouldReduceMotion
    ? { opacity: 0, transition: { duration: 0.12 } }
    : { opacity: 0, scale: 0.95, y: 6, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } };
  const hoverAnimation = shouldReduceMotion
    ? undefined
    : {
        y: -6,
        boxShadow: "0 24px 44px -28px rgba(15, 23, 42, 0.55)",
        transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
      };

  useEffect(() => {
    if (!isActionsOpen) {
      return;
    }

    function handleOutsideClick(event: MouseEvent) {
      if (menuRef.current === null) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        setIsActionsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsActionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isActionsOpen]);

  function handleDragStart(event: DragEvent<HTMLElement>) {
    if (isDeletePending) {
      event.preventDefault();
      return;
    }

    setDraggedMessageId(event.dataTransfer, message.id);
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
    }

    setIsActionsOpen(false);
    setIsDragging(true);
    announceMessageDragStart({ messageId: message.id, categoryId: message.category.id });
  }

  function handleDragEnd() {
    setIsDragging(false);
    announceMessageDragEnd();
  }

  return (
    <motion.article
      layout="position"
      initial={cardEnterAnimation}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
        transition: shouldReduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
      }}
      exit={cardExitAnimation}
      whileHover={hoverAnimation}
      draggable={!isDeletePending}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={[
        "group overflow-visible rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.96)] p-4 shadow-sm transition-colors",
        isDeletePending ? "cursor-not-allowed opacity-80" : "cursor-grab active:cursor-grabbing",
        isDragging ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--card)/0.88)] shadow-lg" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <label
            className={[
              "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded border text-[hsl(var(--foreground))] transition-opacity",
              isSelectionMode
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] opacity-100"
                : "border-[hsl(var(--border))] bg-[hsl(var(--background))] opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            ].join(" ")}
          >
            <span className="sr-only">Select message</span>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(event) => onSelectionChange?.(message, event.target.checked)}
              className="peer sr-only"
            />
            <Check className="size-3.5 opacity-0 transition-opacity peer-checked:opacity-100" />
          </label>

          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{
              color: message.category.color,
              borderColor: withAlpha(message.category.color, "66") ?? "hsl(var(--border))",
              backgroundColor: withAlpha(message.category.color, "1A") ?? "hsl(var(--muted))",
            }}
          >
            <CategoryIcon className="size-3.5" />
            {message.category.name}
          </span>
        </div>

        <div className="relative flex items-center gap-1.5" ref={menuRef}>
          <time
            className="text-xs text-[hsl(var(--muted-foreground))]"
            dateTime={message.date}
            title={new Date(message.date).toLocaleString()}
          >
            {formatRelativeDate(message.date)}
          </time>
          <button
            type="button"
            draggable="false"
            aria-label="Message actions"
            aria-expanded={isActionsOpen}
            aria-haspopup="menu"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            onClick={(e) => { e.stopPropagation(); setIsActionsOpen((previous) => !previous); }}
          >
            <MoreHorizontal className="size-4" />
          </button>

          {isActionsOpen ? (
            <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1 shadow-xl" role="menu" draggable="false" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                draggable="false"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetailRequest(message);
                  setIsActionsOpen(false);
                }}
                role="menuitem"
              >
                <Eye className="size-3.5" />
                View details
              </button>
              <button
                type="button"
                draggable="false"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveRequest(message);
                  setIsActionsOpen(false);
                }}
                role="menuitem"
              >
                <FolderInput className="size-3.5" />
                Move to category
              </button>
              <button
                type="button"
                draggable="false"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagRequest(message);
                  setIsActionsOpen(false);
                }}
                role="menuitem"
              >
                <Tags className="size-3.5" />
                Manage tags
              </button>
              <button
                type="button"
                draggable="false"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-red-400 dark:text-red-300 transition-colors hover:bg-red-500/20"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRequest(message);
                  setIsActionsOpen(false);
                }}
                disabled={isDeletePending}
                role="menuitem"
              >
                <Trash2 className="size-3.5" />
                {isDeletePending ? "Deleting..." : "Delete message"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
          <MediaIcon className="size-3.5" />
          <span>{mediaLabel}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          <GripVertical className="size-3" />
          Drag
        </span>
      </div>

      <p className="mt-2 break-words text-sm text-[hsl(var(--foreground))]" style={{ overflowWrap: "anywhere" }}>{previewText}</p>
      <button
        type="button"
        draggable="false"
        onClick={(e) => { e.stopPropagation(); onOpenDetailRequest(message); }}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] transition-opacity hover:opacity-80"
      >
        <Eye className="size-3.5" />
        View full message
      </button>

      {urlDomain !== null ? (
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))]">
          <Link2 className="size-3.5" />
          {urlDomain}
        </p>
      ) : null}

      {message.tags.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {message.tags.map((tag) => (
            <li
              key={tag.id}
              className="rounded-full border px-2 py-0.5 text-xs font-medium"
              style={{
                color: tag.color ?? "hsl(var(--muted-foreground))",
                borderColor: withAlpha(tag.color, "66") ?? "hsl(var(--border))",
                backgroundColor: withAlpha(tag.color, "14") ?? "hsl(var(--muted))",
              }}
            >
              #{tag.name}
            </li>
          ))}
        </ul>
      ) : null}
    </motion.article>
  );
}

import { motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Code2,
  FileText,
  FolderKanban,
  ImageIcon,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Music2,
  type LucideIcon,
  Video,
} from "lucide-react";

import type { MessageListItem } from "@/types/message";

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
};

export function MessageCard({ message }: MessageCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const CategoryIcon = resolveCategoryIcon(message.category.icon);
  const urlDomain = parseUrlDomain(message.url);
  const hasUrl = message.url !== null && message.url.trim().length > 0;
  const MediaIcon = resolveMediaIcon(message.media_type, hasUrl);
  const mediaLabel = resolveMediaLabel(message.media_type, hasUrl);
  const previewText =
    message.content !== null && message.content.trim().length > 0
      ? message.content.trim()
      : "No text preview available for this message.";
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

  return (
    <motion.article
      layout
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
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.96)] p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
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

        <div className="flex items-center gap-1.5">
          <time
            className="text-xs text-[hsl(var(--muted-foreground))]"
            dateTime={message.date}
            title={new Date(message.date).toLocaleString()}
          >
            {formatRelativeDate(message.date)}
          </time>
          <button
            type="button"
            aria-label="Message actions"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
        <MediaIcon className="size-3.5" />
        <span>{mediaLabel}</span>
      </div>

      <p className="mt-2 text-sm text-[hsl(var(--foreground))]">{previewText}</p>

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

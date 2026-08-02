import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  FileDigit,
  FolderInput,
  Hash,
  MessageSquareText,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MessageContent } from "@/components/messages/message-content";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useModalLifecycle } from "@/hooks/use-modal-lifecycle";
import type { MessageListItem } from "@/types/message";

function withAlpha(color: string | null, alphaHex: string): string | null {
  if (color === null || !/^#[0-9a-f]{6}$/i.test(color)) {
    return null;
  }
  return `${color}${alphaHex}`;
}

function formatAbsoluteDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }
  return parsed.toLocaleString();
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

function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function hasRawData(rawData: Record<string, unknown>): boolean {
  return Object.keys(rawData).length > 0;
}

function toRawDataString(rawData: Record<string, unknown>): string {
  try {
    return JSON.stringify(rawData, null, 2);
  } catch {
    return "{}";
  }
}

type MessageDetailProps = {
  open: boolean;
  message: MessageListItem | null;
  isDeletePending?: boolean;
  onClose: () => void;
  onMoveRequest: (message: MessageListItem) => void;
  onTagRequest: (message: MessageListItem) => void;
  onDeleteRequest: (message: MessageListItem) => void;
};

export function MessageDetail({
  open,
  message,
  isDeletePending = false,
  onClose,
  onMoveRequest,
  onTagRequest,
  onDeleteRequest,
}: MessageDetailProps) {
  const shouldReduceMotion = useReducedMotion();

  useModalLifecycle(open, onClose);

  const hasDetails = message !== null;
  const fileSizeLabel = message !== null ? formatFileSize(message.file_size) : null;
  const showFileDetails = message?.media_type !== null || message?.file_name !== null || message?.mime_type !== null;

  return (
    <ModalPortal>
      <AnimatePresence>
      {open && hasDetails ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60"
            onClick={onClose}
            aria-label="Close message details"
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-detail-title"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl sm:max-w-3xl sm:rounded-2xl"
          >
            <div className="border-b border-[hsl(var(--border)/0.8)] px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                    Saved message
                  </p>
                  <h3 id="message-detail-title" className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">
                    Message details
                  </h3>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {formatRelativeDate(message.date)} • {formatAbsoluteDate(message.date)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
                  style={{
                    color: message.category.color,
                    borderColor: withAlpha(message.category.color, "66") ?? "hsl(var(--border))",
                    backgroundColor: withAlpha(message.category.color, "1A") ?? "hsl(var(--muted))",
                  }}
                >
                  {message.category.name}
                </span>
                {message.sender_name ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    <UserRound className="size-3.5" />
                    {message.sender_name}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  <Hash className="size-3.5" />
                  Telegram #{message.telegram_id}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onMoveRequest(message)}>
                  <FolderInput className="size-3.5" />
                  Move
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onTagRequest(message)}>
                  <Tags className="size-3.5" />
                  Tags
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-red-700 dark:text-red-300 hover:bg-red-500/20"
                  onClick={() => onDeleteRequest(message)}
                  disabled={isDeletePending}
                >
                  <Trash2 className="size-3.5" />
                  {isDeletePending ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              <section>
                <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                  <MessageSquareText className="size-3.5" />
                  Content
                </h4>
                <div className="mt-2 rounded-xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                  <MessageContent content={message.content} url={message.url} />
                </div>
              </section>

              {showFileDetails ? (
                <section className="mt-4">
                  <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                    <FileDigit className="size-3.5" />
                    Media details
                  </h4>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    {message.media_type ? (
                      <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                          Media type
                        </dt>
                        <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{message.media_type}</dd>
                      </div>
                    ) : null}
                    {message.mime_type ? (
                      <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                          MIME
                        </dt>
                        <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{message.mime_type}</dd>
                      </div>
                    ) : null}
                    {message.file_name ? (
                      <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3 sm:col-span-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                          File name
                        </dt>
                        <dd className="mt-1 break-all text-sm text-[hsl(var(--foreground))]">{message.file_name}</dd>
                      </div>
                    ) : null}
                    {fileSizeLabel ? (
                      <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                          File size
                        </dt>
                        <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{fileSizeLabel}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              <section className="mt-4">
                <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                  <CalendarClock className="size-3.5" />
                  Metadata
                </h4>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      Organizer ID
                    </dt>
                    <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{message.id}</dd>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      Category
                    </dt>
                    <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{message.category.name}</dd>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      Imported
                    </dt>
                    <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{formatAbsoluteDate(message.created_at)}</dd>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      Updated
                    </dt>
                    <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">{formatAbsoluteDate(message.updated_at)}</dd>
                  </div>
                </dl>
              </section>

              <section className="mt-4">
                <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                  <Tags className="size-3.5" />
                  Tags
                </h4>
                {message.tags.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {message.tags.map((tag) => (
                      <li
                        key={tag.id}
                        className="rounded-full border px-2.5 py-1 text-xs font-medium"
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
                ) : (
                  <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">No tags attached.</p>
                )}
              </section>

              {hasRawData(message.raw_data) ? (
                <section className="mt-4">
                  <details className="rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--background)/0.75)]">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                      Raw payload
                    </summary>
                    <pre className="overflow-x-auto border-t border-[hsl(var(--border)/0.8)] px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                      {toRawDataString(message.raw_data)}
                    </pre>
                  </details>
                </section>
              ) : null}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </ModalPortal>
  );
}

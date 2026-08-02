import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Tags, X } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useModalLifecycle } from "@/hooks/use-modal-lifecycle";
import type { MessageListItem, MessageTag } from "@/types/message";

type TagInputDialogProps = {
  open: boolean;
  message: MessageListItem | null;
  availableTags: MessageTag[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onAddTag: (messageId: number, tagId: number) => Promise<void> | void;
  onRemoveTag: (messageId: number, tagId: number) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<boolean> | boolean;
};

function withAlpha(color: string | null, alphaHex: string): string | null {
  if (color === null || !/^#[0-9a-f]{6}$/i.test(color)) {
    return null;
  }
  return `${color}${alphaHex}`;
}

export function TagInputDialog({
  open,
  message,
  availableTags,
  isSubmitting,
  errorMessage,
  onClose,
  onAddTag,
  onRemoveTag,
  onCreateTag,
}: TagInputDialogProps) {
  const [newTagName, setNewTagName] = useState("");

  useModalLifecycle(open, onClose);

  useEffect(() => {
    if (!open) {
      return;
    }
    setNewTagName("");
  }, [open, message?.id]);

  const assignedTagIds = useMemo(() => new Set(message?.tags.map((tag) => tag.id) ?? []), [message?.tags]);
  const sortedAvailableTags = useMemo(
    () => [...availableTags].sort((first, second) => first.name.localeCompare(second.name)),
    [availableTags],
  );

  if (!open || message === null) {
    return null;
  }

  const nextTagCandidates = sortedAvailableTags.filter((tag) => !assignedTagIds.has(tag.id));
  const canCreateTag = newTagName.trim().length > 0 && !isSubmitting;

  async function handleCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTagName.trim().length === 0) {
      return;
    }
    const wasCreated = await onCreateTag(newTagName);
    if (wasCreated) {
      setNewTagName("");
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-4 sm:items-center" role="presentation">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div
          className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-dialog-title"
        >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
            <Tags className="size-4" />
          </span>
          <div>
            <h3 id="tag-dialog-title" className="text-base font-semibold text-[hsl(var(--foreground))]">Tags for this message</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Add, create, or remove tags for this message.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Attached tags
          </p>
          {message.tags.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {message.tags.map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors hover:brightness-110"
                    style={{
                      color: tag.color ?? "hsl(var(--muted-foreground))",
                      borderColor: withAlpha(tag.color, "66") ?? "hsl(var(--border))",
                      backgroundColor: withAlpha(tag.color, "14") ?? "hsl(var(--muted))",
                    }}
                    onClick={() => onRemoveTag(message.id, tag.id)}
                    disabled={isSubmitting}
                    title="Remove tag"
                  >
                    <span>#{tag.name}</span>
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">No tags attached yet.</p>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Add existing tag
          </p>
          {nextTagCandidates.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {nextTagCandidates.map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/0.45)] hover:text-[hsl(var(--foreground))]"
                    onClick={() => onAddTag(message.id, tag.id)}
                    disabled={isSubmitting}
                  >
                    + #{tag.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">All available tags are already attached.</p>
          )}
        </div>

        <form className="mt-4 rounded-lg border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--background)/0.75)] p-3" onSubmit={handleCreateTag}>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              Create and attach new tag
            </span>
            <div className="flex gap-2">
              <input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="e.g. read-later"
                className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
              />
              <Button type="submit" variant="secondary" disabled={!canCreateTag}>
                {isSubmitting ? "Saving..." : "Add tag"}
              </Button>
            </div>
          </label>
        </form>

        {errorMessage ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{errorMessage}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/settings/tags"
            onClick={onClose}
            className="text-sm font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            Manage all tags
          </Link>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Close
          </Button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}

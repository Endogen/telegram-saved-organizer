import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderInput } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CategoryWithCount } from "@/types/category";
import type { MessageListItem } from "@/types/message";

type MoveDialogProps = {
  open: boolean;
  message: MessageListItem | null;
  categories: CategoryWithCount[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (messageId: number, categoryId: number) => Promise<void> | void;
};

export function MoveDialog({
  open,
  message,
  categories,
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit,
}: MoveDialogProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((first, second) => {
        if (first.position !== second.position) {
          return first.position - second.position;
        }
        return first.id - second.id;
      }),
    [categories],
  );

  useEffect(() => {
    if (!open || message === null) {
      return;
    }
    setSelectedCategoryId(message.category_id);
  }, [message, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!open || message === null) {
    return null;
  }

  const currentCategoryId = message.category_id;
  const canSubmit =
    selectedCategoryId !== null && selectedCategoryId > 0 && selectedCategoryId !== currentCategoryId && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCategoryId === null) {
      return;
    }
    await onSubmit(message.id, selectedCategoryId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4" role="presentation">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
            <FolderInput className="size-4" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">Move message</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Choose a new category for this message.
            </p>
          </div>
        </div>

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              Category
            </span>
            <select
              value={selectedCategoryId ?? ""}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setSelectedCategoryId(Number.isFinite(parsed) ? parsed : null);
              }}
              className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
            >
              {sortedCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          {errorMessage ? (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{errorMessage}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Moving..." : "Move"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

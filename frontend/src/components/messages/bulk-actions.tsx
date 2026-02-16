import { CheckSquare2, FolderInput, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CategoryWithCount } from "@/types/category";

type BulkActionsProps = {
  selectedCount: number;
  filteredCount: number;
  categories: CategoryWithCount[];
  selectedCategoryId: number | null;
  isMoveSubmitting: boolean;
  isDeleteSubmitting: boolean;
  errorMessage: string | null;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onSelectedCategoryChange: (categoryId: number | null) => void;
  onBulkMove: () => void;
  onBulkDelete: () => void;
  onExit: () => void;
};

export function BulkActions({
  selectedCount,
  filteredCount,
  categories,
  selectedCategoryId,
  isMoveSubmitting,
  isDeleteSubmitting,
  errorMessage,
  onSelectAllFiltered,
  onClearSelection,
  onSelectedCategoryChange,
  onBulkMove,
  onBulkDelete,
  onExit,
}: BulkActionsProps) {
  return (
    <div className="mt-4 rounded-xl border border-[hsl(var(--primary)/0.28)] bg-[hsl(var(--primary)/0.08)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))]">
            <CheckSquare2 className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Bulk selection mode</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {selectedCount} selected of {filteredCount} visible messages
            </p>
          </div>
        </div>

        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onExit}>
          <X className="size-3.5" />
          Exit bulk mode
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button variant="outline" size="sm" onClick={onSelectAllFiltered} disabled={filteredCount === 0}>
          Select visible ({filteredCount})
        </Button>

        <Button variant="outline" size="sm" onClick={onClearSelection} disabled={selectedCount === 0}>
          Clear selection
        </Button>

        <label className="flex min-w-[12rem] flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Move selected to
          </span>
          <select
            value={selectedCategoryId ?? ""}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onSelectedCategoryChange(Number.isFinite(parsed) ? parsed : null);
            }}
            className="h-9 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 text-sm text-[hsl(var(--foreground))] outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <Button
          size="sm"
          className="gap-1.5"
          onClick={onBulkMove}
          disabled={selectedCount === 0 || selectedCategoryId === null || isMoveSubmitting || isDeleteSubmitting}
        >
          <FolderInput className="size-3.5" />
          {isMoveSubmitting ? "Moving..." : "Move selected"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-red-500/40 bg-red-500/5 text-red-100 hover:bg-red-500/15"
          onClick={onBulkDelete}
          disabled={selectedCount === 0 || isDeleteSubmitting || isMoveSubmitting}
        >
          <Trash2 className="size-3.5" />
          {isDeleteSubmitting ? "Deleting..." : "Delete selected"}
        </Button>
      </div>

      {errorMessage ? (
        <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400 dark:text-red-300">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

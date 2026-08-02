import { LoaderCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useModalLifecycle } from "@/hooks/use-modal-lifecycle";

type DeleteConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
};

export function DeleteConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  isSubmitting,
  errorMessage,
  onClose,
  onConfirm,
}: DeleteConfirmationDialogProps) {
  useModalLifecycle(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4" role="presentation">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div
          className="relative z-10 w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-organization-item-title"
          aria-describedby="delete-organization-item-description"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/12 text-red-700 dark:text-red-300">
              <Trash2 className="size-4" />
            </span>
            <div>
              <h3 id="delete-organization-item-title" className="text-base font-semibold text-[hsl(var(--foreground))]">
                {title}
              </h3>
              <p id="delete-organization-item-description" className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {description}
              </p>
            </div>
          </div>

          {errorMessage ? (
            <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-red-500/35 text-red-700 hover:bg-red-500/10 dark:text-red-300"
              onClick={() => void onConfirm()}
              disabled={isSubmitting}
            >
              {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {isSubmitting ? "Deleting…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

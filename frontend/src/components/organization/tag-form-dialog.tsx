import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Save, Tags } from "lucide-react";

import type { ManagedTag } from "@/api/tags";
import { Button } from "@/components/ui/button";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useModalLifecycle } from "@/hooks/use-modal-lifecycle";

const INPUT_CLASS_NAME =
  "h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] px-3 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary)/0.7)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)] disabled:cursor-not-allowed disabled:opacity-60";

export type TagFormInput = {
  name: string;
  color: string | null;
};

type TagFormDialogProps = {
  open: boolean;
  tag: ManagedTag | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (payload: TagFormInput) => Promise<void> | void;
};

export function TagFormDialog({
  open,
  tag,
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit,
}: TagFormDialogProps) {
  const [name, setName] = useState("");
  const [hasColor, setHasColor] = useState(true);
  const [color, setColor] = useState("#0EA5E9");
  const isEditing = tag !== null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(tag?.name ?? "");
    setHasColor(tag === null || tag.color !== null);
    setColor(tag?.color ?? "#0EA5E9");
  }, [open, tag]);

  useModalLifecycle(open, onClose);

  if (!open) {
    return null;
  }

  const normalizedColor = color.trim().toUpperCase();
  const hasValidColor = /^#[0-9A-F]{6}$/.test(normalizedColor);
  const canSubmit = name.trim().length > 0 && (!hasColor || hasValidColor) && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    await onSubmit({ name, color: hasColor ? normalizedColor : null });
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4" role="presentation">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div
          className="relative z-10 w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-form-title"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
              <Tags className="size-4" />
            </span>
            <div>
              <h3 id="tag-form-title" className="text-base font-semibold text-[hsl(var(--foreground))]">
                {isEditing ? `Edit #${tag.name}` : "Create tag"}
              </h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Tags can be reused across any number of messages.
              </p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
            <label className="block text-sm font-semibold text-[hsl(var(--foreground))]">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. read-later"
                maxLength={100}
                autoComplete="off"
                disabled={isSubmitting}
                className={`${INPUT_CLASS_NAME} mt-2`}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
              <input
                type="checkbox"
                checked={hasColor}
                onChange={(event) => setHasColor(event.target.checked)}
                disabled={isSubmitting}
                className="size-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
              />
              Use a custom color
            </label>

            {hasColor ? (
              <label className="block text-sm font-semibold text-[hsl(var(--foreground))]">
                Color
                <div className="mt-2 flex gap-2">
                  <input
                    type="color"
                    value={hasValidColor ? normalizedColor : "#0EA5E9"}
                    onChange={(event) => setColor(event.target.value.toUpperCase())}
                    aria-label="Choose tag color"
                    disabled={isSubmitting}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] p-1 disabled:cursor-not-allowed"
                  />
                  <input
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    placeholder="#0EA5E9"
                    maxLength={7}
                    spellCheck={false}
                    disabled={isSubmitting}
                    aria-invalid={!hasValidColor || undefined}
                    className={INPUT_CLASS_NAME}
                  />
                </div>
              </label>
            ) : null}

            {errorMessage ? (
              <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {errorMessage}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" className="gap-2" disabled={!canSubmit}>
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create tag"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

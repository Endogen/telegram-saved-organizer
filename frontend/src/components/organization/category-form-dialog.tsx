import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Palette, Save } from "lucide-react";

import type { CategoryInput } from "@/api/categories";
import { Button } from "@/components/ui/button";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useModalLifecycle } from "@/hooks/use-modal-lifecycle";
import { CATEGORY_ICON_CHOICES } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import type { CategoryWithCount } from "@/types/category";

const INPUT_CLASS_NAME =
  "h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] px-3 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary)/0.7)] focus:ring-4 focus:ring-[hsl(var(--primary)/0.12)] disabled:cursor-not-allowed disabled:opacity-60";

type CategoryFormDialogProps = {
  open: boolean;
  category: CategoryWithCount | null;
  suggestedPosition: number;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (payload: CategoryInput) => Promise<void> | void;
};

export function CategoryFormDialog({
  open,
  category,
  suggestedPosition,
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit,
}: CategoryFormDialogProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("message-square");
  const [color, setColor] = useState("#0F766E");
  const [position, setPosition] = useState(suggestedPosition);
  const isEditing = category !== null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(category?.name ?? "");
    setIcon(category?.icon ?? "message-square");
    setColor(category?.color ?? "#0F766E");
    setPosition(category?.position ?? suggestedPosition);
  }, [category, open, suggestedPosition]);

  useModalLifecycle(open, onClose);

  if (!open) {
    return null;
  }

  const normalizedColor = color.trim().toUpperCase();
  const hasValidColor = /^#[0-9A-F]{6}$/.test(normalizedColor);
  const canSubmit = name.trim().length > 0 && icon.length > 0 && hasValidColor && position >= 0 && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    await onSubmit({ name, icon, color: normalizedColor, position });
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6" role="presentation">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div
          className="relative z-10 max-h-full w-full max-w-xl overflow-y-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-form-title"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
              <Palette className="size-4" />
            </span>
            <div>
              <h3 id="category-form-title" className="text-base font-semibold text-[hsl(var(--foreground))]">
                {isEditing ? `Edit ${category.name}` : "Create category"}
              </h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Categories are shown in this order throughout your workspace.
              </p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
            <label className="block text-sm font-semibold text-[hsl(var(--foreground))]">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Read later"
                maxLength={100}
                autoComplete="off"
                disabled={isSubmitting}
                className={`${INPUT_CLASS_NAME} mt-2`}
              />
            </label>

            <fieldset>
              <legend className="text-sm font-semibold text-[hsl(var(--foreground))]">Icon</legend>
              <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                {CATEGORY_ICON_CHOICES.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <label
                      key={choice.name}
                      className={cn(
                        "flex aspect-square cursor-pointer items-center justify-center rounded-xl border transition",
                        icon === choice.name
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary)/0.16)]"
                          : "border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/0.45)] hover:text-[hsl(var(--foreground))]",
                        isSubmitting && "cursor-not-allowed opacity-60",
                      )}
                      title={choice.label}
                    >
                      <input
                        type="radio"
                        name="category-icon"
                        value={choice.name}
                        checked={icon === choice.name}
                        onChange={() => setIcon(choice.name)}
                        disabled={isSubmitting}
                        className="sr-only"
                        aria-label={choice.label}
                      />
                      <Icon className="size-5" aria-hidden="true" />
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Color
                <div className="mt-2 flex gap-2">
                  <input
                    type="color"
                    value={hasValidColor ? normalizedColor : "#0F766E"}
                    onChange={(event) => setColor(event.target.value.toUpperCase())}
                    aria-label="Choose category color"
                    disabled={isSubmitting}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.72)] p-1 disabled:cursor-not-allowed"
                  />
                  <input
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    placeholder="#0F766E"
                    maxLength={7}
                    spellCheck={false}
                    disabled={isSubmitting}
                    aria-invalid={!hasValidColor || undefined}
                    className={INPUT_CLASS_NAME}
                  />
                </div>
              </label>
              <label className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Sort order
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={position}
                  onChange={(event) => setPosition(Number.parseInt(event.target.value, 10) || 0)}
                  disabled={isSubmitting}
                  className={`${INPUT_CLASS_NAME} mt-2`}
                />
              </label>
            </div>

            {category?.is_default ? (
              <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)/0.65)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                This built-in category keeps its scanner role when you change its display name, icon, color, or order.
              </p>
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
                {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create category"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

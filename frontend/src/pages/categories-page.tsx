import { useState } from "react";
import { FolderPlus, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { createCategory, deleteCategory, updateCategory, type CategoryInput } from "@/api/categories";
import { CategoryFormDialog } from "@/components/organization/category-form-dialog";
import { DeleteConfirmationDialog } from "@/components/organization/delete-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import { notifyCategoriesChanged, useCategories } from "@/hooks/use-categories";
import { resolveCategoryIcon } from "@/lib/category-icons";
import type { CategoryWithCount } from "@/types/category";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function CategoriesPage() {
  const { categories, isLoading, isFallback, error } = useCategories();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithCount | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CategoryWithCount | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const suggestedPosition = categories.reduce((highest, category) => Math.max(highest, category.position), 0) + 1;
  const fallbackCategoryName = categories.find((category) => category.system_key === "other")?.name ?? "Other";

  function openCreateDialog() {
    setEditingCategory(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditDialog(category: CategoryWithCount) {
    setEditingCategory(category);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function closeFormDialog() {
    if (isSaving) {
      return;
    }
    setIsFormOpen(false);
    setEditingCategory(null);
    setFormError(null);
  }

  async function handleSave(payload: CategoryInput) {
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingCategory === null) {
        const created = await createCategory(payload);
        setSuccessMessage(`Created “${created.name}”.`);
      } else {
        const updated = await updateCategory(editingCategory.id, payload);
        setSuccessMessage(`Saved “${updated.name}”.`);
      }
      setIsFormOpen(false);
      setEditingCategory(null);
      notifyCategoriesChanged();
    } catch (saveError) {
      setFormError(toErrorMessage(saveError, "Could not save this category."));
    } finally {
      setIsSaving(false);
    }
  }

  function openDeleteDialog(category: CategoryWithCount) {
    setDeletingCategory(category);
    setDeleteError(null);
    setSuccessMessage(null);
  }

  function closeDeleteDialog() {
    if (isDeleting) {
      return;
    }
    setDeletingCategory(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (deletingCategory === null) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deletingCategory.name;
      const result = await deleteCategory(deletingCategory.id);
      const movedSummary = result.moved_message_count > 0
        ? ` ${messageCountLabel(result.moved_message_count)} moved to ${fallbackCategoryName}.`
        : "";
      setSuccessMessage(`Deleted “${deletedName}”.${movedSummary}`);
      setDeletingCategory(null);
      notifyCategoriesChanged();
    } catch (removeError) {
      setDeleteError(toErrorMessage(removeError, "Could not delete this category."));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Categories</h2>
          <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))] md:text-base">
            Shape the main folders used by the scanner, sidebar, and message filters. Built-in categories can be styled and reordered, while custom categories can also be removed.
          </p>
        </div>
        <Button className="shrink-0 gap-2" onClick={openCreateDialog} disabled={isLoading || isFallback}>
          <FolderPlus className="size-4" />
          New category
        </Button>
      </div>

      {successMessage ? (
        <StatePanel tone="success" title={successMessage} className="mt-5" />
      ) : null}

      {isLoading ? (
        <div className="mt-6 flex min-h-48 items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
          <LoaderCircle className="size-5 animate-spin" />
          Loading categories…
        </div>
      ) : isFallback ? (
        <StatePanel
          tone="error"
          title="Could not load your categories"
          description={error ?? "The category service returned an unexpected response."}
          className="mt-6"
          action={
            <Button variant="outline" size="sm" onClick={notifyCategoriesChanged}>
              Try again
            </Button>
          }
        />
      ) : categories.length === 0 ? (
        <StatePanel
          title="No categories yet"
          description="Create a category to start organizing messages."
          className="mt-6"
          action={
            <Button size="sm" onClick={openCreateDialog}>
              Create category
            </Button>
          }
        />
      ) : (
        <ul className="mt-6 grid gap-3" aria-label="Categories">
          {categories.map((category) => {
            const Icon = resolveCategoryIcon(category.icon);
            return (
              <li
                key={category.id}
                className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-4 md:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border bg-[hsl(var(--muted))]"
                      style={{ borderColor: `${category.color}55` }}
                    >
                      <Icon className="size-5" style={{ color: category.color }} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-base font-semibold text-[hsl(var(--foreground))]">{category.name}</h3>
                        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                          {category.is_default ? "Built in" : "Custom"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                        {messageCountLabel(category.message_count)} · Order {category.position} · /{category.slug}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => openEditDialog(category)}
                      aria-label={`Edit ${category.name}`}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                      onClick={() => openDeleteDialog(category)}
                      disabled={category.is_default}
                      aria-label={`Delete ${category.name}`}
                      aria-describedby={category.is_default ? `category-${category.id}-delete-description` : undefined}
                      title={category.is_default ? `“${category.name}” is built in and cannot be deleted` : undefined}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                    {category.is_default ? (
                      <span id={`category-${category.id}-delete-description`} className="sr-only">
                        Built-in categories can be edited, but they cannot be deleted.
                      </span>
                    ) : null}
                    <Link
                      to={`/messages?category=${encodeURIComponent(category.slug)}`}
                      aria-label={`View messages in ${category.name}`}
                      className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-semibold text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--primary)/0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      View messages
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CategoryFormDialog
        open={isFormOpen}
        category={editingCategory}
        suggestedPosition={suggestedPosition}
        isSubmitting={isSaving}
        errorMessage={formError}
        onClose={closeFormDialog}
        onSubmit={handleSave}
      />

      <DeleteConfirmationDialog
        open={deletingCategory !== null}
        title={deletingCategory ? `Delete “${deletingCategory.name}”?` : "Delete category?"}
        description={deletingCategory
          ? `${messageCountLabel(deletingCategory.message_count)} will be moved to ${fallbackCategoryName}. This category itself cannot be recovered.`
          : "This category cannot be recovered."}
        confirmLabel="Delete category"
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={handleDelete}
      />
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Tag, TagIcon, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { createTag, deleteTag, listManagedTags, updateTag, type ManagedTag } from "@/api/tags";
import { DeleteConfirmationDialog } from "@/components/organization/delete-confirmation-dialog";
import { TagFormDialog, type TagFormInput } from "@/components/organization/tag-form-dialog";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

function withAlpha(color: string | null, alphaHex: string): string | undefined {
  return color && /^#[0-9A-F]{6}$/i.test(color) ? `${color}${alphaHex}` : undefined;
}

export function TagsPage() {
  const [tags, setTags] = useState<ManagedTag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<ManagedTag | null>(null);
  const [deletingTag, setDeletingTag] = useState<ManagedTag | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadTags = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setTags(await listManagedTags(signal));
    } catch (error) {
      if (!signal?.aborted) {
        setLoadError(toErrorMessage(error, "Could not load your tags."));
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTags(controller.signal);
    return () => controller.abort();
  }, [loadTags]);

  function openCreateDialog() {
    setEditingTag(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditDialog(tag: ManagedTag) {
    setEditingTag(tag);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function closeFormDialog() {
    if (isSaving) {
      return;
    }
    setIsFormOpen(false);
    setEditingTag(null);
    setFormError(null);
  }

  async function handleSave(payload: TagFormInput) {
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingTag === null) {
        const created = await createTag(payload);
        setTags((current) => [...current, { ...created, message_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
        setSuccessMessage(`Created #${created.name}.`);
      } else {
        const updated = await updateTag(editingTag.id, payload);
        setTags((current) => current
          .map((tag) => tag.id === updated.id ? { ...updated, message_count: tag.message_count } : tag)
          .sort((a, b) => a.name.localeCompare(b.name)));
        setSuccessMessage(`Saved #${updated.name}.`);
      }
      setIsFormOpen(false);
      setEditingTag(null);
    } catch (saveError) {
      setFormError(toErrorMessage(saveError, "Could not save this tag."));
    } finally {
      setIsSaving(false);
    }
  }

  function openDeleteDialog(tag: ManagedTag) {
    setDeletingTag(tag);
    setDeleteError(null);
    setSuccessMessage(null);
  }

  function closeDeleteDialog() {
    if (isDeleting) {
      return;
    }
    setDeletingTag(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (deletingTag === null) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const removed = deletingTag;
      await deleteTag(removed.id);
      setTags((current) => current.filter((tag) => tag.id !== removed.id));
      setSuccessMessage(`Deleted #${removed.name} and removed it from ${messageCountLabel(removed.message_count)}.`);
      setDeletingTag(null);
    } catch (removeError) {
      setDeleteError(toErrorMessage(removeError, "Could not delete this tag."));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Tags</h2>
          <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))] md:text-base">
            Maintain reusable labels for cross-category topics, projects, and follow-up states. Changes apply everywhere a tag is attached.
          </p>
        </div>
        <Button className="shrink-0 gap-2" onClick={openCreateDialog} disabled={isLoading || loadError !== null}>
          <TagIcon className="size-4" />
          New tag
        </Button>
      </div>

      {successMessage ? <StatePanel tone="success" title={successMessage} className="mt-5" /> : null}

      {isLoading ? (
        <div className="mt-6 flex min-h-48 items-center justify-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
          <LoaderCircle className="size-5 animate-spin" />
          Loading tags…
        </div>
      ) : loadError ? (
        <StatePanel
          tone="error"
          title="Could not load your tags"
          description={loadError}
          className="mt-6"
          action={
            <Button variant="outline" size="sm" onClick={() => void loadTags()}>
              Try again
            </Button>
          }
        />
      ) : tags.length === 0 ? (
        <StatePanel
          title="No tags yet"
          description="Create a reusable tag here, or create and attach one from any message."
          icon={Tag}
          className="mt-6"
          action={
            <Button size="sm" onClick={openCreateDialog}>
              Create tag
            </Button>
          }
        />
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Tags">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold"
                    style={{
                      color: tag.color ?? "hsl(var(--foreground))",
                      borderColor: withAlpha(tag.color, "55") ?? "hsl(var(--border))",
                      backgroundColor: withAlpha(tag.color, "14") ?? "hsl(var(--muted))",
                    }}
                  >
                    <Tag className="size-3.5 shrink-0" />
                    <span className="truncate">#{tag.name}</span>
                  </span>
                  <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{messageCountLabel(tag.message_count)}</p>
                  <Link
                    to={`/messages?tag=${encodeURIComponent(tag.name)}`}
                    aria-label={`View messages tagged #${tag.name}`}
                    className="mt-2 inline-flex text-sm font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  >
                    View messages
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-9 p-0"
                    onClick={() => openEditDialog(tag)}
                    aria-label={`Edit #${tag.name}`}
                    title="Edit tag"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-9 p-0 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    onClick={() => openDeleteDialog(tag)}
                    aria-label={`Delete #${tag.name}`}
                    title="Delete tag"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <TagFormDialog
        open={isFormOpen}
        tag={editingTag}
        isSubmitting={isSaving}
        errorMessage={formError}
        onClose={closeFormDialog}
        onSubmit={handleSave}
      />

      <DeleteConfirmationDialog
        open={deletingTag !== null}
        title={deletingTag ? `Delete #${deletingTag.name}?` : "Delete tag?"}
        description={deletingTag
          ? `This tag will be removed from ${messageCountLabel(deletingTag.message_count)}. Messages themselves will not be deleted.`
          : "Messages themselves will not be deleted."}
        confirmLabel="Delete tag"
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={handleDelete}
      />
    </section>
  );
}

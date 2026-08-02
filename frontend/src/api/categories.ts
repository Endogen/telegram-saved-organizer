import { requestJson } from "@/api/client";
import type { Category } from "@/types/category";

const CATEGORIES_PATH = "/api/categories";

export type CategoryInput = {
  name: string;
  icon: string;
  color: string;
  position: number;
};

export type CategoryDeleteResult = {
  deleted: boolean;
  moved_message_count: number;
  destination_category_id: number;
};

function normalizeCategoryInput(payload: CategoryInput): CategoryInput {
  const name = payload.name.trim().replace(/\s+/g, " ");
  const icon = payload.icon.trim();
  const color = payload.color.trim().toUpperCase();
  const position = Math.trunc(payload.position);

  if (name.length === 0) {
    throw new Error("Category name is required.");
  }
  if (icon.length === 0) {
    throw new Error("Choose a category icon.");
  }
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw new Error("Enter a valid six-digit hex color.");
  }
  if (!Number.isFinite(position) || position < 0) {
    throw new Error("Sort order must be zero or greater.");
  }

  return { name, icon, color, position };
}

export async function createCategory(payload: CategoryInput): Promise<Category> {
  return requestJson<Category>(CATEGORIES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeCategoryInput(payload)),
  }, {
    fallbackMessage: "Could not create the category.",
  });
}

export async function updateCategory(categoryId: number, payload: CategoryInput): Promise<Category> {
  return requestJson<Category>(`${CATEGORIES_PATH}/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeCategoryInput(payload)),
  }, {
    fallbackMessage: "Could not update the category.",
  });
}

export async function deleteCategory(categoryId: number): Promise<CategoryDeleteResult> {
  return requestJson<CategoryDeleteResult>(`${CATEGORIES_PATH}/${categoryId}`, {
    method: "DELETE",
  }, {
    fallbackMessage: "Could not delete the category.",
  });
}

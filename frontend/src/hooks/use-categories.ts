import { useEffect, useState } from "react";

import type { CategoryWithCount } from "@/types/category";

const CATEGORIES_ENDPOINT = "/api/categories";

const DEFAULT_CATEGORY_FALLBACK: CategoryWithCount[] = [
  {
    id: 1,
    name: "Videos",
    slug: "videos",
    icon: "video",
    color: "#E11D48",
    position: 1,
    is_default: true,
    message_count: 0,
  },
  {
    id: 2,
    name: "Audio",
    slug: "audio",
    icon: "music",
    color: "#2563EB",
    position: 2,
    is_default: true,
    message_count: 0,
  },
  {
    id: 3,
    name: "Links",
    slug: "links",
    icon: "link",
    color: "#0EA5E9",
    position: 3,
    is_default: true,
    message_count: 0,
  },
  {
    id: 4,
    name: "Repositories",
    slug: "repositories",
    icon: "code",
    color: "#4F46E5",
    position: 4,
    is_default: true,
    message_count: 0,
  },
  {
    id: 5,
    name: "Images",
    slug: "images",
    icon: "image",
    color: "#14B8A6",
    position: 5,
    is_default: true,
    message_count: 0,
  },
  {
    id: 6,
    name: "Documents",
    slug: "documents",
    icon: "file-text",
    color: "#F59E0B",
    position: 6,
    is_default: true,
    message_count: 0,
  },
  {
    id: 7,
    name: "Text",
    slug: "text",
    icon: "message-square",
    color: "#6B7280",
    position: 7,
    is_default: true,
    message_count: 0,
  },
  {
    id: 8,
    name: "Other",
    slug: "other",
    icon: "archive",
    color: "#64748B",
    position: 8,
    is_default: true,
    message_count: 0,
  },
];

type UseCategoriesResult = {
  categories: CategoryWithCount[];
  isLoading: boolean;
  isFallback: boolean;
};

function isCategoryWithCount(value: unknown): value is CategoryWithCount {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.icon === "string" &&
    typeof candidate.color === "string" &&
    typeof candidate.position === "number" &&
    typeof candidate.is_default === "boolean" &&
    typeof candidate.message_count === "number"
  );
}

function normalizeCategories(payload: unknown): CategoryWithCount[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  if (!payload.every(isCategoryWithCount)) {
    return null;
  }

  return [...payload].sort((first, second) => {
    if (first.position !== second.position) {
      return first.position - second.position;
    }
    return first.id - second.id;
  });
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<CategoryWithCount[]>(DEFAULT_CATEGORY_FALLBACK);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchCategories() {
      try {
        const response = await fetch(CATEGORIES_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Failed to fetch categories.");
        }

        const payload: unknown = await response.json();
        const parsed = normalizeCategories(payload);
        if (parsed === null) {
          throw new Error("Unexpected category payload.");
        }

        setCategories(parsed);
        setIsFallback(false);
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setCategories(DEFAULT_CATEGORY_FALLBACK);
        setIsFallback(true);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void fetchCategories();

    return () => {
      controller.abort();
    };
  }, []);

  return { categories, isLoading, isFallback };
}

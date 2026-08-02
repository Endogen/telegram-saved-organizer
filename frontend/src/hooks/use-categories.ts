import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { requestJson } from "@/api/client";
import {
  notifyOrganizationChanged,
  subscribeToOrganizationChanges,
} from "@/lib/organization-events";
import type { CategoryWithCount } from "@/types/category";

const CATEGORIES_ENDPOINT = "/api/categories";
export { CATEGORIES_CHANGED_EVENT } from "@/lib/organization-events";

export function notifyCategoriesChanged() {
  notifyOrganizationChanged("categories");
}

const DEFAULT_CATEGORY_FALLBACK: CategoryWithCount[] = [
  {
    id: 1,
    name: "Videos",
    slug: "videos",
    system_key: "videos",
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
    system_key: "audio",
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
    system_key: "links",
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
    system_key: "repositories",
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
    system_key: "images",
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
    system_key: "documents",
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
    system_key: "text",
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
    system_key: "other",
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
  error: string | null;
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
    (candidate.system_key === null || typeof candidate.system_key === "string") &&
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to fetch categories.";
}

let inFlightCategoryRequest: Promise<CategoryWithCount[]> | null = null;

function invalidateCategoryRequest() {
  inFlightCategoryRequest = null;
}

function requestCategories(): Promise<CategoryWithCount[]> {
  if (inFlightCategoryRequest !== null) {
    return inFlightCategoryRequest;
  }

  const request = requestJson<unknown>(CATEGORIES_ENDPOINT, undefined, {
    fallbackMessage: "Failed to fetch categories.",
  }).then((payload) => {
    const parsed = normalizeCategories(payload);
    if (parsed === null) {
      throw new Error("Unexpected category payload.");
    }
    return parsed;
  });
  const trackedRequest = request.finally(() => {
    if (inFlightCategoryRequest === trackedRequest) {
      inFlightCategoryRequest = null;
    }
  });
  inFlightCategoryRequest = trackedRequest;
  return trackedRequest;
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<CategoryWithCount[]>(DEFAULT_CATEGORY_FALLBACK);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const refresh = () => {
      invalidateCategoryRequest();
      setRefreshRevision((current) => current + 1);
    };
    return subscribeToOrganizationChanges("categories", refresh);
  }, []);

  useEffect(() => {
    let isCanceled = false;

    async function fetchCategories() {
      try {
        const parsed = await requestCategories();
        if (isCanceled) {
          return;
        }

        setCategories(parsed);
        setIsFallback(false);
        setError(null);
      } catch (fetchError) {
        if (isCanceled) {
          return;
        }
        setCategories(DEFAULT_CATEGORY_FALLBACK);
        setIsFallback(true);
        setError(toErrorMessage(fetchError));
      } finally {
        if (!isCanceled) {
          setIsLoading(false);
        }
      }
    }

    void fetchCategories();
    return () => {
      isCanceled = true;
    };
  }, [location.pathname, refreshRevision]);

  return { categories, isLoading, isFallback, error };
}

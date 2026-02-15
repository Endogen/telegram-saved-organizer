import type { MessageListItem, MessageListResponse } from "@/types/message";

const MESSAGES_BASE_PATH = "/api/messages";

type ApiErrorPayload = {
  detail?: unknown;
};

type MessageListQuery = {
  page?: number;
  per_page?: number;
  sort?: "date_desc" | "date_asc" | "category" | "sender";
  category?: string;
  search?: string;
  tag?: string[];
};

type BulkDeleteResponse = {
  deleted_count: number;
};

type BulkMoveResponse = {
  moved_count: number;
  category_id: number;
};

function toErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}

function parseMessageListResponse(payload: unknown): MessageListResponse | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as Partial<MessageListResponse>;
  if (!Array.isArray(candidate.items)) {
    return null;
  }
  if (typeof candidate.total !== "number") {
    return null;
  }
  if (typeof candidate.page !== "number") {
    return null;
  }
  if (typeof candidate.per_page !== "number") {
    return null;
  }

  return candidate as MessageListResponse;
}

function buildQueryString(query: MessageListQuery): string {
  const params = new URLSearchParams();

  if (typeof query.page === "number") {
    params.set("page", `${Math.max(1, Math.trunc(query.page))}`);
  }
  if (typeof query.per_page === "number") {
    params.set("per_page", `${Math.max(1, Math.trunc(query.per_page))}`);
  }
  if (typeof query.sort === "string" && query.sort.length > 0) {
    params.set("sort", query.sort);
  }
  if (typeof query.category === "string" && query.category.trim().length > 0) {
    params.set("category", query.category.trim());
  }
  if (typeof query.search === "string" && query.search.trim().length > 0) {
    params.set("search", query.search.trim());
  }
  if (Array.isArray(query.tag)) {
    for (const tag of query.tag) {
      if (tag.trim().length > 0) {
        params.append("tag", tag.trim());
      }
    }
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MESSAGES_BASE_PATH}${path}`, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(toErrorMessage(payload) ?? "Message request failed.");
  }

  return payload as T;
}

export async function listMessages(query: MessageListQuery = {}): Promise<MessageListResponse> {
  const payload = await requestJson<unknown>(buildQueryString(query));
  const parsed = parseMessageListResponse(payload);
  if (parsed === null) {
    throw new Error("Unexpected messages payload.");
  }
  return parsed;
}

export async function moveMessageToCategory(messageId: number, categoryId: number): Promise<MessageListItem> {
  return requestJson<MessageListItem>(`/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export async function deleteMessage(messageId: number): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/${messageId}`, { method: "DELETE" });
}

export async function bulkDeleteMessages(messageIds: number[]): Promise<BulkDeleteResponse> {
  return requestJson<BulkDeleteResponse>("/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

export async function bulkMoveMessages(messageIds: number[], categoryId: number): Promise<BulkMoveResponse> {
  return requestJson<BulkMoveResponse>("/bulk-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: messageIds, category_id: categoryId }),
  });
}

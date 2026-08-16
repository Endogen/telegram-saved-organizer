import type { MessageListItem, MessageListResponse } from "@/types/message";
import { ApiRequestError, requestJson } from "@/api/client";

const MESSAGES_BASE_PATH = "/api/messages";

export type MessageKind =
  | "text"
  | "link"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "mixed"
  | "other";

type MessageListQuery = {
  page?: number;
  per_page?: number;
  sort?: "date_desc" | "date_asc" | "category" | "sender";
  category?: string;
  search?: string;
  tag?: string[];
  kind?: MessageKind;
};

type BulkDeleteResponse = {
  deleted_count: number;
};

type BulkMoveResponse = {
  moved_count: number;
  category_id: number;
};

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
    params.set("per_page", `${Math.min(200, Math.max(1, Math.trunc(query.per_page)))}`);
  }
  if (typeof query.sort === "string" && query.sort.length > 0) {
    params.set("sort", query.sort);
  }
  if (typeof query.category === "string" && query.category.trim().length > 0) {
    params.set("category", query.category.trim());
  }
  if (typeof query.kind === "string" && query.kind.length > 0) {
    params.set("kind", query.kind);
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

export class TelegramNotConnectedError extends Error {
  constructor() {
    super("Telegram is not connected. Delete locally only?");
    this.name = "TelegramNotConnectedError";
  }
}

export class TelegramConnectionChangedError extends Error {
  constructor() {
    super("This message belongs to a previous Telegram connection.");
    this.name = "TelegramConnectionChangedError";
  }
}

async function requestMessageJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(`${MESSAGES_BASE_PATH}${path}`, init, {
      fallbackMessage: "Message request failed.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.detail === "telegram_not_connected") {
      throw new TelegramNotConnectedError();
    }
    if (
      error instanceof ApiRequestError
      && error.status === 409
      && error.detail === "telegram_connection_changed"
    ) {
      throw new TelegramConnectionChangedError();
    }
    throw error;
  }
}

export async function listMessages(query: MessageListQuery = {}): Promise<MessageListResponse> {
  const payload = await requestMessageJson<unknown>(buildQueryString(query));
  const parsed = parseMessageListResponse(payload);
  if (parsed === null) {
    throw new Error("Unexpected messages payload.");
  }
  return parsed;
}

export async function moveMessageToCategory(messageId: number, categoryId: number): Promise<MessageListItem> {
  return requestMessageJson<MessageListItem>(`/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export async function deleteMessage(messageId: number, localOnly = false): Promise<void> {
  const query = localOnly ? "?local_only=true" : "";
  await requestMessageJson<{ deleted: boolean }>(`/${messageId}${query}`, { method: "DELETE" });
}

export async function bulkDeleteMessages(messageIds: number[], localOnly = false): Promise<BulkDeleteResponse> {
  const query = localOnly ? "?local_only=true" : "";
  return requestMessageJson<BulkDeleteResponse>(`/bulk-delete${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

export async function clearAllMessages(): Promise<{ cleared_count: number }> {
  return requestMessageJson<{ cleared_count: number }>("/clear", { method: "POST" });
}

export async function bulkMoveMessages(messageIds: number[], categoryId: number): Promise<BulkMoveResponse> {
  return requestMessageJson<BulkMoveResponse>("/bulk-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: messageIds, category_id: categoryId }),
  });
}

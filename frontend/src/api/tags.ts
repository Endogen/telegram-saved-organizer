import type { MessageTag } from "@/types/message";

const TAGS_BASE_PATH = "/api";

type ApiErrorPayload = {
  detail?: unknown;
};

type MessageTagsResponse = {
  message_id: number;
  tags: MessageTag[];
};

type CreateTagRequest = {
  name: string;
  color?: string | null;
};

function toErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${TAGS_BASE_PATH}${path}`, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(toErrorMessage(payload) ?? "Tag request failed.");
  }

  return payload as T;
}

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function listTags(): Promise<MessageTag[]> {
  return requestJson<MessageTag[]>("/tags");
}

export async function createTag(payload: CreateTagRequest): Promise<MessageTag> {
  const normalizedName = normalizeTagName(payload.name);
  if (normalizedName.length === 0) {
    throw new Error("Tag name is required.");
  }

  return requestJson<MessageTag>("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizedName, color: payload.color ?? null }),
  });
}

export async function addTagsToMessage(messageId: number, tagIds: number[]): Promise<MessageTag[]> {
  const uniqueTagIds = [...new Set(tagIds.map((value) => Math.trunc(value)).filter((value) => value > 0))];
  if (uniqueTagIds.length === 0) {
    throw new Error("At least one tag id is required.");
  }

  const payload = await requestJson<MessageTagsResponse>(`/messages/${messageId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_ids: uniqueTagIds }),
  });

  return payload.tags;
}

export async function removeTagFromMessage(messageId: number, tagId: number): Promise<MessageTag[]> {
  const payload = await requestJson<MessageTagsResponse>(`/messages/${messageId}/tags/${tagId}`, {
    method: "DELETE",
  });

  return payload.tags;
}

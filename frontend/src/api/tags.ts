import type { MessageTag } from "@/types/message";
import { requestJson as requestApiJson } from "@/api/client";

const TAGS_BASE_PATH = "/api";

type MessageTagsResponse = {
  message_id: number;
  tags: MessageTag[];
};

type CreateTagRequest = {
  name: string;
  color?: string | null;
};

export type ManagedTag = MessageTag & {
  message_count: number;
};

type DeleteTagResponse = {
  deleted: boolean;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  return requestApiJson<T>(`${TAGS_BASE_PATH}${path}`, init, {
    fallbackMessage: "Tag request failed.",
  });
}

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function listTags(signal?: AbortSignal): Promise<MessageTag[]> {
  return requestJson<MessageTag[]>("/tags", { signal });
}

export async function listManagedTags(signal?: AbortSignal): Promise<ManagedTag[]> {
  return requestJson<ManagedTag[]>("/tags", { signal });
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

export async function updateTag(tagId: number, payload: CreateTagRequest): Promise<MessageTag> {
  const normalizedName = normalizeTagName(payload.name);
  if (normalizedName.length === 0) {
    throw new Error("Tag name is required.");
  }

  return requestJson<MessageTag>(`/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizedName, color: payload.color ?? null }),
  });
}

export async function deleteTag(tagId: number): Promise<void> {
  await requestJson<DeleteTagResponse>(`/tags/${tagId}`, {
    method: "DELETE",
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

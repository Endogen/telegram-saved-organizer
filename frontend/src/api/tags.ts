import type { MessageTag } from "@/types/message";
import { requestJson as requestApiJson } from "@/api/client";
import { notifyOrganizationChanged } from "@/lib/organization-events";

const TAGS_BASE_PATH = "/api";

type MessageTagsResponse = {
  message_id: number;
  tags: MessageTag[];
};

export type BulkTagResult = {
  updated_count: number;
  assignment_count: number;
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

  const tag = await requestJson<MessageTag>("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizedName, color: payload.color ?? null }),
  });
  notifyOrganizationChanged("tags");
  return tag;
}

export async function updateTag(tagId: number, payload: CreateTagRequest): Promise<MessageTag> {
  const normalizedName = normalizeTagName(payload.name);
  if (normalizedName.length === 0) {
    throw new Error("Tag name is required.");
  }

  const tag = await requestJson<MessageTag>(`/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizedName, color: payload.color ?? null }),
  });
  notifyOrganizationChanged("tags");
  return tag;
}

export async function deleteTag(tagId: number): Promise<void> {
  await requestJson<DeleteTagResponse>(`/tags/${tagId}`, {
    method: "DELETE",
  });
  notifyOrganizationChanged("tags");
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

  notifyOrganizationChanged("tags");
  return payload.tags;
}

export async function bulkAddTagsToMessages(
  messageIds: number[],
  tagIds: number[],
): Promise<BulkTagResult> {
  const uniqueMessageIds = [...new Set(
    messageIds.map((value) => Math.trunc(value)).filter((value) => value > 0),
  )];
  const uniqueTagIds = [...new Set(
    tagIds.map((value) => Math.trunc(value)).filter((value) => value > 0),
  )];
  if (uniqueMessageIds.length === 0) {
    throw new Error("At least one message id is required.");
  }
  if (uniqueTagIds.length === 0) {
    throw new Error("At least one tag id is required.");
  }

  const result = await requestJson<BulkTagResult>("/messages/bulk-tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: uniqueMessageIds, tag_ids: uniqueTagIds }),
  });
  notifyOrganizationChanged("tags");
  return result;
}

export async function removeTagFromMessage(messageId: number, tagId: number): Promise<MessageTag[]> {
  const payload = await requestJson<MessageTagsResponse>(`/messages/${messageId}/tags/${tagId}`, {
    method: "DELETE",
  });

  notifyOrganizationChanged("tags");
  return payload.tags;
}

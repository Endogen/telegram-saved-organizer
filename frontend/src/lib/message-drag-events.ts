const MESSAGE_DRAG_MIME = "application/x-saved-message-id";
const FALLBACK_MESSAGE_DRAG_MIME = "text/plain";

export const MESSAGE_DRAG_START_EVENT = "saved-messages:drag-start";
export const MESSAGE_DRAG_END_EVENT = "saved-messages:drag-end";
export const MESSAGE_DROP_TO_CATEGORY_EVENT = "saved-messages:drop-to-category";

export type MessageDragStartDetail = {
  messageId: number;
  categoryId: number;
};

export type MessageDropToCategoryDetail = {
  messageId: number;
  categoryId: number;
};

function toSafeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function parseMessageId(rawValue: string): number | null {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function dispatchCustomEvent<T>(name: string, detail: T): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function setDraggedMessageId(dataTransfer: DataTransfer | null, messageId: number): void {
  if (dataTransfer === null) {
    return;
  }

  const serialized = `${messageId}`;
  dataTransfer.setData(MESSAGE_DRAG_MIME, serialized);
  dataTransfer.setData(FALLBACK_MESSAGE_DRAG_MIME, serialized);
}

export function getDraggedMessageId(dataTransfer: DataTransfer | null): number | null {
  if (dataTransfer === null) {
    return null;
  }

  const primary = parseMessageId(dataTransfer.getData(MESSAGE_DRAG_MIME));
  if (primary !== null) {
    return primary;
  }

  return parseMessageId(dataTransfer.getData(FALLBACK_MESSAGE_DRAG_MIME));
}

export function announceMessageDragStart(detail: MessageDragStartDetail): void {
  dispatchCustomEvent(MESSAGE_DRAG_START_EVENT, detail);
}

export function announceMessageDragEnd(): void {
  dispatchCustomEvent(MESSAGE_DRAG_END_EVENT, null);
}

export function announceMessageDropToCategory(detail: MessageDropToCategoryDetail): void {
  dispatchCustomEvent(MESSAGE_DROP_TO_CATEGORY_EVENT, detail);
}

export function readMessageDragStartEvent(event: Event): MessageDragStartDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as Partial<MessageDragStartDetail> | null;
  if (detail === null || typeof detail !== "object") {
    return null;
  }

  const messageId = toSafeInteger(detail.messageId);
  const categoryId = toSafeInteger(detail.categoryId);
  if (messageId === null || categoryId === null) {
    return null;
  }

  return { messageId, categoryId };
}

export function readMessageDropToCategoryEvent(event: Event): MessageDropToCategoryDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as Partial<MessageDropToCategoryDetail> | null;
  if (detail === null || typeof detail !== "object") {
    return null;
  }

  const messageId = toSafeInteger(detail.messageId);
  const categoryId = toSafeInteger(detail.categoryId);
  if (messageId === null || categoryId === null) {
    return null;
  }

  return { messageId, categoryId };
}

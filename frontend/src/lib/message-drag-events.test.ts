import { describe, expect, it, vi } from "vitest";

import {
  announceMessageDragEnd,
  announceMessageDragStart,
  announceMessageDropToCategory,
  getDraggedMessageId,
  MESSAGE_DRAG_END_EVENT,
  MESSAGE_DRAG_START_EVENT,
  MESSAGE_DROP_TO_CATEGORY_EVENT,
  readMessageDragStartEvent,
  readMessageDropToCategoryEvent,
  setDraggedMessageId,
} from "@/lib/message-drag-events";

describe("setDraggedMessageId / getDraggedMessageId", () => {
  it("stores and retrieves message id from DataTransfer", () => {
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (key: string, value: string) => store.set(key, value),
      getData: (key: string) => store.get(key) ?? "",
    } as unknown as DataTransfer;

    setDraggedMessageId(dataTransfer, 42);
    expect(getDraggedMessageId(dataTransfer)).toBe(42);
  });

  it("returns null for null dataTransfer", () => {
    setDraggedMessageId(null, 42);
    expect(getDraggedMessageId(null)).toBeNull();
  });

  it("returns null for non-integer or negative values", () => {
    const dataTransfer = {
      getData: () => "abc",
    } as unknown as DataTransfer;

    expect(getDraggedMessageId(dataTransfer)).toBeNull();

    const dtNegative = {
      getData: () => "-5",
    } as unknown as DataTransfer;

    expect(getDraggedMessageId(dtNegative)).toBeNull();
  });

  it("falls back to text/plain when primary mime is empty", () => {
    const dataTransfer = {
      getData: (key: string) => {
        if (key === "application/x-saved-message-id") return "";
        if (key === "text/plain") return "99";
        return "";
      },
    } as unknown as DataTransfer;

    expect(getDraggedMessageId(dataTransfer)).toBe(99);
  });
});

describe("announceMessageDragStart / readMessageDragStartEvent", () => {
  it("dispatches and reads drag start events", () => {
    const handler = vi.fn();
    window.addEventListener(MESSAGE_DRAG_START_EVENT, handler);

    try {
      announceMessageDragStart({ messageId: 10, categoryId: 3 });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(readMessageDragStartEvent(event)).toEqual({
        messageId: 10,
        categoryId: 3,
      });
    } finally {
      window.removeEventListener(MESSAGE_DRAG_START_EVENT, handler);
    }
  });

  it("returns null for non-CustomEvent", () => {
    expect(readMessageDragStartEvent(new Event("test"))).toBeNull();
  });

  it("returns null for null detail", () => {
    const event = new CustomEvent("test", { detail: null });
    expect(readMessageDragStartEvent(event)).toBeNull();
  });

  it("returns null for non-integer values in detail", () => {
    const event = new CustomEvent("test", {
      detail: { messageId: "abc", categoryId: 3 },
    });
    expect(readMessageDragStartEvent(event)).toBeNull();
  });

  it("returns null for float messageId", () => {
    const event = new CustomEvent("test", {
      detail: { messageId: 1.5, categoryId: 3 },
    });
    expect(readMessageDragStartEvent(event)).toBeNull();
  });
});

describe("announceMessageDragEnd", () => {
  it("dispatches drag end event", () => {
    const handler = vi.fn();
    window.addEventListener(MESSAGE_DRAG_END_EVENT, handler);

    try {
      announceMessageDragEnd();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MESSAGE_DRAG_END_EVENT, handler);
    }
  });
});

describe("announceMessageDropToCategory / readMessageDropToCategoryEvent", () => {
  it("dispatches and reads drop events", () => {
    const handler = vi.fn();
    window.addEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, handler);

    try {
      announceMessageDropToCategory({ messageId: 5, categoryId: 8 });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(readMessageDropToCategoryEvent(event)).toEqual({
        messageId: 5,
        categoryId: 8,
      });
    } finally {
      window.removeEventListener(MESSAGE_DROP_TO_CATEGORY_EVENT, handler);
    }
  });

  it("returns null for non-CustomEvent", () => {
    expect(readMessageDropToCategoryEvent(new Event("test"))).toBeNull();
  });

  it("returns null for null detail", () => {
    const event = new CustomEvent("test", { detail: null });
    expect(readMessageDropToCategoryEvent(event)).toBeNull();
  });

  it("returns null for non-integer fields", () => {
    const event = new CustomEvent("test", {
      detail: { messageId: 5, categoryId: "x" },
    });
    expect(readMessageDropToCategoryEvent(event)).toBeNull();
  });
});

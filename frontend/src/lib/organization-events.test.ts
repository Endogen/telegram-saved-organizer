import { afterEach, describe, expect, it, vi } from "vitest";

class BroadcastChannelMock {
  static instances: BroadcastChannelMock[] = [];

  readonly name: string;
  readonly postMessage = vi.fn();
  private messageListener: EventListenerOrEventListenerObject | null = null;

  constructor(name: string) {
    this.name = name;
    BroadcastChannelMock.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") {
      this.messageListener = listener;
    }
  }

  close() {}

  emit(data: unknown) {
    const event = new MessageEvent("message", { data });
    if (typeof this.messageListener === "function") {
      this.messageListener(event);
    } else {
      this.messageListener?.handleEvent(event);
    }
  }
}

describe("organization events", () => {
  afterEach(() => {
    BroadcastChannelMock.instances = [];
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("notifies the current tab and publishes a versioned cross-tab message", async () => {
    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
    const { notifyOrganizationChanged, subscribeToOrganizationChanges } = await import(
      "@/lib/organization-events"
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToOrganizationChanges("categories", listener);

    notifyOrganizationChanged("categories");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(BroadcastChannelMock.instances).toHaveLength(1);
    expect(BroadcastChannelMock.instances[0].name).toBe("tso:organization");
    expect(BroadcastChannelMock.instances[0].postMessage).toHaveBeenCalledWith({
      version: 1,
      resource: "categories",
    });
    unsubscribe();
  });

  it("forwards valid messages received from another tab to matching subscribers", async () => {
    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
    const { subscribeToOrganizationChanges } = await import("@/lib/organization-events");
    const categoryListener = vi.fn();
    const tagListener = vi.fn();
    const unsubscribeCategories = subscribeToOrganizationChanges("categories", categoryListener);
    const unsubscribeTags = subscribeToOrganizationChanges("tags", tagListener);
    const channel = BroadcastChannelMock.instances[0];

    channel.emit({ version: 1, resource: "tags" });
    channel.emit({ version: 2, resource: "categories" });
    channel.emit({ resource: "tags" });

    expect(tagListener).toHaveBeenCalledTimes(1);
    expect(categoryListener).not.toHaveBeenCalled();
    unsubscribeCategories();
    unsubscribeTags();
  });

  it("continues to synchronize same-tab listeners when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const { notifyOrganizationChanged, subscribeToOrganizationChanges } = await import(
      "@/lib/organization-events"
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToOrganizationChanges("tags", listener);

    expect(() => notifyOrganizationChanged("tags")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

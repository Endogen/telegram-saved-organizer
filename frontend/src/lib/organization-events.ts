export const CATEGORIES_CHANGED_EVENT = "tso:categories-changed";
export const TAGS_CHANGED_EVENT = "tso:tags-changed";

const ORGANIZATION_CHANNEL = "tso:organization";
const MESSAGE_VERSION = 1;

export type OrganizationResource = "categories" | "tags";

type OrganizationChangeMessage = {
  version: typeof MESSAGE_VERSION;
  resource: OrganizationResource;
};

const eventNames: Record<OrganizationResource, string> = {
  categories: CATEGORIES_CHANGED_EVENT,
  tags: TAGS_CHANGED_EVENT,
};

let broadcastChannel: BroadcastChannel | null | undefined;

function isOrganizationChangeMessage(value: unknown): value is OrganizationChangeMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<OrganizationChangeMessage>;
  return (
    candidate.version === MESSAGE_VERSION
    && (candidate.resource === "categories" || candidate.resource === "tags")
  );
}

function dispatchLocal(resource: OrganizationResource) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(eventNames[resource]));
  }
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) {
    return broadcastChannel;
  }

  broadcastChannel = null;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }

  try {
    const channel = new BroadcastChannel(ORGANIZATION_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (isOrganizationChangeMessage(event.data)) {
        dispatchLocal(event.data.resource);
      }
    });
    broadcastChannel = channel;
  } catch {
    // Private browsing policies and hardened environments may deny channel use.
    // The local DOM event remains available as the same-tab fallback.
  }

  return broadcastChannel;
}

export function notifyOrganizationChanged(resource: OrganizationResource) {
  dispatchLocal(resource);

  try {
    getBroadcastChannel()?.postMessage({ version: MESSAGE_VERSION, resource } satisfies OrganizationChangeMessage);
  } catch {
    // A channel can become unavailable after construction. Local listeners have
    // already been notified, so organization controls remain synchronized here.
  }
}

export function subscribeToOrganizationChanges(
  resource: OrganizationResource,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const eventName = eventNames[resource];
  window.addEventListener(eventName, listener);
  getBroadcastChannel();
  return () => window.removeEventListener(eventName, listener);
}

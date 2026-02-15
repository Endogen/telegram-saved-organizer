import type { ScanStatus } from "@/types/scan";

const SCAN_BASE_PATH = "/api/scan";

type ApiErrorPayload = {
  detail?: unknown;
};

function toErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}

async function requestScanStatus(path: string, init?: RequestInit): Promise<ScanStatus> {
  const response = await fetch(`${SCAN_BASE_PATH}${path}`, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(toErrorMessage(payload) ?? "Scan request failed.");
  }

  return payload as ScanStatus;
}

export async function fetchScanStatus(): Promise<ScanStatus> {
  return requestScanStatus("/status");
}

export async function startScan(pageSize = 100): Promise<ScanStatus> {
  const normalizedPageSize = Number.isFinite(pageSize) ? Math.min(1000, Math.max(1, Math.trunc(pageSize))) : 100;
  return requestScanStatus(`/start?page_size=${normalizedPageSize}`, {
    method: "POST",
  });
}

export async function stopScan(): Promise<ScanStatus> {
  return requestScanStatus("/stop", { method: "POST" });
}

type ScanStatusSubscriptionOptions = {
  onStatus: (status: ScanStatus) => void;
  onOpen?: () => void;
  onError?: (message: string) => void;
};

type ScanStatusSubscription = {
  close: () => void;
};

function parseScanStatus(payload: string): ScanStatus {
  return JSON.parse(payload) as ScanStatus;
}

export function subscribeToScanStatus(options: ScanStatusSubscriptionOptions): ScanStatusSubscription {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    options.onError?.("Live scan updates are not available in this environment.");
    return { close: () => undefined };
  }

  const source = new window.EventSource(`${SCAN_BASE_PATH}/stream`);

  const handleOpen = () => {
    options.onOpen?.();
  };
  const handleStatus = (event: Event) => {
    try {
      const messageEvent = event as MessageEvent<string>;
      options.onStatus(parseScanStatus(messageEvent.data));
    } catch {
      options.onError?.("Received an invalid live scan status payload.");
    }
  };
  const handleError = () => {
    options.onError?.("Live scan updates disconnected. Falling back to polling.");
  };

  source.addEventListener("open", handleOpen);
  source.addEventListener("status", handleStatus);
  source.addEventListener("error", handleError);

  return {
    close: () => {
      source.removeEventListener("open", handleOpen);
      source.removeEventListener("status", handleStatus);
      source.removeEventListener("error", handleError);
      source.close();
    },
  };
}

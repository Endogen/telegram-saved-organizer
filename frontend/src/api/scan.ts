import type { ScanStatus } from "@/types/scan";
import { requestJson } from "@/api/client";

const SCAN_BASE_PATH = "/api/scan";

async function requestScanStatus(path: string, init?: RequestInit): Promise<ScanStatus> {
  return requestJson<ScanStatus>(`${SCAN_BASE_PATH}${path}`, init, {
    fallbackMessage: "Scan request failed.",
  });
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

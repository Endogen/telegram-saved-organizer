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

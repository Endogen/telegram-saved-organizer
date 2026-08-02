export const API_UNAUTHORIZED_EVENT = "tso:api-unauthorized";

type ApiErrorPayload = {
  detail?: unknown;
};

type RequestJsonOptions = {
  fallbackMessage?: string;
  notifyUnauthorized?: boolean;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(message: string, status: number, detail: string | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.detail = detail;
  }
}

function errorDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "same-origin",
  });
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options: RequestJsonOptions = {},
): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const detail = errorDetail(payload);
    if (response.status === 401 && options.notifyUnauthorized !== false && typeof window !== "undefined") {
      window.dispatchEvent(new Event(API_UNAUTHORIZED_EVENT));
    }
    throw new ApiRequestError(
      detail ?? options.fallbackMessage ?? "The API request failed.",
      response.status,
      detail,
    );
  }

  return payload as T;
}

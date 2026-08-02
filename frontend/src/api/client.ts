export const API_UNAUTHORIZED_EVENT = "tso:api-unauthorized";
const CSRF_COOKIE_NAMES = ["__Host-tso_csrf", "tso_csrf"] as const;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type ApiUnauthorizedDetail = {
  path: string;
};

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

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (entry === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function withCsrfHeader(init?: RequestInit): RequestInit | undefined {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return init;
  }

  const csrfToken = CSRF_COOKIE_NAMES
    .map((cookieName) => readCookie(cookieName))
    .find((value): value is string => value !== null && value.length > 0);
  if (csrfToken === undefined) {
    return init;
  }

  const headers = new Headers(init?.headers);
  if (!headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  return { ...init, headers };
}

function errorDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const detail = (payload as ApiErrorPayload).detail;
  if (typeof detail === "string") {
    return detail.length > 0 ? detail : null;
  }
  if (!Array.isArray(detail) || detail.length === 0) {
    return null;
  }

  const firstError = detail[0];
  if (typeof firstError !== "object" || firstError === null || !("msg" in firstError)) {
    return null;
  }

  const message = firstError.msg;
  if (typeof message !== "string") {
    return null;
  }

  const normalizedMessage = message.trim().replace(/^Value error,\s*/, "");
  return normalizedMessage.length > 0 ? normalizedMessage : null;
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const securedInit = withCsrfHeader(init);
  return fetch(path, {
    ...securedInit,
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
      window.dispatchEvent(
        new CustomEvent<ApiUnauthorizedDetail>(API_UNAUTHORIZED_EVENT, {
          detail: { path },
        }),
      );
    }
    throw new ApiRequestError(
      detail ?? options.fallbackMessage ?? "The API request failed.",
      response.status,
      detail,
    );
  }

  return payload as T;
}

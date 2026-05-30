// Thin client for echo-server. No React. Reads the base + token from settings.
import { getApiToken, resolveApiBase } from "../settings";
import type { ApiError } from "./contracts";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function requireToken(): string {
  const token = getApiToken();
  if (!token) {
    throw new ApiClientError("no token configured", 0, "no_token");
  }
  return token;
}

function url(path: string): string {
  return `${resolveApiBase()}${path}`;
}

async function toApiError(res: Response): Promise<ApiClientError> {
  let code = "http_error";
  let detail = "";
  try {
    const body = (await res.json()) as ApiError;
    code = body.error ?? code;
    detail = body.detail ?? "";
  } catch {
    /* non-JSON error body */
  }
  return new ApiClientError(detail || code || `HTTP ${res.status}`, res.status, code);
}

/** POST JSON, get JSON back. Throws ApiClientError on any non-2xx. */
export async function apiFetchJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireToken()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

/** POST JSON, get binary back (e.g. /v1/tts). Throws ApiClientError on non-2xx. */
export async function apiFetchBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireToken()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

/** Unauthenticated reachability check. */
export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(url("/health"), { signal });
  return res.ok;
}

/** Authenticated round-trip — validates the token end to end. */
export async function checkAuth(signal?: AbortSignal): Promise<void> {
  const res = await fetch(url("/v1/ping"), {
    headers: { Authorization: `Bearer ${requireToken()}` },
    signal,
  });
  if (!res.ok) throw await toApiError(res);
}

// Thin client for echo-server. No React. Reads the base + token from settings.
import { getApiToken, resolveApiBase } from "../settings";
import type { ApiError, JobState, JobSubmitResult, JobTask } from "./contracts";

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

/**
 * POST JSON, consume an SSE stream. `onProgress` fires for each `progress`
 * event; resolves with the payload of the `done` event. Throws on `error`
 * events or non-2xx. Used for long generations (scenario) to show live
 * progress instead of a blank wait.
 */
export async function apiFetchSSE<T>(
  path: string,
  body: unknown,
  onProgress: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireToken()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  let failure: ApiClientError | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (event === "progress") onProgress(JSON.parse(data));
      else if (event === "done") result = JSON.parse(data) as T;
      else if (event === "error") {
        const d = JSON.parse(data) as ApiError;
        failure = new ApiClientError(d.detail || d.error || "stream_error", 502, d.error || "stream_error");
      }
    }
  }

  if (failure) throw failure;
  if (result === undefined) {
    throw new ApiClientError("stream ended without a result", 502, "no_result");
  }
  return result;
}

/** GET JSON. Throws ApiClientError on any non-2xx. */
export async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path), {
    headers: { Authorization: `Bearer ${requireToken()}` },
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

// --- Async jobs: submit a slow task, then poll for the result. This is how the
// long generations survive the Cloudflare tunnel's ~100s edge timeout — each
// request (submit, each poll) is short, while the LLM runs server-side and the
// result is held in the DB until fetched. submitJob + pollJob are split so the
// caller can persist the jobId and resume polling after a reload/disconnect.

const POLL_INTERVAL_MS = 3000;

export async function submitJob(
  task: JobTask,
  input: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const r = await apiFetchJson<JobSubmitResult>("/v1/jobs", { task, input }, signal);
  return r.jobId;
}

/** Poll a job to completion. `onProgress` fires with the scenario sentence
 *  count (0 for other tasks). Throws ApiClientError if the job errored. */
export async function pollJob<T>(
  jobId: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  for (;;) {
    const state = await apiGetJson<JobState>(`/v1/jobs/${jobId}`, signal);
    onProgress?.(state.progress ?? 0);
    if (state.status === "done") return state.result as T;
    if (state.status === "error") {
      throw new ApiClientError(state.error || "job failed", 502, "job_error");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Submit + poll in one call (when you don't need to persist the jobId). */
export async function runJob<T>(
  task: JobTask,
  input: unknown,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const jobId = await submitJob(task, input, signal);
  return pollJob<T>(jobId, onProgress, signal);
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

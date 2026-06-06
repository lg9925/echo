// Thin client for echo-server. No React. Reads the base + token from settings.
import { getApiToken, resolveApiBase } from "../settings";
import type {
  ApiError,
  JobState,
  JobSubmitResult,
  JobTask,
  JudgeRequest,
  JudgeResult,
  RoutingState,
  RoutingUpdate,
} from "./contracts";

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

// Gateway/edge statuses that mean the request died before (or after) our origin
// — Cloudflare returns these as HTML, not JSON. 524 is the tunnel's ~100s edge
// timeout (see server/CLAUDE.md → async jobs).
const GATEWAY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

async function toApiError(res: Response): Promise<ApiClientError> {
  let body: ApiError | undefined;
  try {
    body = (await res.json()) as ApiError;
  } catch {
    /* non-JSON error body — i.e. NOT echo-server (see below) */
  }
  // echo-server always answers with JSON {error, detail?}. A non-JSON body means
  // we never reached it — almost always a wrong API 地址 in 高级设置, a down
  // tunnel, or a Cloudflare edge timeout (524). Surface that plainly instead of
  // the opaque "http_error" the user actually hit.
  if (!body?.error) {
    const why = GATEWAY_STATUS.has(res.status)
      ? `服务器无响应或超时 (HTTP ${res.status})`
      : `服务器返回了异常响应 (HTTP ${res.status})`;
    return new ApiClientError(
      `无法连接到服务器，请检查高级设置里的 API 地址。${why}`,
      res.status,
      "unreachable",
    );
  }
  return new ApiClientError(body.detail || body.error, res.status, body.error);
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

/** GET JSON. Throws ApiClientError on any non-2xx. */
export async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path), {
    headers: { Authorization: `Bearer ${requireToken()}` },
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

/** PUT JSON, get JSON back. Throws ApiClientError on any non-2xx. */
export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

// --- LLM model routing (admin): read the per-task provider/model and switch it
// at runtime (no backend restart). Backs the advanced-settings "model选择". ---

export function getRouting(signal?: AbortSignal): Promise<RoutingState> {
  return apiGetJson<RoutingState>("/v1/routing", signal);
}

export function setRouting(update: RoutingUpdate): Promise<unknown> {
  return apiPutJson("/v1/routing", update);
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

/** 复习裁判: judge a typed review answer by meaning/naturalness. */
export function judge(req: JudgeRequest, signal?: AbortSignal): Promise<JudgeResult> {
  return apiFetchJson<JudgeResult>("/v1/judge", req, signal);
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

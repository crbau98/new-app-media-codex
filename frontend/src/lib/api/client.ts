/**
 * Typed API client — the only place `fetch` is called in the app.
 *
 * Guarantees (paired with the backend's core/ module):
 *  - RFC 9457 problems are normalized into a throwable `ApiProblem`.
 *  - Every request carries X-Request-ID for log correlation; the response's
 *    request id is attached to thrown problems ("copy request id" in the UI).
 *  - Mutations pass an Idempotency-Key generated per user intent and reused
 *    across retries (createIdempotencyKey).
 *  - Every request has a timeout; callers can layer their own AbortSignal.
 */

import type { CursorPage, ProblemDetails, QueryParams } from "./types";
import { apiUrl } from "../backendOrigin";

export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly fieldErrors?: ProblemDetails["errors"];

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiProblem";
    this.status = problem.status;
    this.type = problem.type;
    this.title = problem.title;
    this.detail = problem.detail;
    this.requestId = problem.request_id;
    this.fieldErrors = problem.errors;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isValidationError(): boolean {
    return this.status === 422;
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: QueryParams;
  body?: unknown;
  /** Reuse the same key across retries of one user intent. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(apiUrl(path), window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

function isProblemDetails(payload: unknown): payload is ProblemDetails {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    "status" in payload &&
    typeof (payload as { status: unknown }).status === "number"
  );
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, idempotencyKey, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "TimeoutError";
    throw new ApiProblem({
      type: aborted ? "https://mediacodex.dev/problems/timeout" : "https://mediacodex.dev/problems/network-error",
      title: aborted ? "Request timed out" : "Network error",
      status: 0,
      detail: aborted ? `No response within ${timeoutMs}ms.` : "The backend could not be reached.",
      request_id: requestId,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (isProblemDetails(payload)) {
      throw new ApiProblem({ ...payload, request_id: payload.request_id ?? requestId });
    }
    throw new ApiProblem({
      type: "https://mediacodex.dev/problems/http-error",
      title: `HTTP ${response.status}`,
      status: response.status,
      request_id: requestId,
    });
  }
  return payload as T;
}

export type { CursorPage };

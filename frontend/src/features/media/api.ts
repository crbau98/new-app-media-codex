/**
 * Media feature endpoint functions. Thin, typed wrappers over lib/api/client —
 * no React, no caching decisions (those live in hooks.ts / TanStack Query).
 */

import { apiFetch, createIdempotencyKey } from "../../lib/api/client";
import type { CursorPage } from "../../lib/api/types";
import type { MediaItem, MediaListFilters } from "./types";

const V1 = "/api/v1";

export function listMedia(
  filters: MediaListFilters,
  cursor?: string,
  limit = 50,
): Promise<CursorPage<MediaItem>> {
  return apiFetch<CursorPage<MediaItem>>(`${V1}/media`, {
    query: { ...filters, cursor, limit },
  });
}

export function getMedia(id: string): Promise<MediaItem> {
  return apiFetch<MediaItem>(`${V1}/media/${encodeURIComponent(id)}`);
}

export interface ViewEventInput {
  media_id: string;
  session_id: string;
  watched_seconds: number;
}

/**
 * Example of the v1 mutation contract: one Idempotency-Key per viewing
 * intent; if the user retries (flaky network), the backend dedupes instead
 * of double-counting the view.
 */
export function recordView(input: ViewEventInput, idempotencyKey?: string): Promise<void> {
  return apiFetch<void>(`${V1}/engagement/views`, {
    method: "POST",
    body: input,
    idempotencyKey: idempotencyKey ?? createIdempotencyKey(),
  });
}

/**
 * Media feature hooks — the reference implementation of the v2 data-layer
 * conventions (docs/architecture/frontend-redesign.md section 3):
 *
 *  - server state lives in TanStack Query only, keyed via query-keys.ts
 *  - infinite lists consume the backend's cursor envelope, never offset math
 *  - mutations hold ONE idempotency key per mounted intent, reused on retry
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createIdempotencyKey } from "../../lib/api/client";
import { mediaKeys } from "../../lib/api/query-keys";
import { getMedia, listMedia, recordView, type ViewEventInput } from "./api";
import type { MediaListFilters } from "./types";

const LIST_STALE_TIME_MS = 30_000;

export function useInfiniteMedia(filters: MediaListFilters) {
  return useInfiniteQuery({
    queryKey: mediaKeys.list({ ...filters }),
    queryFn: ({ pageParam }) => listMedia(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.page.has_more ? (lastPage.page.next_cursor ?? undefined) : undefined,
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function useMedia(id: string | undefined) {
  return useQuery({
    queryKey: mediaKeys.detail(id ?? "__none__"),
    queryFn: () => getMedia(id as string),
    enabled: Boolean(id),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function useRecordView() {
  const queryClient = useQueryClient();
  // One key per mounted hook instance == one key per user intent. Retries of
  // the same mutation replay the same key; the backend dedupes (24h window).
  const [idempotencyKey] = useState(createIdempotencyKey);

  return useMutation({
    mutationFn: (input: ViewEventInput) => recordView(input, idempotencyKey),
    onSuccess: (_data, input) => {
      // Engagement affects detail stats; lists stay as-is (append-only events
      // roll up asynchronously via the outbox — blueprint section 9).
      void queryClient.invalidateQueries({ queryKey: mediaKeys.detail(input.media_id) });
    },
  });
}

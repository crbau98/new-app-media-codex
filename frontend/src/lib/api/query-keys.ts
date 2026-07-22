/**
 * The single query-key factory. ALL TanStack Query keys come from here —
 * ad-hoc key strings are the #1 source of stale-cache bugs. Invalidation is
 * always by prefix: queryClient.invalidateQueries({ queryKey: mediaKeys.lists() }).
 */

const asKey = <T extends readonly unknown[]>(key: T): T => key;

export const mediaKeys = {
  all: asKey(["media"]),
  lists: () => asKey([...mediaKeys.all, "list"]),
  list: (filters: object) => asKey([...mediaKeys.lists(), filters]),
  details: () => asKey([...mediaKeys.all, "detail"]),
  detail: (id: string) => asKey([...mediaKeys.details(), id]),
};

export const performerKeys = {
  all: asKey(["performers"]),
  lists: () => asKey([...performerKeys.all, "list"]),
  list: (filters: object) => asKey([...performerKeys.lists(), filters]),
  details: () => asKey([...performerKeys.all, "detail"]),
  detail: (id: string) => asKey([...performerKeys.details(), id]),
  scans: () => asKey([...performerKeys.all, "scan"]),
  scan: (jobId: string) => asKey([...performerKeys.scans(), jobId]),
};

export const collectionKeys = {
  all: asKey(["collections"]),
  detail: (id: string) => asKey([...collectionKeys.all, "detail", id]),
};

export const playlistKeys = {
  all: asKey(["playlists"]),
  detail: (id: string) => asKey([...playlistKeys.all, "detail", id]),
};

export const jobKeys = {
  all: asKey(["jobs"]),
  detail: (id: string) => asKey([...jobKeys.all, "detail", id]),
};

export const statsKeys = {
  summary: asKey(["stats", "summary"]),
};

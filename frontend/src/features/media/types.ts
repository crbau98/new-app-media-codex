/** Media feature domain types — mirror of app/api/v1/media.py DTOs. */

export type MediaKind = "image" | "video" | "gif";

export interface SourceRef {
  provider: string;
  external_id: string;
  canonical_url: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  tags: string[];
  source: SourceRef;
  thumbnail_url: string | null;
  checksum: string | null;
  captured_at: string;
}

/** Allow-listed filters — must stay in sync with the v1 media router. */
export interface MediaListFilters {
  kind?: MediaKind;
  provider?: string;
  tag?: string;
  q?: string;
}

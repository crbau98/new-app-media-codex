/**
 * Shared API transport types — mirrors the backend's v1 contracts
 * (docs/architecture/backend-redesign.md section 5).
 * Phase 1: these are superseded by openapi-typescript generated types.
 */

/** RFC 9457 problem-details body emitted by every v1 error. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: Array<{ field: string; message: string; type: string }>;
}

export interface CursorPageInfo {
  next_cursor: string | null;
  has_more: boolean;
}

/** Standard v1 list envelope. */
export interface CursorPage<T> {
  data: T[];
  page: CursorPageInfo;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

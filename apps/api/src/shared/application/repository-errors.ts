/** Thrown by repositories when inserting an `_id` that already exists (any user). */
export class DuplicateIdError extends Error {
  constructor(public readonly id: string) {
    super('duplicate id');
  }
}

export interface HistoryParams {
  /** inclusive lower bound */
  from?: Date | undefined;
  /** exclusive upper bound */
  to?: Date | undefined;
  /** opaque cursor from a previous page */
  cursor?: string | undefined;
  limit: number;
}

export interface HistoryPage<T> {
  items: T[];
  nextCursor: string | null;
  /** first item after the page (if any) — chronologically previous to the page's last item */
  lookahead: T | null;
}

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

export function historyParams(q: { from?: string | undefined; to?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): HistoryParams {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    cursor: q.cursor,
    limit: Math.min(Math.max(q.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT),
  };
}

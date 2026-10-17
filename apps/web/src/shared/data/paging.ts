import type { HistoryQuery } from '@zelo/contracts';

/**
 * Fetches every item of a history query by following cursors (charts must use all
 * records of the period, independent of the history list paging).
 */
export async function fetchAllPages<T>(
  list: (q: HistoryQuery) => Promise<{ items: T[]; nextCursor: string | null }>,
  query: Omit<HistoryQuery, 'cursor' | 'limit'>,
  maxPages = 100,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await list({ ...query, limit: 200, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

import type { Document, Filter } from 'mongodb';

/** Opaque cursor for (measuredAt desc, _id desc) histories. */
export interface HistoryPosition {
  measuredAt: Date;
  id: string;
}

export function encodeHistoryCursor(pos: HistoryPosition): string {
  return Buffer.from(JSON.stringify({ m: pos.measuredAt.toISOString(), i: pos.id })).toString('base64url');
}

export function decodeHistoryCursor(cursor: string): HistoryPosition | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { m?: unknown; i?: unknown };
    if (typeof raw.m !== 'string' || typeof raw.i !== 'string') return null;
    const d = new Date(raw.m);
    if (Number.isNaN(d.getTime())) return null;
    return { measuredAt: d, id: raw.i };
  } catch {
    return null;
  }
}

export interface HistoryRange {
  from?: Date;
  to?: Date;
  after?: HistoryPosition | null;
}

/** Builds the Mongo filter for a userId-scoped, non-deleted history page. */
export function historyFilter<T extends Document>(userId: string, range: HistoryRange): Filter<T> {
  const and: Document[] = [{ userId }, { deletedAt: null }];
  const measured: Document = {};
  if (range.from) measured.$gte = range.from;
  if (range.to) measured.$lt = range.to;
  if (Object.keys(measured).length) and.push({ measuredAt: measured });
  if (range.after) {
    and.push({
      $or: [
        { measuredAt: { $lt: range.after.measuredAt } },
        { measuredAt: range.after.measuredAt, _id: { $lt: range.after.id } },
      ],
    });
  }
  return { $and: and } as Filter<T>;
}

export const HISTORY_SORT = { measuredAt: -1, _id: -1 } as const;

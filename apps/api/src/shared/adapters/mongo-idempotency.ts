import { createHash } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { IdempotencyConflictError } from '../domain/errors.js';
import type { Clock, IdempotentExecutor, IdGenerator, TxContext, UnitOfWork } from '../application/ports.js';
import { sessionOf } from './mongo-unit-of-work.js';

export interface IdempotencyKeyDoc {
  _id: string;
  userId: string;
  operationId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
}

export const IDEMPOTENCY_KEYS = 'idempotencyKeys';

/** Deterministic JSON (sorted keys, undefined dropped) → sha256 hex. */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/**
 * Stores {userId, operationId, requestHash, response} in the SAME transaction as the mutation,
 * so either both commit or neither does. Replays return the stored response.
 */
export class MongoIdempotentExecutor implements IdempotentExecutor {
  private readonly keys: Collection<IdempotencyKeyDoc>;

  constructor(
    db: Db,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.keys = db.collection<IdempotencyKeyDoc>(IDEMPOTENCY_KEYS);
  }

  async execute(
    userId: string,
    operationId: string,
    requestPayload: unknown,
    work: (tx: TxContext) => Promise<{ status: number; body: unknown }>,
  ): Promise<{ status: number; body: unknown; replayed: boolean }> {
    const requestHash = stableHash(requestPayload);
    const attempt = () =>
      this.uow.run(async (tx) => {
        const session = sessionOf(tx);
        const existing = await this.keys.findOne({ userId, operationId }, { session });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
          return { status: existing.responseStatus, body: existing.responseBody ?? null, replayed: true };
        }
        const result = await work(tx);
        const body = result.body === undefined ? null : JSON.parse(JSON.stringify(result.body));
        await this.keys.insertOne(
          {
            _id: this.ids.next(),
            userId,
            operationId,
            requestHash,
            responseStatus: result.status,
            responseBody: body,
            createdAt: this.clock.now(),
          },
          { session },
        );
        return { status: result.status, body: result.body ?? null, replayed: false };
      });
    try {
      return await attempt();
    } catch (err) {
      // A concurrent request with the same operationId committed first → replay it.
      if (isDuplicateKey(err)) return attempt();
      throw err;
    }
  }

  async ensureIndexes(): Promise<void> {
    await this.keys.createIndex({ userId: 1, operationId: 1 }, { unique: true, name: 'userId_operationId_unique' });
  }
}

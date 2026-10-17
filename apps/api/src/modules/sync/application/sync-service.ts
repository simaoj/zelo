import type { Actor, IdempotentExecutor, SyncEntityName, TxContext, UnitOfWork } from '../../../shared/application/ports.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';

/** Read side of the per-user change log (implemented by the shared Mongo change log). */
export interface ChangeFeed {
  currentSeq(userId: string, tx?: TxContext): Promise<number>;
  listAfter(userId: string, afterSeq: number, limit: number, tx?: TxContext): Promise<{ seq: number; entity: SyncEntityName; entityId: string; op: 'upsert' | 'delete' }[]>;
}

/** Structural copies of the bootstrap module-contract interfaces (application must not import bootstrap). */
export interface EntityReader {
  entity: SyncEntityName;
  getById(userId: string, id: string, tx?: TxContext): Promise<unknown | null>;
  listForBootstrap(userId: string, tx?: TxContext): Promise<unknown[]>;
}
export interface OperationHandler {
  type: string;
  handle(actor: Actor, entityId: string, payload: unknown, tx: TxContext): Promise<{ status: number; body: unknown }>;
}

export type SyncChange = { op: 'upsert'; entity: SyncEntityName; id: string; data: unknown } | { op: 'delete'; entity: SyncEntityName; id: string };

export const CHANGES_PAGE_SIZE = 500;

export function encodeSyncCursor(seq: number): string {
  return Buffer.from(`seq:${seq}`, 'utf8').toString('base64url');
}

export function decodeSyncCursor(cursor: string): number {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const m = /^seq:(\d{1,15})$/.exec(raw);
  if (!m) throw new ValidationError('Cursor inválido', { cursor: ['Cursor inválido'] });
  return Number(m[1]);
}

export class SyncService {
  private readonly readers = new Map<SyncEntityName, EntityReader>();
  private readonly handlers = new Map<string, OperationHandler>();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly feed: ChangeFeed,
    private readonly idempotency: IdempotentExecutor,
    readers: EntityReader[],
    handlers: OperationHandler[],
    private readonly pageSize = CHANGES_PAGE_SIZE,
  ) {
    for (const r of readers) this.readers.set(r.entity, r);
    for (const h of handlers) this.handlers.set(h.type, h);
  }

  handlerTypes(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Snapshot of every synced entity + cursor, read in ONE transaction with snapshot read
   * concern: since every mutation bumps the per-user counter in its own transaction, the
   * cursor corresponds exactly to the state returned (no lost concurrent changes).
   */
  async bootstrap(actor: Actor): Promise<{ cursor: string; data: Partial<Record<SyncEntityName, unknown[]>> }> {
    return this.uow.run(async (tx) => {
      const seq = await this.feed.currentSeq(actor.userId, tx);
      const data: Partial<Record<SyncEntityName, unknown[]>> = {};
      for (const [entity, reader] of this.readers) data[entity] = await reader.listForBootstrap(actor.userId, tx);
      return { cursor: encodeSyncCursor(seq), data };
    });
  }

  /** Changes with seq > cursor, deduplicated per entity id and resolved to current state or tombstone. */
  async changes(actor: Actor, cursor: string): Promise<{ changes: SyncChange[]; cursor: string; hasMore: boolean }> {
    const after = decodeSyncCursor(cursor);
    return this.uow.run(async (tx) => {
      const rows = await this.feed.listAfter(actor.userId, after, this.pageSize + 1, tx);
      const hasMore = rows.length > this.pageSize;
      const page = rows.slice(0, this.pageSize);
      const last = page[page.length - 1];
      // keep the last occurrence of each entity id, in seq order
      const latest = new Map<string, (typeof page)[number]>();
      for (const r of page) {
        const key = `${r.entity}:${r.entityId}`;
        latest.delete(key);
        latest.set(key, r);
      }
      const changes: SyncChange[] = [];
      for (const r of latest.values()) {
        const reader = this.readers.get(r.entity);
        if (!reader) continue;
        const data = r.op === 'delete' ? null : await reader.getById(actor.userId, r.entityId, tx);
        changes.push(data === null || data === undefined ? { op: 'delete', entity: r.entity, id: r.entityId } : { op: 'upsert', entity: r.entity, id: r.entityId, data });
      }
      return { changes, cursor: encodeSyncCursor(last ? last.seq : after), hasMore };
    });
  }

  /** Executes one queued operation through the same use case as REST, atomically with its idempotency key. */
  async executeOperation(actor: Actor, op: { type: string; entityId: string; payload: { operationId: string } & Record<string, unknown> }) {
    const handler = this.handlers.get(op.type);
    if (!handler) throw new NotFoundError('Tipo de operação');
    return this.idempotency.execute(actor.userId, op.payload.operationId, { type: op.type, entityId: op.entityId, payload: op.payload }, (tx) =>
      handler.handle(actor, op.entityId, op.payload, tx),
    );
  }
}

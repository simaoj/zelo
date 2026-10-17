import type { ClientSession, MongoClient, TransactionOptions } from 'mongodb';
import type { TxContext, UnitOfWork } from '../application/ports.js';

/**
 * TxContext is an opaque handle; at runtime it IS the driver ClientSession.
 * Only MongoDB adapters call `sessionOf` to get it back.
 */
export function sessionOf(tx: TxContext): ClientSession;
export function sessionOf(tx: TxContext | undefined): ClientSession | undefined;
export function sessionOf(tx: TxContext | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

export function txOf(session: ClientSession): TxContext {
  return session as unknown as TxContext;
}

const DEFAULT_TX_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

const MAX_ATTEMPTS = 5;

function isRetryable(err: unknown): boolean {
  const e = err as { hasErrorLabel?: (l: string) => boolean; code?: number };
  if (typeof e?.hasErrorLabel === 'function') {
    if (e.hasErrorLabel('TransientTransactionError') || e.hasErrorLabel('UnknownTransactionCommitResult')) return true;
  }
  return e?.code === 112; // WriteConflict
}

/**
 * MongoDB UnitOfWork. Each `run` opens a session + transaction (snapshot read concern,
 * majority writes). The driver's `withTransaction` already retries transient errors;
 * we add an outer bounded retry for write conflicts surfaced outside it.
 */
export class MongoUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: MongoClient,
    private readonly options: TransactionOptions = DEFAULT_TX_OPTIONS,
  ) {}

  async run<T>(work: (tx: TxContext) => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const session = this.client.startSession();
      try {
        return await session.withTransaction(() => work(txOf(session)), this.options);
      } catch (err) {
        if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
          await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
          continue;
        }
        throw err;
      } finally {
        await session.endSession();
      }
    }
  }
}

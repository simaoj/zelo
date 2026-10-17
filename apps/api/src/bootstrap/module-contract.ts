/**
 * Contract between feature modules and the composition root (src/bootstrap). Lives in bootstrap because it references Fastify/Mongo types — domain/application never import it.
 *
 * Each module exports from `src/modules/<name>/index.ts` a factory:
 *
 *   export function create<Name>Module(deps: CoreDeps & {...other module ports}): ModuleDefinition
 *
 * bootstrap/container.ts builds the CoreDeps, calls every factory, then:
 *   - registers each module's `httpRoutes` Fastify plugin under /api/v1 (authenticated by default);
 *   - feeds `syncReaders` to the sync module (bootstrap snapshot + changes feed);
 *   - feeds `syncHandlers` to the sync dispatcher (POST /sync/operations);
 *   - calls `ensureIndexes` from the index/migration script and at startup.
 *
 * Modules must not import other modules' internals — only ports declared here or in
 * another module's `index.ts` public API.
 */
import type { Db } from 'mongodb';
import type { FastifyPluginAsync } from 'fastify';
import type { Actor, ChangeLog, Clock, IdGenerator, IdempotentExecutor, SyncEntityName, TxContext, UnitOfWork } from '../shared/application/ports.js';

export interface CoreDeps {
  db: Db; // only adapters (out/mongodb) may use it
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  changeLog: ChangeLog;
  idempotency: IdempotentExecutor;
}

/** Reads current transport representations (contract shapes) for sync. */
export interface SyncReader {
  entity: SyncEntityName;
  /** Current representation, or null if deleted/missing (→ emitted as tombstone). */
  getById(userId: string, id: string, tx?: TxContext): Promise<unknown | null>;
  /** All live records for bootstrap snapshot (occurrence reader may restrict to a window). */
  listForBootstrap(userId: string, tx?: TxContext): Promise<unknown[]>;
}

/**
 * Executes one offline operation type by calling the SAME use case as the REST endpoint.
 * Must run inside the provided tx (the dispatcher wraps it with IdempotentExecutor).
 * Returns HTTP-equivalent status + contract body; throws AppError on failure.
 */
export interface SyncOperationHandler {
  type: string; // SyncOperationType from @zelo/contracts
  handle(actor: Actor, entityId: string, payload: unknown, tx: TxContext): Promise<{ status: number; body: unknown }>;
}

export interface ModuleDefinition {
  name: string;
  /** Fastify plugin; `request.actor` (Actor) is set by the auth hook for authenticated routes. */
  httpRoutes?: FastifyPluginAsync;
  syncReaders?: SyncReader[];
  syncHandlers?: SyncOperationHandler[];
  ensureIndexes?: () => Promise<void>;
  /** background jobs (e.g. notifications worker); started only by the worker entrypoint */
  jobs?: { name: string; start: () => Promise<() => Promise<void>> }[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth preHandler; undefined on public routes. */
    actor?: Actor;
    correlationId: string;
  }
}

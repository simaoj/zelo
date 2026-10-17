import type { FastifyReply } from 'fastify';
import type { Actor, IdempotentExecutor, TxContext } from '../application/ports.js';

/**
 * Canonical idempotency payload, shared by REST controllers and the sync dispatcher so that
 * an operation first sent via /sync/operations and retried via REST (or vice versa) replays.
 */
export interface OperationEnvelope {
  type: string;
  entityId: string;
  payload: { operationId: string } & Record<string, unknown>;
}

export async function executeOperation(
  idempotency: IdempotentExecutor,
  actor: Actor,
  op: OperationEnvelope,
  work: (tx: TxContext) => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown; replayed: boolean }> {
  return idempotency.execute(actor.userId, op.payload.operationId, { type: op.type, entityId: op.entityId, payload: op.payload }, work);
}

/** Sends an idempotent result (204 → empty body). */
export function sendResult(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header('idempotent-replayed', 'true');
  if (result.status === 204) return reply.status(204).send();
  return reply.status(result.status).send(result.body);
}

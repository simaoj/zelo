import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import type { ApiError, ApiErrorCode } from '@zelo/contracts';
import { AppError, ConfirmationRequiredError, ValidationError, VersionConflictError } from '../domain/errors.js';

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CONFIRMATION_REQUIRED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Error thrown by the HTTP layer itself (CSRF, rate limit). */
export class HttpError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function pathToKey(path: string): string {
  const key = path.replace(/^\//, '').replace(/\//g, '.');
  return key || '_';
}

/** Translates any thrown value into {status, ApiError body}. Never leaks internals. */
export function toApiError(err: unknown, correlationId: string): { status: number; body: ApiError } {
  if (err instanceof AppError) {
    const body: ApiError = { code: err.code, message: err.message, correlationId };
    if (err instanceof ValidationError || err instanceof ConfirmationRequiredError) {
      if (Object.keys(err.fieldErrors).length) body.fieldErrors = err.fieldErrors;
    }
    if (err instanceof VersionConflictError && err.current !== undefined) body.current = err.current;
    return { status: STATUS_BY_CODE[err.code], body };
  }
  if (err instanceof HttpError) {
    return { status: STATUS_BY_CODE[err.code], body: { code: err.code, message: err.message, correlationId } };
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.validation) {
      const params = issue.params as { issue?: { path?: (string | number)[] } } | undefined;
      const rawPath = params?.issue?.path?.join('.') ?? pathToKey(issue.instancePath);
      const key = rawPath || '_';
      (fieldErrors[key] ??= []).push(issue.message ?? 'Valor inválido');
    }
    return {
      status: 400,
      body: { code: 'VALIDATION_ERROR', message: 'Confira os campos informados.', fieldErrors, correlationId },
    };
  }
  const fe = err as Partial<FastifyError>;
  if (fe?.statusCode === 429) {
    return { status: 429, body: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um pouco e tente novamente.', correlationId } };
  }
  if (!isResponseSerializationError(err) && typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    // e.g. malformed JSON, unsupported media type, body too large
    return { status: fe.statusCode, body: { code: 'VALIDATION_ERROR', message: 'Requisição inválida.', correlationId } };
  }
  return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Algo deu errado. Tente novamente.', correlationId } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = toApiError(err, request.correlationId ?? String(request.id));
    if (status >= 500) request.log.error({ err }, 'request failed');
    else request.log.info({ code: body.code, status }, 'request rejected');
    return reply.status(status).send(body);
  });
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Rota não encontrada', correlationId: request.correlationId ?? String(request.id) }),
  );
}

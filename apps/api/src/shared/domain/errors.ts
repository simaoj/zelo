/** Domain/application errors. Pure TS — no framework imports. HTTP adapters translate them. */
export abstract class AppError extends Error {
  abstract readonly code:
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'VERSION_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'CONFIRMATION_REQUIRED'
    | 'UNAUTHENTICATED';
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  constructor(what = 'Registro') {
    super(`${what} não encontrado`);
  }
}

/** Optimistic-concurrency failure. `current` is the current transport representation (if it still exists). */
export class VersionConflictError extends AppError {
  readonly code = 'VERSION_CONFLICT' as const;
  constructor(public readonly current: unknown = undefined) {
    super('Este registro foi alterado em outro lugar.');
  }
}

export class IdempotencyConflictError extends AppError {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor() {
    super('Esta operação já foi registrada com outros dados.');
  }
}

/** e.g. diastolic >= systolic without confirmedUnusual. */
export class ConfirmationRequiredError extends AppError {
  readonly code = 'CONFIRMATION_REQUIRED' as const;
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor() {
    super('Sessão expirada. Entre novamente.');
  }
}

/**
 * Well-formed input that is incompatible with a data contract (e.g. a health export that is not a
 * consolidated daily total). Same ApiError code as validation, but HTTP 422 instead of 400.
 */
export class UnprocessableInputError extends ValidationError {
  readonly httpStatus = 422;
}

import { DataError, OfflineError } from './ports';

export type ErrorKind = 'offline' | 'conflict' | 'validation' | 'expired' | 'confirmation' | 'notFound' | 'rateLimited' | 'generic';

export interface DescribedError {
  kind: ErrorKind;
  message: string;
  fieldErrors: Record<string, string[]>;
}

/** Maps data-layer errors to distinct, user-facing states (spec §10). */
export function describeError(error: unknown): DescribedError {
  if (error instanceof OfflineError) {
    return { kind: 'offline', message: 'Você está sem conexão. Esta ação precisa de internet.', fieldErrors: {} };
  }
  if (error instanceof DataError) {
    const fieldErrors = error.body.fieldErrors ?? {};
    switch (error.code) {
      case 'UNAUTHENTICATED':
        return { kind: 'expired', message: 'Sua sessão expirou. Entre novamente para continuar.', fieldErrors };
      case 'VERSION_CONFLICT':
      case 'IDEMPOTENCY_CONFLICT':
        return {
          kind: 'conflict',
          message: 'Este registro foi alterado em outro lugar. Recarregue para ver a versão mais recente.',
          fieldErrors,
        };
      case 'VALIDATION_ERROR':
        return { kind: 'validation', message: error.body.message || 'Confira os campos destacados.', fieldErrors };
      case 'CONFIRMATION_REQUIRED':
        return { kind: 'confirmation', message: error.body.message, fieldErrors };
      case 'NOT_FOUND':
        return { kind: 'notFound', message: 'Registro não encontrado. Ele pode ter sido excluído.', fieldErrors };
      case 'RATE_LIMITED':
        return { kind: 'rateLimited', message: 'Muitas tentativas. Aguarde um pouco e tente novamente.', fieldErrors };
      default:
        return { kind: 'generic', message: error.body.message || 'Algo deu errado. Tente novamente.', fieldErrors };
    }
  }
  return { kind: 'generic', message: 'Algo deu errado. Tente novamente.', fieldErrors: {} };
}

/** True when the server answered (so a new operationId must be used for a changed payload). */
export function serverAnswered(error: unknown): boolean {
  return error instanceof DataError;
}

/** First message for a field from server fieldErrors (supports nested keys like "values.0.valueCm"). */
export function fieldError(fieldErrors: Record<string, string[]>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = fieldErrors[k];
    if (v && v.length) return v[0];
  }
  return undefined;
}

import { AppError } from '../../../shared/domain/errors.js';

/**
 * Opaque bearer credential used by a machine client (Health Auto Export) to push data for ONE user.
 * Only the SHA-256 hash of the raw token is stored; the raw token is shown once, at creation.
 */
export interface IntegrationCredential {
  id: string;
  userId: string;
  label: string;
  /** sha256(rawToken), hex */
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Prefix of raw tokens (helps secret scanners and humans recognise them). */
export const INTEGRATION_TOKEN_PREFIX = 'zelo_hae_';

export const DEFAULT_TOKEN_LABEL = 'Health Auto Export';

export function isCredentialActive(c: IntegrationCredential): boolean {
  return c.revokedAt === null;
}

export function normalizeLabel(label: string | undefined): string {
  const l = (label ?? '').trim();
  if (!l) return DEFAULT_TOKEN_LABEL;
  return l.slice(0, 80);
}

/** Missing, malformed, unknown or revoked integration token. */
export class IntegrationUnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor() {
    super('Credencial de integração ausente, inválida ou revogada.');
  }
}

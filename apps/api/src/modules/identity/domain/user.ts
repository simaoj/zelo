import { AppError, ValidationError } from '../../../shared/domain/errors.js';

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  /** sha256 of the random token; the raw token only lives in the cookie */
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PasswordResetToken {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new ValidationError('Senha inválida', { password: [`Use entre ${MIN_PASSWORD} e ${MAX_PASSWORD} caracteres`] });
  }
}

export function isSessionActive(s: Session, now: Date): boolean {
  return s.revokedAt === null && s.expiresAt.getTime() > now.getTime();
}

export function isResetTokenUsable(t: PasswordResetToken, now: Date): boolean {
  return t.usedAt === null && t.expiresAt.getTime() > now.getTime();
}

export class InvalidCredentialsError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor() {
    super('E-mail ou senha incorretos.');
  }
}

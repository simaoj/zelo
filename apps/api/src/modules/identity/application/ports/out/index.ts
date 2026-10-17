import type { TxContext } from '../../../../../shared/application/ports.js';
import type { PasswordResetToken, Session, User } from '../../../domain/user.js';

export interface UserRepository {
  findByEmail(emailNormalized: string, tx?: TxContext): Promise<User | null>;
  findById(id: string, tx?: TxContext): Promise<User | null>;
  /** throws EmailTakenError on unique violation */
  insert(user: User, tx: TxContext): Promise<void>;
  updatePassword(userId: string, passwordHash: string, now: Date, tx: TxContext): Promise<void>;
}

export interface SessionRepository {
  insert(session: Session, tx?: TxContext): Promise<void>;
  findByHash(tokenHash: string): Promise<Session | null>;
  revoke(tokenHash: string, now: Date): Promise<Session | null>;
  revokeAllForUser(userId: string, now: Date, tx: TxContext): Promise<void>;
}

export interface PasswordResetTokenRepository {
  insert(token: PasswordResetToken): Promise<void>;
  findByHash(tokenHash: string, tx?: TxContext): Promise<PasswordResetToken | null>;
  /** atomically marks as used if still unused; false otherwise */
  markUsed(tokenHash: string, now: Date, tx: TxContext): Promise<boolean>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface SecureTokens {
  /** high-entropy random token (≥ 32 bytes), URL-safe */
  generate(): string;
  /** one-way hash used for storage/lookup */
  hash(raw: string): string;
}

export interface Mailer {
  sendPasswordReset(to: string, link: string): Promise<void>;
}

/** Implemented by the profile module (wired in bootstrap). */
export interface ProfileProvisioningPort {
  provision(input: { userId: string; displayName: string; timezone: string }, tx: TxContext): Promise<void>;
}

export class EmailTakenError extends Error {
  constructor() {
    super('email taken');
  }
}

import type { IntegrationCredential } from '../../../domain/integration-credential.js';

export interface IntegrationCredentialRepository {
  insert(c: IntegrationCredential): Promise<void>;
  findByHash(tokenHash: string): Promise<IntegrationCredential | null>;
  findById(id: string): Promise<IntegrationCredential | null>;
  listByUser(userId: string): Promise<IntegrationCredential[]>;
  /** sets revokedAt if still active; false when unknown or already revoked */
  revoke(id: string, now: Date): Promise<boolean>;
  touch(id: string, now: Date): Promise<void>;
}

export interface IntegrationTokenCrypto {
  /** new random opaque token (prefix + 32 random bytes, base64url) */
  generate(): string;
  hash(rawToken: string): string;
  /** constant-time equality of two hashes */
  equalHashes(a: string, b: string): boolean;
}

/** Resolves a user by e-mail (for the admin script). Implemented with the identity module in bootstrap. */
export interface UserDirectory {
  findUserIdByEmail(email: string): Promise<string | null>;
}

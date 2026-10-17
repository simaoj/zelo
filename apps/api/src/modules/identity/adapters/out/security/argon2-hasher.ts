import argon2 from 'argon2';
import type { PasswordHasher } from '../../../application/ports/out/index.js';

/** argon2id with library defaults (OWASP-compatible parameters). */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly options: { memoryCost?: number; timeCost?: number } = {}) {}
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.options });
  }
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

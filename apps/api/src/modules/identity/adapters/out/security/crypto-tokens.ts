import { createHash, randomBytes } from 'node:crypto';
import type { SecureTokens } from '../../../application/ports/out/index.js';

export class CryptoSecureTokens implements SecureTokens {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }
  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}

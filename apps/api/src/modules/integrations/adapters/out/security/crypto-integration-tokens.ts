import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { INTEGRATION_TOKEN_PREFIX } from '../../../domain/integration-credential.js';
import type { IntegrationTokenCrypto } from '../../../application/ports/out/index.js';

export class CryptoIntegrationTokens implements IntegrationTokenCrypto {
  generate(): string {
    return `${INTEGRATION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  }
  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
  equalHashes(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}

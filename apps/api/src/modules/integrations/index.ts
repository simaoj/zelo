import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { UserDirectory } from './application/ports/out/index.js';
import { createIntegrationUseCases, type IntegrationUseCases } from './application/use-cases/integration-tokens.js';
import { MongoIntegrationCredentialRepository } from './adapters/out/mongodb/mongo-integration-credential-repository.js';
import { CryptoIntegrationTokens } from './adapters/out/security/crypto-integration-tokens.js';

export type { IntegrationTokenView, IntegrationUseCases } from './application/use-cases/integration-tokens.js';
export type { UserDirectory } from './application/ports/out/index.js';
export { INTEGRATION_TOKEN_PREFIX } from './domain/integration-credential.js';

/** Port consumed by modules that accept machine pushes (activity's POST /imports/health). */
export interface IntegrationTokenAuthenticator {
  /** throws an UNAUTHENTICATED AppError for missing/invalid/revoked tokens */
  authenticate(rawToken: string | undefined): Promise<{ userId: string; credentialId: string }>;
}

/**
 * Integration credentials (opaque bearer tokens per user, hash-only storage). No HTTP routes:
 * tokens are created/listed/revoked by the admin script (bootstrap/integration-token.ts).
 */
export function createIntegrationsModule(
  deps: CoreDeps & { users: UserDirectory },
): ModuleDefinition & { tokens: IntegrationUseCases; authenticator: IntegrationTokenAuthenticator } {
  const repo = new MongoIntegrationCredentialRepository(deps.db);
  const tokens = createIntegrationUseCases({ repo, crypto: new CryptoIntegrationTokens(), users: deps.users, clock: deps.clock, ids: deps.ids });
  return {
    name: 'integrations',
    ensureIndexes: () => repo.ensureIndexes(),
    tokens,
    authenticator: { authenticate: (raw) => tokens.authenticate.execute(raw) },
  };
}

import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { PushSubscriptionRevoker } from '../../shared/application/cross-module-ports.js';
import type { SessionResolver } from '../../shared/http/auth.js';
import { IdentityService } from './application/use-cases/auth-use-cases.js';
import type { Mailer, PasswordHasher, ProfileProvisioningPort } from './application/ports/out/index.js';
import { identityRoutes } from './adapters/in/http/identity-routes.js';
import { MongoPasswordResetTokenRepository, MongoSessionRepository, MongoUserRepository } from './adapters/out/mongodb/mongo-identity-repositories.js';
import { Argon2PasswordHasher } from './adapters/out/security/argon2-hasher.js';
import { CryptoSecureTokens } from './adapters/out/security/crypto-tokens.js';

export { NodemailerMailer, MemoryMailer } from './adapters/out/mail/nodemailer-mailer.js';
export { Argon2PasswordHasher } from './adapters/out/security/argon2-hasher.js';

export function createIdentityModule(
  deps: CoreDeps & {
    profileProvisioner: ProfileProvisioningPort;
    /** resolved lazily: the notifications module may be built after identity */
    pushRevoker: PushSubscriptionRevoker;
    mailer: Mailer;
    hasher?: PasswordHasher;
    publicAppUrl: string;
    cookieSecure: boolean;
    authRateLimit?: number;
    onMailError?: (err: unknown) => void;
  },
): ModuleDefinition & { sessionResolver: SessionResolver; service: IdentityService } {
  const users = new MongoUserRepository(deps.db);
  const sessions = new MongoSessionRepository(deps.db);
  const resetTokens = new MongoPasswordResetTokenRepository(deps.db);
  const service = new IdentityService({
    users,
    sessions,
    resetTokens,
    hasher: deps.hasher ?? new Argon2PasswordHasher(),
    tokens: new CryptoSecureTokens(),
    mailer: deps.mailer,
    profiles: deps.profileProvisioner,
    pushRevoker: deps.pushRevoker,
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    publicAppUrl: deps.publicAppUrl,
    ...(deps.onMailError ? { onMailError: deps.onMailError } : {}),
  });
  return {
    name: 'identity',
    httpRoutes: identityRoutes(service, { cookieSecure: deps.cookieSecure, ...(deps.authRateLimit ? { authRateLimit: deps.authRateLimit } : {}) }),
    ensureIndexes: async () => {
      await users.ensureIndexes();
      await sessions.ensureIndexes();
      await resetTokens.ensureIndexes();
    },
    sessionResolver: { resolve: async (raw) => (await service.resolve(raw)) ?? null },
    service,
  };
}

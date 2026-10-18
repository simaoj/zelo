import type { Clock, IdGenerator } from '../../../../shared/application/ports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import {
  INTEGRATION_TOKEN_PREFIX,
  IntegrationUnauthenticatedError,
  isCredentialActive,
  normalizeLabel,
  type IntegrationCredential,
} from '../../domain/integration-credential.js';
import type { IntegrationCredentialRepository, IntegrationTokenCrypto, UserDirectory } from '../ports/out/index.js';

/** Safe view (never contains the raw token nor its hash). */
export interface IntegrationTokenView {
  id: string;
  userId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function view(c: IntegrationCredential): IntegrationTokenView {
  return {
    id: c.id,
    userId: c.userId,
    label: c.label,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    revokedAt: c.revokedAt?.toISOString() ?? null,
  };
}

interface Deps {
  repo: IntegrationCredentialRepository;
  crypto: IntegrationTokenCrypto;
  users: UserDirectory;
  clock: Clock;
  ids: IdGenerator;
}

export class CreateIntegrationToken {
  constructor(private readonly d: Deps) {}
  /** Returns the raw token ONCE; only its hash is persisted. */
  async execute(input: { email: string; label?: string }): Promise<{ token: string; credential: IntegrationTokenView }> {
    const userId = await this.d.users.findUserIdByEmail(input.email);
    if (!userId) throw new NotFoundError('Usuário');
    return this.forUser(userId, input.label);
  }
  async forUser(userId: string, label?: string): Promise<{ token: string; credential: IntegrationTokenView }> {
    const token = this.d.crypto.generate();
    const c: IntegrationCredential = {
      id: this.d.ids.next(),
      userId,
      label: normalizeLabel(label),
      tokenHash: this.d.crypto.hash(token),
      createdAt: this.d.clock.now(),
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.d.repo.insert(c);
    return { token, credential: view(c) };
  }
}

export class ListIntegrationTokens {
  constructor(private readonly d: Deps) {}
  async execute(input: { email: string }): Promise<IntegrationTokenView[]> {
    const userId = await this.d.users.findUserIdByEmail(input.email);
    if (!userId) throw new NotFoundError('Usuário');
    return (await this.d.repo.listByUser(userId)).map(view);
  }
}

export class RevokeIntegrationToken {
  constructor(private readonly d: Deps) {}
  async execute(input: { id: string }): Promise<IntegrationTokenView> {
    const existing = await this.d.repo.findById(input.id);
    if (!existing) throw new NotFoundError('Token');
    if (isCredentialActive(existing)) await this.d.repo.revoke(input.id, this.d.clock.now());
    const after = await this.d.repo.findById(input.id);
    return view(after ?? existing);
  }
}

/**
 * Resolves the user of a raw bearer token. Lookup is by SHA-256 hash (unique index), followed by a
 * constant-time comparison of the hashes; the raw token is never stored or logged.
 */
export class AuthenticateIntegrationToken {
  constructor(private readonly d: Deps) {}
  async execute(rawToken: string | undefined): Promise<{ userId: string; credentialId: string }> {
    if (!rawToken || !rawToken.startsWith(INTEGRATION_TOKEN_PREFIX) || rawToken.length > 200) throw new IntegrationUnauthenticatedError();
    const hash = this.d.crypto.hash(rawToken);
    const c = await this.d.repo.findByHash(hash);
    if (!c || !this.d.crypto.equalHashes(c.tokenHash, hash) || !isCredentialActive(c)) throw new IntegrationUnauthenticatedError();
    await this.d.repo.touch(c.id, this.d.clock.now());
    return { userId: c.userId, credentialId: c.id };
  }
}

export function createIntegrationUseCases(d: Deps) {
  return {
    create: new CreateIntegrationToken(d),
    list: new ListIntegrationTokens(d),
    revoke: new RevokeIntegrationToken(d),
    authenticate: new AuthenticateIntegrationToken(d),
  };
}
export type IntegrationUseCases = ReturnType<typeof createIntegrationUseCases>;

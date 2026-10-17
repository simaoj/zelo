import type { SessionResponse } from '@zelo/contracts';
import type { Actor, Clock, IdGenerator, UnitOfWork } from '../../../../shared/application/ports.js';
import type { PushSubscriptionRevoker } from '../../../../shared/application/cross-module-ports.js';
import { UnauthenticatedError, ValidationError } from '../../../../shared/domain/errors.js';
import {
  InvalidCredentialsError,
  RESET_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  assertPasswordPolicy,
  isResetTokenUsable,
  isSessionActive,
  normalizeEmail,
  type User,
} from '../../domain/user.js';
import {
  EmailTakenError,
  type Mailer,
  type PasswordHasher,
  type PasswordResetTokenRepository,
  type ProfileProvisioningPort,
  type SecureTokens,
  type SessionRepository,
  type UserRepository,
} from '../ports/out/index.js';

export interface IssuedSession {
  rawToken: string;
  response: SessionResponse;
}

export interface IdentityDeps {
  users: UserRepository;
  sessions: SessionRepository;
  resetTokens: PasswordResetTokenRepository;
  hasher: PasswordHasher;
  tokens: SecureTokens;
  mailer: Mailer;
  profiles: ProfileProvisioningPort;
  pushRevoker: PushSubscriptionRevoker;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  publicAppUrl: string;
  onMailError?: (err: unknown) => void;
}

const emailTaken = () => new ValidationError('Não foi possível criar a conta', { email: ['Este e-mail já está cadastrado'] });

export class IdentityService {
  private dummyHash: Promise<string> | null = null;
  constructor(private readonly d: IdentityDeps) {}

  private async newSession(user: Pick<User, 'id' | 'email'>): Promise<{ rawToken: string; session: Parameters<SessionRepository['insert']>[0] }> {
    const now = this.d.clock.now();
    const rawToken = this.d.tokens.generate();
    return {
      rawToken,
      session: { tokenHash: this.d.tokens.hash(rawToken), userId: user.id, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), revokedAt: null },
    };
  }

  private response(user: Pick<User, 'id' | 'email'>, expiresAt: Date): SessionResponse {
    return { user: { userId: user.id, email: user.email }, expiresAt: expiresAt.toISOString() };
  }

  async signUp(input: { email: string; password: string; displayName: string; timezone: string }): Promise<IssuedSession> {
    assertPasswordPolicy(input.password);
    const emailNormalized = normalizeEmail(input.email);
    if (await this.d.users.findByEmail(emailNormalized)) throw emailTaken();
    const passwordHash = await this.d.hasher.hash(input.password);
    const now = this.d.clock.now();
    const user: User = { id: this.d.ids.next(), email: input.email.trim(), emailNormalized, passwordHash, createdAt: now, updatedAt: now };
    const { rawToken, session } = await this.newSession(user);
    try {
      await this.d.uow.run(async (tx) => {
        await this.d.users.insert(user, tx);
        await this.d.profiles.provision({ userId: user.id, displayName: input.displayName, timezone: input.timezone }, tx);
        await this.d.sessions.insert(session, tx);
      });
    } catch (err) {
      if (err instanceof EmailTakenError) throw emailTaken();
      throw err;
    }
    return { rawToken, response: this.response(user, session.expiresAt) };
  }

  async signIn(input: { email: string; password: string }): Promise<IssuedSession> {
    const user = await this.d.users.findByEmail(normalizeEmail(input.email));
    if (!user) {
      // equalize timing for unknown e-mails
      this.dummyHash ??= this.d.hasher.hash('zelo-dummy-password');
      await this.d.hasher.verify(await this.dummyHash, input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.d.hasher.verify(user.passwordHash, input.password))) throw new InvalidCredentialsError();
    const { rawToken, session } = await this.newSession(user);
    await this.d.sessions.insert(session);
    return { rawToken, response: this.response(user, session.expiresAt) };
  }

  /** Resolves a raw cookie token into an actor (null if invalid/expired/revoked). */
  async resolve(rawToken: string): Promise<(Actor & { expiresAt: Date }) | null> {
    if (!rawToken || rawToken.length > 256) return null;
    const s = await this.d.sessions.findByHash(this.d.tokens.hash(rawToken));
    if (!s || !isSessionActive(s, this.d.clock.now())) return null;
    return { userId: s.userId, expiresAt: s.expiresAt };
  }

  async getSession(rawToken: string | undefined): Promise<SessionResponse> {
    const actor = rawToken ? await this.resolve(rawToken) : null;
    if (!actor) throw new UnauthenticatedError();
    const user = await this.d.users.findById(actor.userId);
    if (!user) throw new UnauthenticatedError();
    return this.response(user, actor.expiresAt);
  }

  /** Revokes the session and, when a deviceId is given, that device's push subscriptions. */
  async signOut(rawToken: string | undefined, deviceId: string | undefined): Promise<void> {
    if (!rawToken) return;
    const s = await this.d.sessions.revoke(this.d.tokens.hash(rawToken), this.d.clock.now());
    if (s && deviceId) await this.d.pushRevoker.revokeForDevice(s.userId, deviceId);
  }

  /** Always succeeds (no account enumeration). */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.d.users.findByEmail(normalizeEmail(email));
    if (!user) return;
    const now = this.d.clock.now();
    const raw = this.d.tokens.generate();
    await this.d.resetTokens.insert({ tokenHash: this.d.tokens.hash(raw), userId: user.id, createdAt: now, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS), usedAt: null });
    const link = `${this.d.publicAppUrl}/redefinir-senha?token=${encodeURIComponent(raw)}`;
    try {
      await this.d.mailer.sendPasswordReset(user.email, link);
    } catch (err) {
      this.d.onMailError?.(err);
    }
  }

  async confirmPasswordReset(input: { token: string; password: string }): Promise<void> {
    assertPasswordPolicy(input.password);
    const invalid = () => new ValidationError('Link inválido ou expirado', { token: ['Este link é inválido ou expirou. Peça um novo.'] });
    const hash = this.d.tokens.hash(input.token);
    const token = await this.d.resetTokens.findByHash(hash);
    if (!token || !isResetTokenUsable(token, this.d.clock.now())) throw invalid();
    const passwordHash = await this.d.hasher.hash(input.password);
    await this.d.uow.run(async (tx) => {
      const now = this.d.clock.now();
      if (!(await this.d.resetTokens.markUsed(hash, now, tx))) throw invalid();
      await this.d.users.updatePassword(token.userId, passwordHash, now, tx);
      await this.d.sessions.revokeAllForUser(token.userId, now, tx);
    });
  }
}

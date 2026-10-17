import type { Collection, Db } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { sessionOf } from '../../../../../shared/adapters/mongo-unit-of-work.js';
import type { PasswordResetToken, Session, User } from '../../../domain/user.js';
import {
  EmailTakenError,
  type PasswordResetTokenRepository,
  type SessionRepository,
  type UserRepository,
} from '../../../application/ports/out/index.js';

interface UserDoc {
  _id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
interface SessionDoc {
  _id: string; // token hash
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
interface ResetDoc {
  _id: string; // token hash
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

const userToDomain = (d: UserDoc): User => ({ id: d._id, email: d.email, emailNormalized: d.emailNormalized, passwordHash: d.passwordHash, createdAt: d.createdAt, updatedAt: d.updatedAt });
const sessionToDomain = (d: SessionDoc): Session => ({ tokenHash: d._id, userId: d.userId, createdAt: d.createdAt, expiresAt: d.expiresAt, revokedAt: d.revokedAt ?? null });
const resetToDomain = (d: ResetDoc): PasswordResetToken => ({ tokenHash: d._id, userId: d.userId, createdAt: d.createdAt, expiresAt: d.expiresAt, usedAt: d.usedAt ?? null });

export class MongoUserRepository implements UserRepository {
  private readonly col: Collection<UserDoc>;
  constructor(db: Db) {
    this.col = db.collection<UserDoc>('users');
  }
  async findByEmail(emailNormalized: string, tx?: TxContext) {
    const d = await this.col.findOne({ emailNormalized }, { session: sessionOf(tx) });
    return d ? userToDomain(d) : null;
  }
  async findById(id: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: id }, { session: sessionOf(tx) });
    return d ? userToDomain(d) : null;
  }
  async insert(user: User, tx: TxContext) {
    try {
      await this.col.insertOne(
        { _id: user.id, email: user.email, emailNormalized: user.emailNormalized, passwordHash: user.passwordHash, createdAt: user.createdAt, updatedAt: user.updatedAt },
        { session: sessionOf(tx) },
      );
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new EmailTakenError();
      throw err;
    }
  }
  async updatePassword(userId: string, passwordHash: string, now: Date, tx: TxContext) {
    await this.col.updateOne({ _id: userId }, { $set: { passwordHash, updatedAt: now } }, { session: sessionOf(tx) });
  }
  async ensureIndexes() {
    await this.col.createIndex({ emailNormalized: 1 }, { unique: true, name: 'emailNormalized_unique' });
  }
}

export class MongoSessionRepository implements SessionRepository {
  private readonly col: Collection<SessionDoc>;
  constructor(db: Db) {
    this.col = db.collection<SessionDoc>('sessions');
  }
  async insert(s: Session, tx?: TxContext) {
    await this.col.insertOne({ _id: s.tokenHash, userId: s.userId, createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt }, { session: sessionOf(tx) });
  }
  async findByHash(tokenHash: string) {
    const d = await this.col.findOne({ _id: tokenHash });
    return d ? sessionToDomain(d) : null;
  }
  async revoke(tokenHash: string, now: Date) {
    const d = await this.col.findOneAndUpdate({ _id: tokenHash, revokedAt: null }, { $set: { revokedAt: now } }, { returnDocument: 'after' });
    return d ? sessionToDomain(d) : null;
  }
  async revokeAllForUser(userId: string, now: Date, tx: TxContext) {
    await this.col.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } }, { session: sessionOf(tx) });
  }
  async ensureIndexes() {
    await this.col.createIndex({ userId: 1 }, { name: 'userId' });
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });
  }
}

export class MongoPasswordResetTokenRepository implements PasswordResetTokenRepository {
  private readonly col: Collection<ResetDoc>;
  constructor(db: Db) {
    this.col = db.collection<ResetDoc>('passwordResetTokens');
  }
  async insert(t: PasswordResetToken) {
    await this.col.insertOne({ _id: t.tokenHash, userId: t.userId, createdAt: t.createdAt, expiresAt: t.expiresAt, usedAt: t.usedAt });
  }
  async findByHash(tokenHash: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: tokenHash }, { session: sessionOf(tx) });
    return d ? resetToDomain(d) : null;
  }
  async markUsed(tokenHash: string, now: Date, tx: TxContext) {
    const r = await this.col.updateOne({ _id: tokenHash, usedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { session: sessionOf(tx) });
    return r.modifiedCount === 1;
  }
  async ensureIndexes() {
    await this.col.createIndex({ userId: 1 }, { name: 'userId' });
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600, name: 'expiresAt_ttl' });
  }
}

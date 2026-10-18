import type { Collection, Db } from 'mongodb';
import type { IntegrationCredential } from '../../../domain/integration-credential.js';
import type { IntegrationCredentialRepository } from '../../../application/ports/out/index.js';

interface CredentialDoc {
  _id: string;
  userId: string;
  label: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export const INTEGRATION_CREDENTIALS = 'integrationCredentials';

const toDomain = (d: CredentialDoc): IntegrationCredential => ({
  id: d._id,
  userId: d.userId,
  label: d.label,
  tokenHash: d.tokenHash,
  createdAt: d.createdAt,
  lastUsedAt: d.lastUsedAt ?? null,
  revokedAt: d.revokedAt ?? null,
});

export class MongoIntegrationCredentialRepository implements IntegrationCredentialRepository {
  private readonly col: Collection<CredentialDoc>;
  constructor(db: Db) {
    this.col = db.collection<CredentialDoc>(INTEGRATION_CREDENTIALS);
  }
  async insert(c: IntegrationCredential) {
    await this.col.insertOne({ _id: c.id, userId: c.userId, label: c.label, tokenHash: c.tokenHash, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, revokedAt: c.revokedAt });
  }
  async findByHash(tokenHash: string) {
    const d = await this.col.findOne({ tokenHash });
    return d ? toDomain(d) : null;
  }
  async findById(id: string) {
    const d = await this.col.findOne({ _id: id });
    return d ? toDomain(d) : null;
  }
  async listByUser(userId: string) {
    return (await this.col.find({ userId }).sort({ createdAt: -1 }).toArray()).map(toDomain);
  }
  async revoke(id: string, now: Date) {
    const r = await this.col.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: now } });
    return r.matchedCount === 1;
  }
  async touch(id: string, now: Date) {
    await this.col.updateOne({ _id: id }, { $set: { lastUsedAt: now } });
  }
  async ensureIndexes() {
    await this.col.createIndex({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
    await this.col.createIndex({ userId: 1 }, { name: 'userId' });
  }
}

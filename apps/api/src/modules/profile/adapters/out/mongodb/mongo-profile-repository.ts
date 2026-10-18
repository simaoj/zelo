import type { Collection, Db } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { sessionOf } from '../../../../../shared/adapters/mongo-unit-of-work.js';
import type { Profile, VisibleModule } from '../../../domain/profile.js';
import type { ProfileRepository } from '../../../application/ports/out/profile-repository.js';

/** `_id` = userId (a UUID): a user has exactly one profile. */
interface ProfileDoc {
  _id: string;
  userId: string;
  displayName: string;
  timezone: string;
  visibleModules: VisibleModule[];
  remindersEnabled: boolean;
  offlineEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const PROFILES = 'profiles';

function toDomain(d: ProfileDoc): Profile {
  return {
    userId: d.userId,
    displayName: d.displayName,
    timezone: d.timezone,
    visibleModules: d.visibleModules,
    remindersEnabled: d.remindersEnabled,
    offlineEnabled: d.offlineEnabled ?? false,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function toDoc(p: Profile): ProfileDoc {
  return { _id: p.userId, ...p };
}

export class MongoProfileRepository implements ProfileRepository {
  private readonly col: Collection<ProfileDoc>;
  constructor(db: Db) {
    this.col = db.collection<ProfileDoc>(PROFILES);
  }

  async findByUserId(userId: string, tx?: TxContext): Promise<Profile | null> {
    const d = await this.col.findOne({ userId }, { session: sessionOf(tx) });
    return d ? toDomain(d) : null;
  }

  async insert(profile: Profile, tx: TxContext): Promise<void> {
    await this.col.insertOne(toDoc(profile), { session: sessionOf(tx) });
  }

  async updateIfVersion(profile: Profile, expectedVersion: number, tx: TxContext): Promise<boolean> {
    const { _id, userId, createdAt, version, ...rest } = toDoc(profile);
    void _id;
    void createdAt;
    void version;
    const res = await this.col.updateOne(
      { userId, version: expectedVersion },
      { $set: rest, $inc: { version: 1 } },
      { session: sessionOf(tx) },
    );
    return res.matchedCount === 1;
  }

  async listUserIdsMissingModules(modules: readonly VisibleModule[]): Promise<string[]> {
    const docs = await this.col
      .find({ $or: modules.map((m) => ({ visibleModules: { $ne: m } })) }, { projection: { userId: 1 } })
      .toArray();
    return docs.map((d) => d.userId);
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ userId: 1 }, { unique: true, name: 'userId_unique' });
  }
}

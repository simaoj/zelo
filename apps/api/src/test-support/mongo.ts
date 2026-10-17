import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts a single-node in-memory replica set (transactions need a replica set).
 * Use one per test file: `const mongo = await startMongo(); ... await mongo.stop();`
 */
export async function startMongo(): Promise<{
  uri: string;
  client: MongoClient;
  dbName: string;
  stop: () => Promise<void>;
}> {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = rs.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = `zelo_test_${Math.random().toString(36).slice(2, 10)}`;
  return {
    uri,
    client,
    dbName,
    stop: async () => {
      await client.close();
      await rs.stop();
    },
  };
}

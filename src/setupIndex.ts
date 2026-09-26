/**
 * Create the Atlas Vector Search index on `jev.memories` (PLAN §7.2). Idempotent: skips create if
 * it already exists, then waits until the index is READY so `$vectorSearch` will not fail.
 *
 * Run once after creating the cluster: `npm run setup:index`. Building takes ~1 min. No-op in
 * in-memory mode.
 */
import { MongoClient, type Collection, type Document } from 'mongodb';
import { config, EMBED_DIM, useMongo } from './config.js';
import { VECTOR_INDEX } from './db.js';

const READY_POLL_MS = 5_000;
const READY_TIMEOUT_MS = 5 * 60_000;

const indexStatus = (idx: Document | undefined): string => {
  const status = typeof idx?.status === 'string' ? idx.status : '';
  const queryable = idx?.queryable === true;
  if (status) return queryable ? `${status} (queryable)` : status;
  return queryable ? 'queryable' : 'UNKNOWN';
};

const isReady = (idx: Document | undefined): boolean => {
  if (!idx) return false;
  const status = typeof idx.status === 'string' ? idx.status.toUpperCase() : '';
  return status === 'READY' || idx.queryable === true;
};

const findIndex = async (coll: Collection, name: string): Promise<Document | undefined> => {
  const existing = await coll.listSearchIndexes().toArray();
  return existing.find((i) => i.name === name);
};

const waitUntilReady = async (coll: Collection, name: string): Promise<void> => {
  const started = Date.now();
  for (;;) {
    const idx = await findIndex(coll, name);
    if (isReady(idx)) {
      console.log(`✅ Vector index "${name}" is READY.`);
      return;
    }
    if (Date.now() - started > READY_TIMEOUT_MS) {
      throw new Error(
        `Vector index "${name}" was not READY after ${READY_TIMEOUT_MS / 1000}s (last status: ${indexStatus(idx)}).`,
      );
    }
    console.log(`   waiting for "${name}" … ${indexStatus(idx)}`);
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
};

export const setupIndex = async (): Promise<void> => {
  if (!useMongo()) {
    console.log('ℹ️  In-memory mode (no MONGODB_URI): no Atlas index needed. Skipping.');
    return;
  }
  const client = new MongoClient(config.mongoUri!);
  try {
    await client.connect();
    const coll = client.db(config.mongoDb).collection('memories');

    const existing = await findIndex(coll, VECTOR_INDEX);
    if (existing) {
      console.log(`ℹ️  Vector index "${VECTOR_INDEX}" already exists (${indexStatus(existing)}).`);
    } else {
      await coll.createSearchIndex({
        name: VECTOR_INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: EMBED_DIM, similarity: 'cosine' },
            { type: 'filter', path: 'status' },
            { type: 'filter', path: 'topic' },
          ],
        },
      });
      console.log(`✅ Created vector index "${VECTOR_INDEX}" on ${config.mongoDb}.memories (${EMBED_DIM} dims).`);
    }

    await waitUntilReady(coll, VECTOR_INDEX);
  } finally {
    await client.close();
  }
};

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  await setupIndex();
}

/**
 * MongoDB Atlas backend. Semantic recall uses Atlas Vector Search over active memories.
 */
import { MongoClient, ObjectId, type Collection, type Db } from 'mongodb';
import { config } from './config.js';
import type { MemoryRepo, NewMemory, RecallHit, RecallOptions } from './repo.js';
import { DEFAULT_POLICY, type Memory, type Policy, type Trace } from './types.js';

export const VECTOR_INDEX = 'vector_index';

type MemoryDoc = Omit<Memory, '_id' | 'superseded_by' | 'source_trace_id'> & {
  _id: ObjectId;
  superseded_by: ObjectId | null;
  source_trace_id: ObjectId | null;
};
type TraceDoc = Omit<Trace, '_id'> & { _id: ObjectId };

const toId = (v: string | null): ObjectId | null =>
  v && ObjectId.isValid(v) ? new ObjectId(v) : null;

const memFromDoc = (d: MemoryDoc): Memory => ({
  ...d,
  _id: d._id.toString(),
  superseded_by: d.superseded_by?.toString() ?? null,
  source_trace_id: d.source_trace_id?.toString() ?? null,
});

export class MongoRepo implements MemoryRepo {
  readonly kind = 'atlas' as const;
  private client: MongoClient;
  private db: Db;

  constructor() {
    if (!config.mongoUri) throw new Error('MONGODB_URI is required for the Atlas backend');
    this.client = new MongoClient(config.mongoUri);
    this.db = this.client.db(config.mongoDb);
  }

  private get memories(): Collection<MemoryDoc> {
    return this.db.collection<MemoryDoc>('memories');
  }
  private get traces(): Collection<TraceDoc> {
    return this.db.collection<TraceDoc>('traces');
  }
  private get configColl(): Collection<Policy> {
    return this.db.collection<Policy>('harness_config');
  }

  async init(): Promise<void> {
    await this.client.connect();
    await this.configColl.updateOne(
      { _id: 'policy' },
      { $setOnInsert: DEFAULT_POLICY },
      { upsert: true },
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async reset(): Promise<void> {
    await Promise.all([
      this.memories.deleteMany({}),
      this.traces.deleteMany({}),
      this.configColl.deleteMany({}),
    ]);
    await this.configColl.insertOne(structuredClone(DEFAULT_POLICY));
  }

  async insertMemory(m: NewMemory): Promise<Memory> {
    const now = new Date();
    const doc: MemoryDoc = {
      topic: m.topic,
      text: m.text,
      embedding: m.embedding,
      evidence_level: m.evidence_level,
      year: m.year,
      status: m.status ?? 'active',
      superseded_by: null,
      source_trace_id: toId(m.source_trace_id),
      created_at: now,
      updated_at: now,
      _id: new ObjectId(),
    };
    await this.memories.insertOne(doc);
    return memFromDoc(doc);
  }

  async recall(queryVector: number[], opts: RecallOptions = {}): Promise<RecallHit[]> {
    const filters: Record<string, unknown>[] = [{ status: 'active' }];
    if (opts.topic) filters.push({ topic: opts.topic });
    const pipeline = [
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: 'embedding',
          queryVector,
          numCandidates: opts.numCandidates ?? 100,
          limit: opts.limit ?? 5,
          filter: filters.length > 1 ? { $and: filters } : filters[0],
        },
      },
      { $addFields: { score: { $meta: 'vectorSearchScore' } } },
    ];
    const docs = await this.memories.aggregate<MemoryDoc & { score: number }>(pipeline).toArray();
    return docs.map((d) => ({ memory: memFromDoc(d), score: d.score }));
  }

  async findActiveByTopic(topic: string): Promise<Memory[]> {
    const docs = await this.memories.find({ topic, status: 'active' }).toArray();
    return docs.map(memFromDoc);
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const id = toId(oldId);
    if (!id) return;
    await this.memories.updateOne(
      { _id: id },
      { $set: { status: 'superseded', superseded_by: toId(newId), updated_at: new Date() } },
    );
  }

  async listMemories(
    filter: { topic?: string; status?: Memory['status'] } = {},
  ): Promise<Memory[]> {
    const q: Record<string, unknown> = {};
    if (filter.topic) q.topic = filter.topic;
    if (filter.status) q.status = filter.status;
    const docs = await this.memories.find(q).sort({ created_at: 1 }).toArray();
    return docs.map(memFromDoc);
  }

  async insertTrace(t: Omit<Trace, '_id' | 'created_at'>): Promise<Trace> {
    const doc: TraceDoc = { ...t, _id: new ObjectId(), created_at: new Date() };
    await this.traces.insertOne(doc);
    return { ...doc, _id: doc._id.toString() };
  }

  async listTraces(): Promise<Trace[]> {
    const docs = await this.traces.find({}).sort({ created_at: 1 }).toArray();
    return docs.map((d) => ({ ...d, _id: d._id.toString() }));
  }

  async getPolicy(): Promise<Policy> {
    const doc = await this.configColl.findOne({ _id: 'policy' });
    return doc ?? structuredClone(DEFAULT_POLICY);
  }

  async savePolicy(policy: Policy): Promise<void> {
    const { _id, ...rest } = policy;
    await this.configColl.updateOne({ _id: 'policy' }, { $set: rest }, { upsert: true });
  }
}

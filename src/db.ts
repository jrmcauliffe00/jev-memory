/**
 * MongoDB Atlas backend for `MemoryRepo`. Uses the Node driver and Atlas Vector Search
 * (`$vectorSearch`) for semantic recall over *active* memories only.
 *
 * Collections (DB `jev`): memories, studies, traces, harness_config.
 * The `memories` collection needs a vector index named `vector_index` (see setupIndex.ts / PLAN §7.2)
 * with `numDimensions: 1536` and filter fields `status` + `topic`.
 */
import { MongoClient, ObjectId, type Collection, type Db } from 'mongodb';
import { config } from './config.js';
import {
  computeTraceAgg,
  type MemoryRepo,
  type NewBrief,
  type NewMemory,
  type RecallHit,
  type RecallOptions,
  type TraceAggResult,
} from './repo.js';
import {
  DEFAULT_POLICY,
  type Brief,
  type Memory,
  type Policy,
  type Study,
  type Trace,
} from './types.js';

export const VECTOR_INDEX = 'vector_index';

/** Mongo document shapes (ObjectId ids). We stringify ids at the app boundary. */
type MemoryDoc = Omit<Memory, '_id' | 'source_study_id' | 'superseded_by' | 'source_trace_id'> & {
  _id: ObjectId;
  source_study_id: ObjectId | null;
  superseded_by: ObjectId | null;
  source_trace_id: ObjectId | null;
};
type StudyDoc = Omit<Study, '_id'> & { _id: ObjectId };
type TraceDoc = Omit<Trace, '_id'> & { _id: ObjectId };
type BriefDoc = Omit<Brief, '_id' | 'superseded_by'> & {
  _id: ObjectId;
  superseded_by: ObjectId | null;
};

const toId = (v: string | null): ObjectId | null =>
  v && ObjectId.isValid(v) ? new ObjectId(v) : null;

const memFromDoc = (d: MemoryDoc): Memory => ({
  ...d,
  _id: d._id.toString(),
  source_study_id: d.source_study_id?.toString() ?? null,
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
  private get studies(): Collection<StudyDoc> {
    return this.db.collection<StudyDoc>('studies');
  }
  private get traces(): Collection<TraceDoc> {
    return this.db.collection<TraceDoc>('traces');
  }
  private get configColl(): Collection<Policy> {
    return this.db.collection<Policy>('harness_config');
  }
  private get briefs(): Collection<BriefDoc> {
    return this.db.collection<BriefDoc>('briefs');
  }

  async init(): Promise<void> {
    await this.client.connect();
    // Ensure the singleton policy doc exists.
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
      this.studies.deleteMany({}),
      this.traces.deleteMany({}),
      this.briefs.deleteMany({}),
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
      source_study_id: toId(m.source_study_id),
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
    const docs = (await this.memories.aggregate<MemoryDoc & { score: number }>(pipeline).toArray());
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

  async insertStudies(studies: Omit<Study, '_id'>[]): Promise<Study[]> {
    const docs: StudyDoc[] = studies.map((s) => ({ ...s, _id: new ObjectId() }));
    if (docs.length) await this.studies.insertMany(docs);
    return docs.map((d) => ({ ...d, _id: d._id.toString() }));
  }

  async listStudies(filter: { ingested?: boolean } = {}): Promise<Study[]> {
    const q: Record<string, unknown> = {};
    if (filter.ingested !== undefined) q.ingested = filter.ingested;
    const docs = await this.studies.find(q).toArray();
    return docs.map((d) => ({ ...d, _id: d._id.toString() }));
  }

  async markStudyIngested(id: string): Promise<void> {
    const oid = toId(id);
    if (!oid) return;
    await this.studies.updateOne({ _id: oid }, { $set: { ingested: true } });
  }

  async watchStudies(
    handler: (study: Study) => Promise<void>,
  ): Promise<{ close(): Promise<void> }> {
    const stream = this.studies.watch(
      [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
      { fullDocument: 'updateLookup' },
    );
    stream.on('change', (change) => {
      const doc = 'fullDocument' in change ? change.fullDocument : undefined;
      if (!doc || doc.ingested) return;
      void handler({ ...doc, _id: doc._id.toString() }).catch((err) => {
        console.warn('[watch] digest failed:', String(err));
      });
    });
    return { close: async () => { await stream.close(); } };
  }

  async insertBrief(b: NewBrief): Promise<Brief> {
    const now = new Date();
    const doc: BriefDoc = {
      kind: b.kind,
      topic: b.topic,
      title: b.title,
      markdown: b.markdown,
      finding: b.finding,
      paper_title: b.paper_title,
      contradiction_count: b.contradiction_count,
      status: b.status ?? 'active',
      superseded_by: null,
      issued_at: now,
      created_at: now,
      _id: new ObjectId(),
    };
    await this.briefs.insertOne(doc);
    return {
      ...doc,
      _id: doc._id.toString(),
      superseded_by: null,
    };
  }

  async listBriefs(
    filter: { kind?: Brief['kind']; topic?: string; status?: Brief['status'] } = {},
  ): Promise<Brief[]> {
    const q: Record<string, unknown> = {};
    if (filter.kind) q.kind = filter.kind;
    if (filter.topic) q.topic = filter.topic;
    if (filter.status) q.status = filter.status;
    const docs = await this.briefs.find(q).sort({ issued_at: 1 }).toArray();
    return docs.map((d) => ({
      ...d,
      _id: d._id.toString(),
      superseded_by: d.superseded_by?.toString() ?? null,
    }));
  }

  async supersedeBrief(oldId: string, newId: string): Promise<void> {
    const id = toId(oldId);
    if (!id) return;
    await this.briefs.updateOne(
      { _id: id },
      { $set: { status: 'superseded', superseded_by: toId(newId) } },
    );
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

  async aggregateTraces(): Promise<TraceAggResult> {
    // Closed-schema traces make this exact; compute in-process for portability with the demo.
    return computeTraceAgg(await this.listTraces());
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

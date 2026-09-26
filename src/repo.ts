/**
 * The storage seam. A `MemoryRepo` abstracts the four collections (memories, studies, traces,
 * harness_config) so the exact same app logic runs against MongoDB Atlas (`$vectorSearch`) or a
 * local in-memory backend. `getRepo()` picks Atlas when `MONGODB_URI` is set, else in-memory.
 */
import type { Brief, BriefKind, Memory, Policy, Study, Trace } from './types.js';

export type NewBrief = Omit<Brief, '_id' | 'status' | 'superseded_by' | 'issued_at' | 'created_at'> & {
  status?: Brief['status'];
};
import { useMongo } from './config.js';

/** A recall hit: an active memory plus its similarity score. */
export interface RecallHit {
  memory: Memory;
  score: number;
}

export interface RecallOptions {
  topic?: string;
  limit?: number;
  numCandidates?: number;
}

/** Data the store hands the repo to create a memory (ids/timestamps filled in by the repo). */
export type NewMemory = Omit<
  Memory,
  '_id' | 'status' | 'superseded_by' | 'created_at' | 'updated_at'
> & { status?: Memory['status'] };

export interface TraceAggResult {
  total: number;
  byDecision: Record<string, number>;
  acceptRate: number; // accepts / (accepts + rejects) over write-gate traces
  contradictionRate: number; // contradictions / contradiction-checks
  avgReward: number | null; // mean reward_value over reward_judge traces
  gateCount: number;
  contradictionChecks: number;
}

export interface MemoryRepo {
  readonly kind: 'atlas' | 'in-memory';
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;

  // memories
  insertMemory(m: NewMemory): Promise<Memory>;
  recall(queryVector: number[], opts?: RecallOptions): Promise<RecallHit[]>;
  findActiveByTopic(topic: string): Promise<Memory[]>;
  supersede(oldId: string, newId: string): Promise<void>;
  listMemories(filter?: { topic?: string; status?: Memory['status'] }): Promise<Memory[]>;

  // studies
  insertStudies(studies: Omit<Study, '_id'>[]): Promise<Study[]>;
  listStudies(filter?: { ingested?: boolean }): Promise<Study[]>;
  markStudyIngested(id: string): Promise<void>;
  /**
   * Atlas Change Stream over `studies`. Fires for insert/update of un-ingested docs.
   * In-memory backend throws — Change Streams need a replica set.
   */
  watchStudies?(
    handler: (study: Study) => Promise<void>,
  ): Promise<{ close(): Promise<void> }>;

  // briefs (filed evidence reviews + citation reviews)
  insertBrief(b: NewBrief): Promise<Brief>;
  listBriefs(filter?: {
    kind?: BriefKind;
    topic?: string;
    status?: Brief['status'];
  }): Promise<Brief[]>;
  supersedeBrief(oldId: string, newId: string): Promise<void>;

  // traces
  insertTrace(t: Omit<Trace, '_id' | 'created_at'>): Promise<Trace>;
  listTraces(): Promise<Trace[]>;
  aggregateTraces(): Promise<TraceAggResult>;

  // policy
  getPolicy(): Promise<Policy>;
  savePolicy(policy: Policy): Promise<void>;
}

/**
 * Pure aggregation over the closed-schema trace log. Because every Jev output is one value from a
 * declared set, these rollups are exact rather than approximate — the basis for `evolvePolicy()`.
 */
export const computeTraceAgg = (traces: Trace[]): TraceAggResult => {
  const byDecision: Record<string, number> = {};
  let accepts = 0;
  let rejects = 0;
  let contradictions = 0;
  let contradictionChecks = 0;
  let gateCount = 0;
  let rewardSum = 0;
  let rewardCount = 0;

  for (const t of traces) {
    byDecision[t.decision] = (byDecision[t.decision] ?? 0) + 1;
    if (t.step === 'memory_write_gate') {
      gateCount++;
      if (t.decision === 'accept') accepts++;
      else if (t.decision === 'reject') rejects++;
    } else if (t.step === 'contradiction_check') {
      contradictionChecks++;
      if (t.decision === 'contradiction') contradictions++;
    } else if (t.step === 'reward_judge' && typeof t.reward_value === 'number') {
      rewardSum += t.reward_value;
      rewardCount++;
    }
  }

  return {
    total: traces.length,
    byDecision,
    acceptRate: accepts + rejects > 0 ? accepts / (accepts + rejects) : 0,
    contradictionRate: contradictionChecks > 0 ? contradictions / contradictionChecks : 0,
    avgReward: rewardCount > 0 ? rewardSum / rewardCount : null,
    gateCount,
    contradictionChecks,
  };
};

let cached: MemoryRepo | null = null;

/** Resolve (and memoize) the active repo, initializing it once. */
export const getRepo = async (): Promise<MemoryRepo> => {
  if (cached) return cached;
  if (useMongo()) {
    const { MongoRepo } = await import('./db.js');
    cached = new MongoRepo();
  } else {
    const { InMemoryRepo } = await import('./inMemoryRepo.js');
    cached = new InMemoryRepo();
  }
  await cached.init();
  return cached;
};

/** Reset the memoized repo (used by tests / the reset script after close). */
export const clearRepoCache = (): void => {
  cached = null;
};

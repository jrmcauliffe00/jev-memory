/**
 * Storage seam. The same write-gate logic runs against Atlas or an in-memory backend.
 */
import type { Memory, Policy, Trace } from './types.js';
import { useMongo } from './config.js';

export interface RecallHit {
  memory: Memory;
  score: number;
}

export interface RecallOptions {
  topic?: string;
  limit?: number;
  numCandidates?: number;
}

export type NewMemory = Omit<
  Memory,
  '_id' | 'status' | 'superseded_by' | 'created_at' | 'updated_at'
> & { status?: Memory['status'] };

export interface MemoryRepo {
  readonly kind: 'atlas' | 'in-memory';
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;

  insertMemory(m: NewMemory): Promise<Memory>;
  recall(queryVector: number[], opts?: RecallOptions): Promise<RecallHit[]>;
  findActiveByTopic(topic: string): Promise<Memory[]>;
  supersede(oldId: string, newId: string): Promise<void>;
  listMemories(filter?: { topic?: string; status?: Memory['status'] }): Promise<Memory[]>;

  insertTrace(t: Omit<Trace, '_id' | 'created_at'>): Promise<Trace>;
  listTraces(): Promise<Trace[]>;

  getPolicy(): Promise<Policy>;
  savePolicy(policy: Policy): Promise<void>;
}

let cached: MemoryRepo | null = null;

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

export const clearRepoCache = (): void => {
  cached = null;
};

/**
 * In-memory `MemoryRepo` — the zero-infrastructure "insurance" backend so the full demo (gate,
 * supersede, recall, evolve) runs with no cloud setup. Vector recall is JS cosine similarity over
 * active memories, mirroring what Atlas `$vectorSearch` does server-side.
 */
import { randomUUID } from 'node:crypto';
import { cosineSim } from './embed.js';
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

export class InMemoryRepo implements MemoryRepo {
  readonly kind = 'in-memory' as const;
  private memories: Memory[] = [];
  private studies: Study[] = [];
  private traces: Trace[] = [];
  private briefs: Brief[] = [];
  private policy: Policy = structuredClone(DEFAULT_POLICY);

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async reset(): Promise<void> {
    this.memories = [];
    this.studies = [];
    this.traces = [];
    this.briefs = [];
    this.policy = structuredClone(DEFAULT_POLICY);
  }

  async insertMemory(m: NewMemory): Promise<Memory> {
    const now = new Date();
    const memory: Memory = {
      ...m,
      _id: randomUUID(),
      status: m.status ?? 'active',
      superseded_by: null,
      created_at: now,
      updated_at: now,
    };
    this.memories.push(memory);
    return structuredClone(memory);
  }

  async recall(queryVector: number[], opts: RecallOptions = {}): Promise<RecallHit[]> {
    const limit = opts.limit ?? 5;
    const hits = this.memories
      .filter((m) => m.status === 'active')
      .filter((m) => (opts.topic ? m.topic === opts.topic : true))
      .map((memory) => ({ memory: structuredClone(memory), score: cosineSim(queryVector, memory.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return hits;
  }

  async findActiveByTopic(topic: string): Promise<Memory[]> {
    return this.memories
      .filter((m) => m.status === 'active' && m.topic === topic)
      .map((m) => structuredClone(m));
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const old = this.memories.find((m) => m._id === oldId);
    if (old) {
      old.status = 'superseded';
      old.superseded_by = newId;
      old.updated_at = new Date();
    }
  }

  async listMemories(
    filter: { topic?: string; status?: Memory['status'] } = {},
  ): Promise<Memory[]> {
    return this.memories
      .filter((m) => (filter.topic ? m.topic === filter.topic : true))
      .filter((m) => (filter.status ? m.status === filter.status : true))
      .map((m) => structuredClone(m));
  }

  async insertStudies(studies: Omit<Study, '_id'>[]): Promise<Study[]> {
    const created = studies.map((s) => ({ ...s, _id: randomUUID() }));
    this.studies.push(...created);
    return created.map((s) => structuredClone(s));
  }

  async listStudies(filter: { ingested?: boolean } = {}): Promise<Study[]> {
    return this.studies
      .filter((s) => (filter.ingested === undefined ? true : s.ingested === filter.ingested))
      .map((s) => structuredClone(s));
  }

  async markStudyIngested(id: string): Promise<void> {
    const s = this.studies.find((x) => x._id === id);
    if (s) s.ingested = true;
  }

  async insertBrief(b: NewBrief): Promise<Brief> {
    const now = new Date();
    const brief: Brief = {
      ...b,
      _id: randomUUID(),
      status: b.status ?? 'active',
      superseded_by: null,
      issued_at: now,
      created_at: now,
    };
    this.briefs.push(brief);
    return structuredClone(brief);
  }

  async listBriefs(
    filter: { kind?: Brief['kind']; topic?: string; status?: Brief['status'] } = {},
  ): Promise<Brief[]> {
    return this.briefs
      .filter((b) => (filter.kind ? b.kind === filter.kind : true))
      .filter((b) => (filter.topic ? b.topic === filter.topic : true))
      .filter((b) => (filter.status ? b.status === filter.status : true))
      .map((b) => structuredClone(b));
  }

  async supersedeBrief(oldId: string, newId: string): Promise<void> {
    const old = this.briefs.find((b) => b._id === oldId);
    if (old) {
      old.status = 'superseded';
      old.superseded_by = newId;
    }
  }

  async insertTrace(t: Omit<Trace, '_id' | 'created_at'>): Promise<Trace> {
    const trace: Trace = { ...t, _id: randomUUID(), created_at: new Date() };
    this.traces.push(trace);
    return structuredClone(trace);
  }

  async listTraces(): Promise<Trace[]> {
    return this.traces.map((t) => structuredClone(t));
  }

  async aggregateTraces(): Promise<TraceAggResult> {
    return computeTraceAgg(this.traces);
  }

  async getPolicy(): Promise<Policy> {
    return structuredClone(this.policy);
  }

  async savePolicy(policy: Policy): Promise<void> {
    this.policy = structuredClone(policy);
  }
}

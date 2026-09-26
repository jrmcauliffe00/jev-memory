/**
 * In-memory backend. Vector recall is cosine similarity over active memories.
 */
import { randomUUID } from 'node:crypto';
import { cosineSim } from './embed.js';
import type { MemoryRepo, NewMemory, RecallHit, RecallOptions } from './repo.js';
import { DEFAULT_POLICY, type Memory, type Policy, type Trace } from './types.js';

export class InMemoryRepo implements MemoryRepo {
  readonly kind = 'in-memory' as const;
  private memories: Memory[] = [];
  private traces: Trace[] = [];
  private policy: Policy = structuredClone(DEFAULT_POLICY);

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async reset(): Promise<void> {
    this.memories = [];
    this.traces = [];
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
    return this.memories
      .filter((m) => m.status === 'active')
      .filter((m) => (opts.topic ? m.topic === opts.topic : true))
      .map((memory) => ({
        memory: structuredClone(memory),
        score: cosineSim(queryVector, memory.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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

  async insertTrace(t: Omit<Trace, '_id' | 'created_at'>): Promise<Trace> {
    const trace: Trace = { ...t, _id: randomUUID(), created_at: new Date() };
    this.traces.push(trace);
    return structuredClone(trace);
  }

  async listTraces(): Promise<Trace[]> {
    return this.traces.map((t) => structuredClone(t));
  }

  async getPolicy(): Promise<Policy> {
    return structuredClone(this.policy);
  }

  async savePolicy(policy: Policy): Promise<void> {
    this.policy = structuredClone(policy);
  }
}

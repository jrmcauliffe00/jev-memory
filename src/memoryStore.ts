/**
 * `JevMemoryStore` — a Strands `MemoryStore` backed by MongoDB, whose writes are gated by Jev.
 *
 * The integration seam. Drop it into `createHarness({ memory: { stores: [store] } })` and the agent
 * gains memory that:
 *   1. GATES   — before storing anything, Jev answers "is this worth persisting?" (+ a policy
 *                salience threshold). Junk is rejected; a `traces` doc records the verdict.
 *   2. SUPERSEDES — a new finding that contradicts an existing one (Jev "does this contradict?")
 *                retires the stale record (`status: superseded`) instead of piling up.
 *   3. RECALLS — semantic retrieval via Atlas Vector Search, filtered to `status: active`, so the
 *                agent always answers from the latest evidence.
 *
 * Every write and recall is logged to `traces` with a closed-enum decision, which `evolvePolicy()`
 * later aggregates to retune the gate — closing the self-improvement loop.
 */
import type { JSONValue } from '@strands-agents/sdk';
import type { MemoryEntry, MemoryStore, SearchOptions } from '@strands-agents/sdk';
import { classifyDetailed } from './jev.js';
import { embed } from './embed.js';
import { logJevVerdict } from './traceHook.js';
import { getRepo, type MemoryRepo } from './repo.js';
import {
  evidenceRank,
  type EvidenceLevel,
  type Memory,
  type Policy,
} from './types.js';

/** Structured facts the caller can attach to a write (the demo's study-ingest path uses these). */
export interface IngestMeta {
  topic?: string;
  evidence_level?: EvidenceLevel;
  year?: number;
  source_study_id?: string | null;
}

export interface IngestResult {
  decision: 'accept' | 'reject';
  reason: string;
  stored?: Memory;
  superseded?: Memory;
  salience: number;
  jevStub: boolean;
}

// Jev requires consecutive A..X labels (see jev.ts validateTask); keys carry the semantics.
const YES_NO = [
  { label: 'A', key: 'yes', description: 'Yes.' },
  { label: 'B', key: 'no', description: 'No.' },
] as const;

/** Salience in [0,1] from evidence strength + recency, weighted by the policy's `recency_weight`. */
export const salienceOf = (
  evidence_level: EvidenceLevel,
  year: number,
  policy: Policy,
): number => {
  const evidenceScore = evidenceRank(evidence_level) / 2; // 0 | 0.5 | 1
  const recencyScore = Math.min(1, Math.max(0, (year - 2000) / 30));
  const w = policy.recency_weight;
  return Math.round(((1 - w) * evidenceScore + w * recencyScore) * 1000) / 1000;
};

export class JevMemoryStore implements MemoryStore {
  readonly name: string;
  readonly description: string;
  readonly writable = true as const;
  readonly maxSearchResults: number;

  private repo: MemoryRepo | null = null;

  constructor(opts: { name?: string; description?: string; maxSearchResults?: number } = {}) {
    this.name = opts.name ?? 'jev';
    this.description =
      opts.description ??
      'Biomedical research findings, gated and kept current by Jev (contradictions supersede stale facts).';
    this.maxSearchResults = opts.maxSearchResults ?? 5;
  }

  /** Resolve the shared repo lazily (Atlas or in-memory). */
  private async db(): Promise<MemoryRepo> {
    if (!this.repo) this.repo = await getRepo();
    return this.repo;
  }

  async initialize(): Promise<void> {
    await this.db();
  }

  /** Semantic recall over ACTIVE memories only (Atlas `$vectorSearch`). */
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const repo = await this.db();
    const limit = options?.maxSearchResults ?? this.maxSearchResults;
    const queryVector = await embed(query);
    const start = Date.now();
    const hits = await repo.recall(queryVector, { limit });
    await logJevVerdict(repo, {
      step: 'recall',
      input_ref: query.slice(0, 120),
      jev_question: 'Recall active memories for this query',
      jev_options: ['recall'],
      jev_output: 'recall',
      decision: 'recall',
      latency_ms: Date.now() - start,
    });
    return hits.map(({ memory, score }) => ({
      content: memory.text,
      storeName: this.name,
      metadata: {
        id: memory._id,
        topic: memory.topic,
        evidence_level: memory.evidence_level,
        year: memory.year,
        score,
        source_study_id: memory.source_study_id,
      } satisfies Record<string, JSONValue>,
    }));
  }

  /** `add_memory` / extraction sink. Delegates to the gated {@link ingest} path. */
  async add(content: string, metadata?: Record<string, JSONValue>): Promise<IngestResult> {
    const meta: IngestMeta = {
      topic: typeof metadata?.topic === 'string' ? metadata.topic : undefined,
      evidence_level:
        typeof metadata?.evidence_level === 'string'
          ? (metadata.evidence_level as EvidenceLevel)
          : undefined,
      year: typeof metadata?.year === 'number' ? metadata.year : undefined,
      source_study_id:
        typeof metadata?.source_study_id === 'string' ? metadata.source_study_id : null,
    };
    return this.ingest(content, meta);
  }

  /**
   * The gated write path: Jev decides whether to persist, checks for contradiction against active
   * memories on the same topic, supersedes the stale one when needed, and stores the new finding.
   */
  async ingest(content: string, meta: IngestMeta = {}): Promise<IngestResult> {
    const repo = await this.db();
    const policy = await repo.getPolicy();
    const topic = meta.topic ?? 'general';
    const evidence_level: EvidenceLevel = meta.evidence_level ?? 'observational';
    const year = meta.year ?? new Date().getFullYear();
    const salience = salienceOf(evidence_level, year, policy);

    // --- 1. Write gate: worth persisting? -----------------------------------
    const gate = await classifyDetailed(
      { text: content, evidence_level, year, salience },
      'Is this study worth persisting long-term in the research memory?',
      YES_NO,
      { defaultKey: 'no' },
    );
    const passesThreshold = salience >= policy.write_threshold;
    const accepted = gate.key === 'yes' && passesThreshold;
    const gateTrace = await logJevVerdict(repo, {
      step: 'memory_write_gate',
      input_ref: content.slice(0, 120),
      jev_question: 'Is this study worth persisting long-term?',
      jev_options: ['yes', 'no'],
      jev_output: gate.key,
      decision: accepted ? 'accept' : 'reject',
      latency_ms: gate.latencyMs,
    });

    if (!accepted) {
      const reason =
        gate.key === 'no'
          ? 'Jev gate: not worth persisting.'
          : `Below policy threshold (salience ${salience} < ${policy.write_threshold}).`;
      return { decision: 'reject', reason, salience, jevStub: gate.stub };
    }

    // --- 2. Contradiction check against active memories on this topic --------
    const existing = await repo.findActiveByTopic(topic);
    let superseded: Memory | undefined;
    for (const prior of existing) {
      const check = await classifyDetailed(
        { new_finding: content, existing_finding: prior.text },
        'Does the new finding contradict the existing stored finding?',
        YES_NO,
        { defaultKey: 'no' },
      );
      const contradicts = check.key === 'yes';
      await logJevVerdict(repo, {
        step: 'contradiction_check',
        input_ref: `new:${content.slice(0, 60)} vs mem:${prior._id}`,
        jev_question: 'Does the new finding contradict the existing stored finding?',
        jev_options: ['yes', 'no'],
        jev_output: check.key,
        decision: contradicts ? 'contradiction' : 'consistent',
        latency_ms: check.latencyMs,
      });
      if (contradicts) {
        superseded = prior;
        break; // supersede the first contradicting active finding
      }
    }

    // --- 3. Store the new finding (and supersede the stale one) --------------
    const embedding = await embed(content);
    const stored = await repo.insertMemory({
      topic,
      text: content,
      embedding,
      evidence_level,
      year,
      source_study_id: meta.source_study_id ?? null,
      source_trace_id: gateTrace._id,
    });
    if (superseded) await repo.supersede(superseded._id, stored._id);

    return {
      decision: 'accept',
      reason: superseded
        ? 'Accepted; superseded a contradicting prior finding.'
        : 'Accepted; stored as a new finding.',
      stored,
      superseded,
      salience,
      jevStub: gate.stub,
    };
  }
}

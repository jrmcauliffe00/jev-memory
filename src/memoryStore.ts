/**
 * Jev-gated memory writes.
 *
 *   1. GATE      — Jev answers "worth persisting?" plus a salience threshold.
 *   2. SUPERSEDE — a contradicting new finding retires the stale record.
 *   3. RECALL    — semantic search over `status: active` only.
 */
import { classifyDetailed } from './jev.js';
import { embed } from './embed.js';
import { logJevVerdict } from './traceHook.js';
import { getRepo, type MemoryRepo } from './repo.js';
import { evidenceRank, type EvidenceLevel, type Memory, type Policy } from './types.js';

export interface IngestMeta {
  topic?: string;
  evidence_level?: EvidenceLevel;
  year?: number;
}

export interface IngestResult {
  decision: 'accept' | 'reject';
  reason: string;
  stored?: Memory;
  superseded?: Memory;
  salience: number;
  jevStub: boolean;
}

export interface SearchHit {
  content: string;
  score: number;
  memory: Memory;
}

const YES_NO = [
  { label: 'A', key: 'yes', description: 'Yes.' },
  { label: 'B', key: 'no', description: 'No.' },
] as const;

export const salienceOf = (
  evidence_level: EvidenceLevel,
  year: number,
  policy: Policy,
): number => {
  const evidenceScore = evidenceRank(evidence_level) / 2;
  const recencyScore = Math.min(1, Math.max(0, (year - 2000) / 30));
  const w = policy.recency_weight;
  return Math.round(((1 - w) * evidenceScore + w * recencyScore) * 1000) / 1000;
};

export class JevMemoryStore {
  private repo: MemoryRepo | null = null;
  readonly maxSearchResults: number;

  constructor(opts: { maxSearchResults?: number } = {}) {
    this.maxSearchResults = opts.maxSearchResults ?? 5;
  }

  private async db(): Promise<MemoryRepo> {
    if (!this.repo) this.repo = await getRepo();
    return this.repo;
  }

  async initialize(): Promise<void> {
    await this.db();
  }

  async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
    const repo = await this.db();
    const limit = opts?.limit ?? this.maxSearchResults;
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
    return hits.map(({ memory, score }) => ({ content: memory.text, score, memory }));
  }

  async add(content: string, metadata?: IngestMeta): Promise<IngestResult> {
    return this.ingest(content, metadata);
  }

  /**
   * The gated write path: persist / reject, then supersede a contradicting prior
   * finding on the same topic when Jev says the new text overturns it.
   */
  async ingest(content: string, meta: IngestMeta = {}): Promise<IngestResult> {
    const repo = await this.db();
    const policy = await repo.getPolicy();
    const topic = meta.topic ?? 'general';
    const evidence_level: EvidenceLevel = meta.evidence_level ?? 'observational';
    const year = meta.year ?? new Date().getFullYear();
    const salience = salienceOf(evidence_level, year, policy);

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
        break;
      }
    }

    const embedding = await embed(content);
    const stored = await repo.insertMemory({
      topic,
      text: content,
      embedding,
      evidence_level,
      year,
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

/**
 * Shared domain types for the MongoDB collections (DB `jev`).
 *
 * IDs are strings at the app boundary (Mongo `ObjectId`s are stringified on read)
 * so the same shapes work for both the Atlas and in-memory backends.
 */

/** Strength of the evidence behind a finding. Ordered weakest -> strongest. */
export const EVIDENCE_LEVELS = [
  'observational',
  'meta-analysis',
  'RCT',
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Numeric rank for an evidence level (higher = stronger). Used by contradiction/recency logic. */
export const evidenceRank = (level: EvidenceLevel): number =>
  EVIDENCE_LEVELS.indexOf(level);

/** `memories` — distilled findings the agent knows (the Jev-gated store). */
export interface Memory {
  _id: string;
  topic: string;
  text: string;
  embedding: number[];
  evidence_level: EvidenceLevel;
  year: number;
  source_study_id: string | null;
  status: 'active' | 'superseded';
  superseded_by: string | null;
  source_trace_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** `studies` — seeded source corpus (the "new/emerging research" feed). */
export interface Study {
  _id: string;
  title: string;
  abstract: string;
  topic: string;
  year: number;
  evidence_level: EvidenceLevel;
  conclusion: string;
  ingested: boolean;
}

/** The pipeline step a Jev verdict belongs to. */
export type TraceStep =
  | 'memory_write_gate'
  | 'contradiction_check'
  | 'recall'
  | 'reward_judge'
  | 'brief_check'
  | 'citation_check';

export type BriefKind = 'evidence_review' | 'citation_review';

/** `briefs` — filed artifacts (evidence reviews and paper-citation reviews). */
export interface Brief {
  _id: string;
  kind: BriefKind;
  topic: string | null;
  title: string;
  markdown: string;
  finding: string | null;
  paper_title: string | null;
  contradiction_count: number;
  status: 'active' | 'superseded';
  superseded_by: string | null;
  issued_at: Date;
  created_at: Date;
}

/** `traces` — every Jev verdict (closed schema -> exact aggregation). */
export interface Trace {
  _id: string;
  step: TraceStep;
  input_ref: string;
  jev_question: string;
  jev_options: string[];
  jev_output: string;
  /** Normalized closed enum, e.g. accept | reject | contradiction | consistent | good | bad. */
  decision: string;
  /** Set only for `reward_judge` steps. */
  reward_value: number | null;
  latency_ms: number;
  created_at: Date;
}

/** `harness_config` — the self-rewriting policy (the "Formula" params). Singleton `_id: "policy"`. */
export interface Policy {
  _id: 'policy';
  write_threshold: number;
  recency_weight: number;
  contradiction_mode: 'supersede';
  last_evolved_at: Date | null;
  evolution_log: EvolutionLogEntry[];
}

export interface EvolutionLogEntry {
  at: Date;
  field: string;
  from: number;
  to: number;
  reason: string;
}

export const DEFAULT_POLICY: Policy = {
  _id: 'policy',
  write_threshold: 0.5,
  recency_weight: 0.3,
  contradiction_mode: 'supersede',
  last_evolved_at: null,
  evolution_log: [],
};

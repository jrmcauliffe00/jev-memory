/**
 * Domain types for the Jev-gated memory store (DB `jev`).
 *
 * IDs are strings at the app boundary (Mongo ObjectIds are stringified on read)
 * so the same shapes work for both the Atlas and in-memory backends.
 */

export const EVIDENCE_LEVELS = ['observational', 'meta-analysis', 'RCT'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const evidenceRank = (level: EvidenceLevel): number =>
  EVIDENCE_LEVELS.indexOf(level);

/** Distilled findings. Writes are gated by Jev; contradictions supersede. */
export interface Memory {
  _id: string;
  topic: string;
  text: string;
  embedding: number[];
  evidence_level: EvidenceLevel;
  year: number;
  status: 'active' | 'superseded';
  superseded_by: string | null;
  source_trace_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TraceStep = 'memory_write_gate' | 'contradiction_check' | 'recall';

/** One Jev verdict. Closed-enum `decision` so rollups stay exact. */
export interface Trace {
  _id: string;
  step: TraceStep;
  input_ref: string;
  jev_question: string;
  jev_options: string[];
  jev_output: string;
  decision: string;
  latency_ms: number;
  created_at: Date;
}

/** Singleton write-policy (`_id: "policy"`). */
export interface Policy {
  _id: 'policy';
  write_threshold: number;
  recency_weight: number;
  contradiction_mode: 'supersede';
}

export const DEFAULT_POLICY: Policy = {
  _id: 'policy',
  write_threshold: 0.5,
  recency_weight: 0.3,
  contradiction_mode: 'supersede',
};

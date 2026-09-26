/**
 * Trace logging — one `traces` doc per Jev verdict, with a closed-enum `decision`.
 *
 * Every decision the harness makes flows through Jev, and every Jev verdict is recorded here. Because
 * `decision` is drawn from a closed set, the trace log is exactly aggregatable (see evolvePolicy).
 *
 * This is the "trace hook" of PLAN §8: rather than a harness lifecycle plugin, we log at the exact
 * call sites where Jev is consulted (the memory store and the reward judge), which guarantees a
 * trace for every verdict without depending on SDK hook plumbing.
 */
import type { MemoryRepo } from './repo.js';
import type { Trace, TraceStep } from './types.js';

export interface JevVerdictInput {
  step: TraceStep;
  input_ref: string;
  jev_question: string;
  jev_options: string[];
  jev_output: string;
  decision: string;
  reward_value?: number | null;
  latency_ms: number;
}

/** Persist a single Jev verdict as a `traces` doc and return it (for `source_trace_id` linkage). */
export const logJevVerdict = (
  repo: MemoryRepo,
  v: JevVerdictInput,
): Promise<Trace> =>
  repo.insertTrace({
    step: v.step,
    input_ref: v.input_ref,
    jev_question: v.jev_question,
    jev_options: v.jev_options,
    jev_output: v.jev_output,
    decision: v.decision,
    reward_value: v.reward_value ?? null,
    latency_ms: v.latency_ms,
  });

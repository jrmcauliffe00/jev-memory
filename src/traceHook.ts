import type { MemoryRepo } from './repo.js';
import type { Trace, TraceStep } from './types.js';

export interface JevVerdictInput {
  step: TraceStep;
  input_ref: string;
  jev_question: string;
  jev_options: string[];
  jev_output: string;
  decision: string;
  latency_ms: number;
}

export const logJevVerdict = (repo: MemoryRepo, v: JevVerdictInput): Promise<Trace> =>
  repo.insertTrace({
    step: v.step,
    input_ref: v.input_ref,
    jev_question: v.jev_question,
    jev_options: v.jev_options,
    jev_output: v.jev_output,
    decision: v.decision,
    latency_ms: v.latency_ms,
  });

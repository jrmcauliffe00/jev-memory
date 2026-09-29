/**
 * Typed, confidence-gated side effects.
 *
 * Idea: closed option keys give type-safe branches; a confidence threshold
 * makes the call deterministic — only invoke `call` when the classifier picks
 * an accepted key *and* confidence is high enough.
 *
 *   const gate = await callIfConfident({
 *     state: { tool: 'shell', command },
 *     question: 'Is this tool call safe to run without human approval?',
 *     options: [
 *       { label: 'A', key: 'allow', description: 'Safe to run.' },
 *       { label: 'B', key: 'deny', description: 'Do not run.' },
 *     ],
 *     acceptKeys: ['allow'],
 *     minConfidence: 0.8,
 *     call: () => runShell(command),
 *   })
 *   if (!gate.proceeded) { ... ask user / skip ... }
 */
import {
  classifyDetailed,
  type ClassifyResult,
  type Option,
} from './jev.js';

export type RejectReason = 'rejected_key' | 'low_confidence';

export type ConfidentProceed<K extends string, T> = {
  proceeded: true;
  key: K;
  confidence: number;
  label: string;
  stub: boolean;
  result: T;
};

export type ConfidentSkip<K extends string> = {
  proceeded: false;
  key: K;
  confidence: number;
  label: string;
  stub: boolean;
  reason: RejectReason;
};

export type ConfidentCallResult<Accept extends string, All extends string, T> =
  | ConfidentProceed<Accept, T>
  | ConfidentSkip<All>;

export interface CallIfConfidentArgs<
  O extends readonly Option[],
  Accept extends O[number]['key'],
  T,
> {
  state: unknown;
  question: string;
  options: O;
  /** Keys that authorize `call`. Narrowed into the proceed branch. */
  acceptKeys: readonly Accept[];
  /** Minimum confidence in [0, 1]. Below this → skip even if key matches. */
  minConfidence: number;
  defaultKey?: O[number]['key'];
  /**
   * Confidence when logprobs are missing (stub / failure). Default `0` so
   * gated side effects do not fire without evidence.
   */
  missingConfidence?: number;
  /** Only runs when key ∈ acceptKeys and confidence ≥ minConfidence. */
  call: (decision: ClassifyResult<Accept>) => Promise<T> | T;
}

/**
 * Classify, then optionally run a typed callback.
 * Side effect runs iff accepted key + confidence threshold both pass.
 */
export async function callIfConfident<
  const O extends readonly Option[],
  Accept extends O[number]['key'],
  T,
>(
  args: CallIfConfidentArgs<O, Accept, T>,
): Promise<ConfidentCallResult<Accept, O[number]['key'], T>> {
  if (args.minConfidence < 0 || args.minConfidence > 1) {
    throw new Error('minConfidence must be in [0, 1]');
  }
  if (args.acceptKeys.length === 0) {
    throw new Error('acceptKeys must be nonempty');
  }

  const decision = await classifyDetailed(args.state, args.question, args.options, {
    defaultKey: args.defaultKey,
  });

  const confidence =
    decision.confidence ?? args.missingConfidence ?? 0;

  const accepted = (args.acceptKeys as readonly string[]).includes(decision.key);

  if (!accepted) {
    return {
      proceeded: false,
      key: decision.key,
      confidence,
      label: decision.label,
      stub: decision.stub,
      reason: 'rejected_key',
    };
  }

  if (confidence < args.minConfidence) {
    return {
      proceeded: false,
      key: decision.key,
      confidence,
      label: decision.label,
      stub: decision.stub,
      reason: 'low_confidence',
    };
  }

  // TypeScript: accepted + includes check narrows key to Accept.
  const keyed = decision as ClassifyResult<Accept>;
  const result = await args.call(keyed);
  return {
    proceeded: true,
    key: keyed.key,
    confidence,
    label: keyed.label,
    stub: keyed.stub,
    result,
  };
}

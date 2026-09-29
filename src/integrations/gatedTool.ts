/**
 * Confidence-gated tool: classify, then only run `call` when the key is
 * accepted and confidence clears the threshold.
 *
 * Deterministic + type-safe: option keys are closed; side effects are skipped
 * on `rejected_key` or `low_confidence` instead of narrated LLM judgment.
 *
 *   tool(createJevGatedTool({
 *     name: 'run_shell_if_safe',
 *     question: 'Is this shell command safe to run without approval?',
 *     options: [
 *       { key: 'allow', description: 'Safe to run.' },
 *       { key: 'deny', description: 'Do not run.' },
 *     ],
 *     acceptKeys: ['allow'],
 *     minConfidence: 0.8,
 *     call: async ({ state }) => execShell(state.command),
 *   }))
 */
import { callIfConfident } from '../callIfConfident.js';
import { toWireOptions, type DecisionOption } from './options.js';
import type { JevToolConfig } from './types.js';

export interface GatedToolInput {
  state: unknown;
}

export type GatedToolResult<T = unknown> =
  | {
      proceeded: true;
      key: string;
      confidence: number;
      stub: boolean;
      result: T;
    }
  | {
      proceeded: false;
      key: string;
      confidence: number;
      stub: boolean;
      reason: 'rejected_key' | 'low_confidence';
    };

export interface GatedToolSpec<Accept extends string, T> {
  name: string;
  question: string;
  options: readonly DecisionOption[];
  /** Keys that authorize the side effect. */
  acceptKeys: readonly Accept[];
  /** Minimum confidence in [0, 1]. */
  minConfidence: number;
  defaultKey?: string;
  /**
   * Confidence when logprobs are missing. Default 0 (fail closed).
   * Set to 1 in tests that intentionally trust the stub.
   */
  missingConfidence?: number;
  description?: string;
  /** Runs only when accepted key + confidence both pass. */
  call: (input: { state: unknown; key: Accept; confidence: number }) => Promise<T> | T;
}

export function createJevGatedTool<Accept extends string, T>(
  spec: GatedToolSpec<Accept, T>,
): JevToolConfig<GatedToolInput, GatedToolResult<T>> {
  const options = toWireOptions(spec.options);
  for (const k of spec.acceptKeys) {
    if (!options.some((o) => o.key === k)) {
      throw new Error(`acceptKeys entry "${k}" is not in options`);
    }
  }

  return {
    name: spec.name,
    description:
      spec.description ??
      `Confidence-gated action: ${spec.question} ` +
        `Runs only if key ∈ [${spec.acceptKeys.join(', ')}] ` +
        `and confidence ≥ ${spec.minConfidence}. ` +
        `Otherwise returns { proceeded: false, reason }.`,
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          description:
            'JSON context for the decision and for the gated call on proceed.',
        },
      },
      required: ['state'],
      additionalProperties: false,
    },
    callback: async (input) => {
      const gate = await callIfConfident({
        state: input.state,
        question: spec.question,
        options,
        acceptKeys: spec.acceptKeys,
        minConfidence: spec.minConfidence,
        defaultKey: spec.defaultKey,
        missingConfidence: spec.missingConfidence ?? 0,
        call: (decision) =>
          spec.call({
            state: input.state,
            key: decision.key,
            confidence: decision.confidence ?? spec.missingConfidence ?? 0,
          }),
      });

      if (!gate.proceeded) {
        return {
          proceeded: false,
          key: gate.key,
          confidence: gate.confidence,
          stub: gate.stub,
          reason: gate.reason,
        };
      }
      return {
        proceeded: true,
        key: gate.key,
        confidence: gate.confidence,
        stub: gate.stub,
        result: gate.result,
      };
    },
  };
}

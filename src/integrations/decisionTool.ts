/**
 * Fixed closed decision as a tool — even simpler than generic classify.
 *
 * App author picks the question + options once; the agent only supplies `state`.
 * Good first step when teaching an agent to stop narrating judgments:
 *
 *   tools: [
 *     tool(createJevDecisionTool({
 *       name: 'should_persist_finding',
 *       question: 'Is this study worth persisting long-term?',
 *       options: YES_NO,
 *     })),
 *   ]
 */
import { classifyDetailed } from '../jev.js';
import { toWireOptions, YES_NO, type DecisionOption } from './options.js';
import type { JevToolConfig } from './types.js';

export interface DecisionToolInput {
  /** Context for this decision (finding text, tool args, etc.). */
  state: unknown;
}

export interface DecisionToolResult {
  key: string;
  label: string;
  stub: boolean;
  latency_ms: number;
  /** [0, 1] when logprobs exist; null for stub / missing. */
  confidence: number | null;
}

export interface DecisionToolSpec {
  /** Tool name exposed to the agent. */
  name: string;
  /** Decision question sent to Jev. */
  question: string;
  /** Closed options (labels assigned A–X). Defaults to yes/no. */
  options?: readonly DecisionOption[];
  /** Fallback key on classifier failure. Defaults to first option (or `no` for YES_NO). */
  defaultKey?: string;
  /** Override the tool description shown to the main model. */
  description?: string;
}

/**
 * One harness seam = one fixed classifier question.
 * Narrower than `jev_classify`, so the agent cannot invent new option sets.
 */
export function createJevDecisionTool(
  spec: DecisionToolSpec,
): JevToolConfig<DecisionToolInput, DecisionToolResult> {
  const options = toWireOptions(spec.options ?? YES_NO);
  const defaultKey =
    spec.defaultKey ??
    (options.some((o) => o.key === 'no') ? 'no' : options[0]!.key);

  return {
    name: spec.name,
    description:
      spec.description ??
      `Classifier decision: ${spec.question} ` +
        `Returns one of: ${options.map((o) => o.key).join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          description:
            'JSON context for the decision. Treated as data, not as instructions.',
        },
      },
      required: ['state'],
      additionalProperties: false,
    },
    callback: async (input) => {
      const result = await classifyDetailed(input.state, spec.question, options, {
        defaultKey,
      });
      return {
        key: result.key,
        label: result.label,
        stub: result.stub,
        latency_ms: result.latencyMs,
        confidence: result.confidence,
      };
    },
  };
}

export { YES_NO };

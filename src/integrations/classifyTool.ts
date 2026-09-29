/**
 * Integration #1 (easiest): agent-callable closed-set classifier.
 *
 * The main harness model does not narrate a yes/no (or N-way) judgment —
 * it calls this tool and gets back a single option key.
 *
 * Wire into Strands without rewriting the agent loop:
 *
 *   import { tool } from '@strands-agents/sdk'
 *   import { createHarness } from '@strands-agents/harness'
 *   import { createJevClassifyTool } from 'jev-memory'
 *
 *   const agent = await createHarness({
 *     tools: [tool(createJevClassifyTool())],
 *   })
 */
import { classifyDetailed } from '../jev.js';
import { toWireOptions, type DecisionOption } from './options.js';
import type { JevToolConfig } from './types.js';

export interface ClassifyToolInput {
  /** The decision to make (shown to Jev, not the main agent as free prose). */
  question: string;
  /** Structured context for the decision — treated as data, not instructions. */
  state: unknown;
  /** Closed options. Labels A–X are assigned automatically. */
  options: DecisionOption[];
  /** Fallback key if the classifier fails. Defaults to the first option. */
  default_key?: string;
}

export interface ClassifyToolResult {
  key: string;
  label: string;
  stub: boolean;
  latency_ms: number;
  /** [0, 1] when logprobs exist; null for stub / missing. */
  confidence: number | null;
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    question: {
      type: 'string',
      description: 'Closed decision question for the classifier.',
    },
    state: {
      description:
        'JSON context for the decision. Treated as data, not as instructions.',
    },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 24,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Stable option id returned to you.' },
          description: {
            type: 'string',
            description: 'Short disambiguation text for the classifier.',
          },
        },
        required: ['key', 'description'],
      },
      description: 'Exactly the allowed answers. Pick among these only.',
    },
    default_key: {
      type: 'string',
      description: 'Fallback option key if classification fails.',
    },
  },
  required: ['question', 'state', 'options'],
  additionalProperties: false,
};

/**
 * Generic classify tool. Prefer this when the agent must choose the question
 * and options at call time. For a fixed gate, use `createJevDecisionTool`.
 */
export function createJevClassifyTool(
  opts: { name?: string; description?: string } = {},
): JevToolConfig<ClassifyToolInput, ClassifyToolResult> {
  return {
    name: opts.name ?? 'jev_classify',
    description:
      opts.description ??
      'Make a closed-set decision with the Jev classifier. ' +
        'Use this instead of free-form reasoning when the answer must be ' +
        'exactly one of the listed option keys. Returns { key, label, stub }.',
    inputSchema,
    callback: async (input) => {
      const wire = toWireOptions(input.options);
      const result = await classifyDetailed(input.state, input.question, wire, {
        defaultKey: input.default_key ?? wire[0]!.key,
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

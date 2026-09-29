/**
 * Strands-facing shapes we can ship without depending on Strands source.
 *
 * Consumers wrap these with `tool()` from `@strands-agents/sdk` (or pass the
 * config straight through if their harness accepts the same shape):
 *
 *   import { tool } from '@strands-agents/sdk'
 *   import { createJevClassifyTool } from 'jev-memory'
 *   createHarness({ tools: [tool(createJevClassifyTool())] })
 */

/** Minimal JSON Schema object Strands `tool({ inputSchema })` accepts. */
export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * Config object compatible with `@strands-agents/sdk` `tool()` / FunctionToolConfig.
 * No Strands import — keep this package usable as a peer-composed integration.
 */
export interface JevToolConfig<TInput = unknown, TReturn = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  callback: (input: TInput) => Promise<TReturn> | TReturn;
}

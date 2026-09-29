/**
 * Example: compose Jev into a Strands harness without rewriting the agent.
 *
 * This file is documentation-as-code. Install peers to run it:
 *   npm i @strands-agents/harness @strands-agents/sdk
 *
 * You keep the same createHarness / invoke loop. Jev plugs in at seams
 * Strands already owns: `tools` and `memory.stores`.
 */
import { createHarness } from '@strands-agents/harness';
import { tool } from '@strands-agents/sdk';
import {
  createJevClassifyTool,
  createJevDecisionTool,
  createJevGatedTool,
  JevMemoryStore,
  YES_NO,
} from '../src/index.js';

async function main() {
  const shouldPersist = tool(
    createJevDecisionTool({
      name: 'should_persist_finding',
      question: 'Is this study worth persisting long-term in the research memory?',
      options: YES_NO,
      defaultKey: 'no',
    }),
  );

  const classify = tool(createJevClassifyTool());

  // Side effect only if key=yes AND confidence ≥ 0.8
  const persistIfConfident = tool(
    createJevGatedTool({
      name: 'persist_finding_if_confident',
      question: 'Is this study worth persisting long-term in the research memory?',
      options: YES_NO,
      acceptKeys: ['yes'],
      minConfidence: 0.8,
      defaultKey: 'no',
      call: async ({ state }) => ({ stored: true, state }),
    }),
  );

  const memory = new JevMemoryStore();

  const agent = await createHarness({
    instructions:
      'When you need a closed judgment, call should_persist_finding or jev_classify. ' +
      'To persist only when the classifier is confident, call persist_finding_if_confident.',
    tools: [shouldPersist, classify, persistIfConfident],
    memory: { stores: [memory] },
  });

  await agent.invoke(
    'We have a finding: early peanut introduction reduces allergy risk (RCT, 2015). ' +
      'Persist it only if the classifier is confident.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

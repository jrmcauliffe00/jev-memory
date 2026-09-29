# jev-memory

Closed-set classifier (Jev) for [Strands](https://strandsagents.com) harnesses. Two seams:

1. **Memory gate** — only persist when Jev says yes  
2. **Tool-call gate** — only run a side effect when key + confidence pass  

```bash
npm i jev-memory @strands-agents/harness @strands-agents/sdk
```

```ts
import { createHarness } from '@strands-agents/harness'
import { tool } from '@strands-agents/sdk'
import {
  JevMemoryStore,
  createJevGatedTool,
  YES_NO,
} from 'jev-memory'

const agent = await createHarness({
  memory: { stores: [new JevMemoryStore()] },
  tools: [
    tool(
      createJevGatedTool({
        name: 'run_if_safe',
        question: 'Is this action safe to run?',
        options: YES_NO,
        acceptKeys: ['yes'],
        minConfidence: 0.8,
        call: async ({ state }) => doThing(state),
      }),
    ),
  ],
})
```

Set `TOGETHER_API_KEY` (and optionally `MONGODB_URI`). Train: see [`train/`](train/).

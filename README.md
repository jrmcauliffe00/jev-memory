# jev-memory

Jev gates what the [Strands](https://strandsagents.com) harness writes to memory. Accepted text is embedded and stored in Mongo; recall is Atlas Vector Search over `active` rows only.

**Write:** harness `add` → Jev (persist? contradict?) → embed → Mongo  
**Read:** query → embed → `$vectorSearch`

1. `cp .env.example .env` — set `MONGODB_URI`, `TOGETHER_API_KEY`, `OPENAI_API_KEY`
2. `npm i && npm run setup:index`
3. Drop the store into the harness:

```ts
import { createHarness } from '@strands-agents/harness'
import { JevMemoryStore } from './src/index.js'

const agent = await createHarness({
  memory: { stores: [new JevMemoryStore()] },
})
```

Train your own Jev (Together LoRA). Same `{ state, question, options }` contract as `src/jev.ts` — completion is one letter:

```json
{"state": {"text": "…"}, "question": "Is this worth persisting long-term in the research memory?", "options": [{"label": "A", "key": "yes", "description": "Yes."}, {"label": "B", "key": "no", "description": "No."}], "answer": "A"}
```

```bash
cd train && uv sync
uv run python render_instruction.py
uv run --env-file .env python train_together.py --launch
```

Point `TOGETHER_MODEL` at the deployed endpoint. More in [`train/`](train/).

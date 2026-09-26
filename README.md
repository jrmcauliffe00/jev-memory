<div align="center">

# jev-memory

### Drop-in **self-improving memory** for [Strands](https://strandsagents.com) agents — backed by MongoDB Atlas, gated by a type-safe classifier.

**This is not a medical advice generator. It is a citations / evidence reviewer.**

Pass one store to `createHarness` → the clerk **decides what to remember, retires contradicted findings, and tunes its own policy.** It files **evidence-review memos**. A second agent uses those memos to **review a paper’s citations** against Mongo: what still holds, what the record already contradicted.

</div>

---

## What it is

A MongoDB-backed `MemoryStore` for the Strands harness. Every write is gated by **Jev**, a cheap, **type-safe classifier** (Together AI):

- **Remembers selectively** — Jev answers *"worth persisting?"* before anything is stored.
- **Stays current** — contradictions **supersede** the old record. No memory rot.
- **Self-improves** — closed-enum verdicts are logged to Mongo and aggregated to retune the policy.
- **Type-safe** — Jev only ever returns one value from a closed set. Analytics over `traces` are exact.

## Run the demo

```bash
cp .env.example .env   # then set MONGODB_URI + OPENAI_API_KEY (Together optional)
npm install
npm run setup:index    # Atlas vector index on jev.memories (1536-dim)
npm run seed           # curated reversals + ~200 PubMedQA background memories
npm run demo           # five-beat judge script + health panel
```

Optional Atlas flourish (after seed):

```bash
npm run watch          # Change Stream: new rows in `studies` get digested live
npm run ingest         # one-shot drain of the studies inbox
npm run evolve         # rewrite harness_config from the trace log
```

`tev1/` is a separate Together tutorial clone used only to train Jev. The app reads the **root** `.env`, never `tev1/.env`.

## Quickstart

```ts
import { createResearchHarness, createCitationReviewHarness } from './src/index.js'

const store = (await createResearchHarness()).store
const { agent: clerk } = await createResearchHarness(store)
const { agent: reviewer } = await createCitationReviewHarness(store)

await clerk.invoke("File the current evidence review on infant peanut introduction.")
await reviewer.invoke("Review this paper's citations against our evidence record.")
```

Two agents, one Mongo record:

1. **Clerk** (`write_evidence_review`) — files a memo: current finding + what was contradicted. Saved in `briefs`.
2. **Reviewer** (`review_paper_citations`) — takes a new paper’s cited claims and asks: does any cite contradict the current record, or restate a finding we already retired?

## How it works

```
new study ──▶ ingest / Jev gate ──▶ memories + briefs (Mongo)
                                         │
clerk files evidence memo ───────────────┤
                                         ▼
new paper citations ──▶ reviewer agent ──▶ citation review (flagged vs record)
                                         │
                                    traces → evolvePolicy()
```

1. **Land** — raw studies land in `studies` (`ingested: false`). No LLM.
2. **Gate** — Jev: *worth persisting?* / *contradicts existing memory?*
3. **Supersede** — stale facts flip to `status: superseded`.
4. **File** — clerk writes an evidence-review memo into `briefs`.
5. **Review** — citation agent checks a paper’s cites against those memos + memory.
6. **Evolve** — aggregate `traces` → rewrite `harness_config`. The loop closes.

## Requirements

- Node.js ≥ 22
- MongoDB Atlas (free M0 works; needed for Vector Search + Change Streams)
- `OPENAI_API_KEY` for real embeddings (`text-embedding-3-small`, 1536-dim)
- `TOGETHER_API_KEY` for live Jev; without it the app uses a deterministic stub

## Links

- Strands → https://strandsagents.com
- Built for the MongoDB "Recursive Harnessing" hackathon.

## License

Apache-2.0

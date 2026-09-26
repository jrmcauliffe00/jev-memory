/**
 * `createResearchHarness()` — the Strands harness wired with the Jev-gated MongoDB memory store
 * and the evidence-review tool.
 *
 * This is the whole integration: pass one `JevMemoryStore` to `createHarness({ memory: { stores } })`
 * and add `write_evidence_review`. The store handles gating/supersede/recall; the tool is the
 * agent's job — file a review of current vs contradicted evidence, then let Jev check it.
 */
import { createHarness } from '@strands-agents/harness';
import type { Agent } from '@strands-agents/sdk';
import { config } from './config.js';
import { JevMemoryStore } from './memoryStore.js';
import { createWriteGuidanceBriefTool } from './tools/guidanceBrief.js';
import { createReviewPaperCitationsTool } from './tools/citationReview.js';

const INSTRUCTIONS = `You are a research-evidence clerk. Your job is to file an evidence
review for a topic: what the stored record currently supports, and what prior finding
was contradicted. You do not give medical advice, treat patients, or recommend care.

Always call the write_evidence_review tool with the topic slug (for example
infant_peanut_introduction). The tool reads active memory, notes anything superseded,
and Jev checks the memo. Quote the tool's review back to the user. If the tool says
there is insufficient evidence, say so. Prefer the most recent, highest-evidence
active finding. Never present a superseded finding as current.`;

export interface ResearchHarness {
  agent: Agent;
  store: JevMemoryStore;
}

/** Build the harness + its Jev memory store + the guidance-brief tool. */
export const createResearchHarness = async (
  store: JevMemoryStore = new JevMemoryStore(),
): Promise<ResearchHarness> => {
  const agent = await createHarness({
    model: config.harnessModel,
    instructions: INSTRUCTIONS,
    memory: { stores: [store] },
    tools: [createWriteGuidanceBriefTool(store)],
    builtinTools: [],
    session: false,
    skills: false,
  });
  return { agent, store };
};

const REVIEWER_INSTRUCTIONS = `You are a citation reviewer. Your job is to check a paper's
cited claims against the Mongo evidence record — filed memos and active/superseded findings.
You do not give medical advice, treat patients, or recommend care.

Always call the review_paper_citations tool with the paper title, abstract, and the
cited claims. Quote the tool's review. Flag cites that contradict the current finding
or restate a retired finding. Do not invent contradictions.`;

/** Second agent: review a paper's citations against filed memos + memory. */
export const createCitationReviewHarness = async (
  store: JevMemoryStore = new JevMemoryStore(),
): Promise<ResearchHarness> => {
  const agent = await createHarness({
    model: config.harnessModel,
    instructions: REVIEWER_INSTRUCTIONS,
    memory: { stores: [store] },
    tools: [createReviewPaperCitationsTool()],
    builtinTools: [],
    session: false,
    skills: false,
  });
  return { agent, store };
};

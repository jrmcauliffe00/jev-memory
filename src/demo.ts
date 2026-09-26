/**
 * Demo driver for judges (PLAN §10). Runs the five-beat script end-to-end:
 *
 *   1. Baseline      — write_evidence_review on the peanut topic (OLD "avoid" finding).
 *   2. Junk reject   — feed chit-chat; Jev gate = no; nothing stored.
 *   3. New evidence  — feed the new RCT; Jev catches the contradiction; old finding superseded.
 *   4. Re-issue      — same tool call; review now cites LEAP and names the contradicted finding.
 *   5. Cite review   — second agent checks a stale-citing paper against the filed memos.
 *   6. Recursion     — evolvePolicy() rewrites the memory policy from the trace log.
 *
 * Runs fully offline (in-memory + Jev stub + local embeddings) so it never crashes on stage. Set
 * MONGODB_URI / TOGETHER_API_KEY / OPENAI_API_KEY to light up the real backends — same script.
 */
import { config, describeMode, useLiveEmbeddings } from './config.js';
import type { MemoryRepo } from './repo.js';
import { JevMemoryStore } from './memoryStore.js';
import { evolvePolicy } from './evolve.js';
import { seed } from './seed.js';
import { flagshipStudy, junkNote, staleCitingPaper, TOPIC } from './data/studies.js';
import { issueGuidanceBrief } from './tools/guidanceBrief.js';
import { reviewPaperCitations } from './tools/citationReview.js';
import type { Memory } from './types.js';
import type { Agent } from '@strands-agents/sdk';

const line = (c = '─'): string => c.repeat(72);
const h = (n: number, title: string): void => {
  console.log(`\n${line()}\n  ${n}. ${title}\n${line()}`);
};
const pause = (ms = 350): Promise<void> => new Promise((r) => setTimeout(r, ms));

const printBriefMarkdown = (markdown: string): void => {
  for (const row of markdown.split('\n')) console.log(`   ${row}`);
};

/** File a living brief. Prefers a live `agent.invoke(...)` so judges watch the harness; falls back to the tool. */
const issueBrief = async (
  store: JevMemoryStore,
  topic: string,
  agent?: Agent,
): Promise<void> => {
  if (agent) {
    const ask = 'File the current evidence review on infant peanut introduction.';
    console.log(`   🤖 agent.invoke("${ask}")`);
    try {
      await agent.invoke(ask);
      return;
    } catch (err) {
      console.log(`   (agent.invoke failed, using tool: ${String(err)})`);
    }
  }
  const brief = await issueGuidanceBrief(topic, store);
  console.log(`   🛠️  tool: write_evidence_review({ topic: "${topic}" })`);
  printBriefMarkdown(brief.markdown);
  console.log(
    `   ⭐ Jev: grounded=${brief.checks.grounded}  change=${brief.checks.change}  quality=${brief.checks.quality} (${brief.checks.reward_value})`,
  );
};

const showMemories = (label: string, memories: Memory[]): void => {
  console.log(`   ${label}:`);
  for (const m of memories) {
    const flag = m.status === 'active' ? '🟢 active    ' : '⚪ superseded';
    console.log(`     ${flag} [${m.evidence_level}/${m.year}] ${m.text.slice(0, 78)}…`);
  }
};

const healthPanel = async (repo: MemoryRepo): Promise<void> => {
  const agg = await repo.aggregateTraces();
  const policy = await repo.getPolicy();
  const active = (await repo.listMemories({ status: 'active' })).length;
  const superseded = (await repo.listMemories({ status: 'superseded' })).length;
  console.log(`\n${line('═')}`);
  console.log('  📊 MEMORY HEALTH PANEL');
  console.log(line('═'));
  console.log(`   traces logged .......... ${agg.total}`);
  console.log(`   write-gate accept rate . ${(agg.acceptRate * 100).toFixed(0)}%  (${agg.gateCount} gated)`);
  console.log(`   contradictions caught .. ${(agg.contradictionRate * 100).toFixed(0)}%  (${agg.contradictionChecks} checks)`);
  console.log(`   avg answer reward ...... ${agg.avgReward === null ? 'n/a' : agg.avgReward.toFixed(2)}`);
  const briefs = (await repo.listBriefs()).length;
  console.log(`   memories ............... ${active} active / ${superseded} superseded`);
  console.log(`   briefs filed ........... ${briefs}`);
  console.log(`   policy.write_threshold . ${policy.write_threshold}`);
  console.log(`   policy.recency_weight .. ${policy.recency_weight}`);
  console.log(line('═'));
};

const main = async (): Promise<void> => {
  console.log(`\n🧬 Jev × MongoDB × Strands — self-improving research memory`);
  console.log(`   mode: ${describeMode()}`);
  if (!useLiveEmbeddings()) {
    console.log('   (local pseudo-embeddings: recall is lexical-ish; set OPENAI_API_KEY for semantic recall)');
  }

  // Clean slate. Keep the client open — seed() used to close it and break Atlas runs.
  const repo = await seed({ close: false });
  const store = new JevMemoryStore();
  const briefAsk = 'File the current evidence review on infant peanut introduction.';

  let agent: Agent | undefined;
  let reviewer: Agent | undefined;
  if (config.openaiApiKey) {
    try {
      const { createResearchHarness, createCitationReviewHarness } = await import('./agent.js');
      ({ agent } = await createResearchHarness(store));
      ({ agent: reviewer } = await createCitationReviewHarness(store));
      console.log('   harness: clerk + citation reviewer via agent.invoke');
    } catch (err) {
      console.log(`   (harness create skipped: ${String(err)})`);
    }
  } else {
    console.log('   harness: no OPENAI_API_KEY — tools run directly');
  }

  // 1. Baseline -------------------------------------------------------------
  h(1, 'Baseline — evidence review from current (old) memory');
  console.log(`   ❓ ${briefAsk}`);
  await issueBrief(store, TOPIC, agent);
  showMemories('memory', await repo.listMemories({ topic: TOPIC }));
  await pause();

  // 2. Junk reject ----------------------------------------------------------
  h(2, 'Junk reject — the write gate keeps memory clean');
  console.log(`   📝 feeding a non-evidence note: "${junkNote.slice(0, 60)}…"`);
  const junk = await store.ingest(junkNote, { topic: TOPIC });
  console.log(`   🚦 gate:    ${junk.decision.toUpperCase()} — ${junk.reason}`);
  console.log(`   → memories unchanged: ${(await repo.listMemories({ status: 'active' })).length} active`);
  await pause();

  // 3. New evidence (the money shot) ---------------------------------------
  h(3, 'New evidence arrives — contradiction caught, stale finding superseded');
  const study = flagshipStudy;
  console.log(`   📄 new study: ${study.title}`);
  console.log(`      conclusion: "${study.conclusion}"`);
  const ingest = await store.ingest(study.conclusion, {
    topic: study.topic,
    evidence_level: study.evidence_level,
    year: study.year,
  });
  console.log(`   🚦 gate:    ${ingest.decision.toUpperCase()} (salience ${ingest.salience})`);
  if (ingest.superseded) {
    console.log(`   🔁 supersede: retired stale finding "${ingest.superseded.text.slice(0, 50)}…"`);
  }
  showMemories('memory now', await repo.listMemories({ topic: TOPIC }));
  await pause();

  // 4. Re-issue the brief ---------------------------------------------------
  h(4, 'Re-issue — same prompt, new review after the evidence flip');
  console.log(`   ❓ ${briefAsk}`);
  await issueBrief(store, TOPIC, agent);
  await pause();

  // 5. Citation reviewer ----------------------------------------------------
  h(5, 'Citation review — stale paper vs the filed memos');
  console.log(`   📄 paper: ${staleCitingPaper.title}`);
  const reviewAsk =
    `Review this paper's citations against our evidence record. ` +
    `Title: ${staleCitingPaper.title}. ` +
    `Abstract: ${staleCitingPaper.abstract}. ` +
    `Citations: ${staleCitingPaper.citations.join(' | ')}. ` +
    `Topic slug: ${TOPIC}.`;
  if (reviewer) {
    console.log('   🤖 reviewer.invoke(...)');
    try {
      await reviewer.invoke(reviewAsk);
    } catch (err) {
      console.log(`   (reviewer invoke failed, using tool: ${String(err)})`);
      const review = await reviewPaperCitations({ ...staleCitingPaper, topic: TOPIC });
      printBriefMarkdown(review.markdown);
    }
  } else {
    const review = await reviewPaperCitations({ ...staleCitingPaper, topic: TOPIC });
    console.log('   🛠️  tool: review_paper_citations');
    printBriefMarkdown(review.markdown);
  }
  await pause();

  // 6. The recursion --------------------------------------------------------
  h(6, 'The recursion — the harness rewrites its own memory policy');
  const before = await repo.getPolicy();
  console.log(`   policy before: write_threshold=${before.write_threshold}, recency_weight=${before.recency_weight}`);
  const evo = await evolvePolicy(repo);
  console.log(`   ${evo.changed ? '🧬 evolved' : '• no change'}: ${evo.reasonSummary}`);
  console.log(`   policy after:  write_threshold=${evo.policy.write_threshold}, recency_weight=${evo.policy.recency_weight}`);

  await healthPanel(repo);
  console.log('\n✅ Demo complete. The harness updated its knowledge AND its own policy from');
  console.log('   its own logged, type-safe decisions — computed in MongoDB. Recursive harnessing.\n');

  await repo.close();
};

await main();

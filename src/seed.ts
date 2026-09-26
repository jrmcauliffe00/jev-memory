/**
 * Seed / reset. Clean slate, then:
 *   - curated OLD guidance → `memories` (active, pre-gate — what the agent already "knows")
 *   - curated NEW studies → `studies` (`ingested:false` — the inbox / money-shot feed)
 *   - ~200 PubMedQA abstracts → `memories` (background neighbors for Vector Search)
 *
 *   npm run seed           — reset + seed (closes the client)
 *   npm run seed -- --no-pubmed  — skip the Hugging Face corpus
 */
import { getRepo, clearRepoCache, type MemoryRepo } from './repo.js';
import { embedMany } from './embed.js';
import { describeMode, useLiveEmbeddings } from './config.js';
import { baselineMemories, newStudies } from './data/studies.js';
import { fetchPubmedqa } from './ingest/fetch.js';
import { landStudies } from './ingest/land.js';

export interface SeedOptions {
  /** Close the repo when done. CLI default true; the demo passes false so it can keep using the client. */
  close?: boolean;
  pubmed?: boolean;
  pubmedLimit?: number;
}

export const seed = async (opts: SeedOptions = {}): Promise<MemoryRepo> => {
  const repo = await getRepo();
  await repo.reset();

  const pubmed = opts.pubmed !== false;
  let pubmedStudies: Awaited<ReturnType<typeof fetchPubmedqa>> = [];
  if (pubmed) {
    try {
      pubmedStudies = await fetchPubmedqa(opts.pubmedLimit);
    } catch (err) {
      console.warn(`   pubmedqa skipped (${String(err)}). Curated pairs still seeded.`);
    }
  }

  const memoryTexts = [
    ...baselineMemories.map((m) => m.text),
    ...pubmedStudies.map((s) => s.conclusion),
  ];
  if (!useLiveEmbeddings()) {
    console.log('   embeddings=local (set OPENAI_API_KEY for semantic Vector Search)');
  }
  const vectors = await embedMany(memoryTexts);

  let i = 0;
  for (const m of baselineMemories) {
    await repo.insertMemory({
      topic: m.topic,
      text: m.text,
      embedding: vectors[i++]!,
      evidence_level: m.evidence_level,
      year: m.year,
      source_study_id: null,
      source_trace_id: null,
    });
  }
  for (const s of pubmedStudies) {
    await repo.insertMemory({
      topic: s.topic,
      text: s.conclusion,
      embedding: vectors[i++]!,
      evidence_level: s.evidence_level,
      year: s.year,
      source_study_id: null,
      source_trace_id: null,
    });
  }

  await landStudies(repo, newStudies);

  const memCount = (await repo.listMemories()).length;
  const studyCount = (await repo.listStudies()).length;
  console.log(`✅ Seeded [${describeMode()}]`);
  console.log(`   memories: ${baselineMemories.length} curated baseline + ${pubmedStudies.length} PubMedQA`);
  console.log(`   studies:  ${studyCount} pending in the inbox (ingested:false)`);
  console.log(`   total memories written: ${memCount}`);
  console.log(`   policy:   reset to defaults`);

  if (opts.close !== false) {
    await repo.close();
    clearRepoCache();
  }
  return repo;
};

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const pubmed = !process.argv.includes('--no-pubmed');
  await seed({ close: true, pubmed });
}

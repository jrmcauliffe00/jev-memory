/**
 * Digestion worker. Drains `studies` where `ingested:false` through the existing Jev-gated
 * `JevMemoryStore.ingest()` path, then marks them ingested.
 *
 *   npm run ingest  — one-shot batch over the current inbox
 *   npm run watch   — Atlas Change Stream (`studies.watch()`); refuses in-memory mode
 */
import { getRepo, type MemoryRepo } from '../repo.js';
import { JevMemoryStore } from '../memoryStore.js';
import type { Study } from '../types.js';

export interface DigestResult {
  accepted: number;
  rejected: number;
  superseded: number;
}

const digestOne = async (
  store: JevMemoryStore,
  repo: MemoryRepo,
  study: Study,
): Promise<'accept' | 'reject'> => {
  const result = await store.ingest(study.conclusion, {
    topic: study.topic,
    evidence_level: study.evidence_level,
    year: study.year,
    source_study_id: study._id,
  });
  await repo.markStudyIngested(study._id);
  return result.decision;
};

/** Drain the current un-ingested inbox once. */
export const drainInbox = async (
  repo: MemoryRepo,
  store: JevMemoryStore = new JevMemoryStore(),
  opts: { excludeTopics?: string[] } = {},
): Promise<DigestResult> => {
  const pending = await repo.listStudies({ ingested: false });
  const skip = new Set(opts.excludeTopics ?? []);
  const todo = pending.filter((s) => !skip.has(s.topic));
  let accepted = 0;
  let rejected = 0;
  let superseded = 0;
  for (const study of todo) {
    const result = await store.ingest(study.conclusion, {
      topic: study.topic,
      evidence_level: study.evidence_level,
      year: study.year,
      source_study_id: study._id,
    });
    await repo.markStudyIngested(study._id);
    if (result.decision === 'accept') {
      accepted++;
      if (result.superseded) superseded++;
    } else {
      rejected++;
    }
    console.log(`   ${result.decision}  ${study.title.slice(0, 72)}`);
  }
  return { accepted, rejected, superseded };
};

/** Live Change Stream. Atlas only. */
export const watchInbox = async (
  repo: MemoryRepo,
  store: JevMemoryStore = new JevMemoryStore(),
): Promise<{ close(): Promise<void> }> => {
  if (repo.kind !== 'atlas' || !repo.watchStudies) {
    throw new Error('Change Streams require MongoDB Atlas (set MONGODB_URI). In-memory mode cannot watch.');
  }
  console.log('👁  watching studies for new research (Ctrl-C to stop)…');
  return repo.watchStudies(async (study) => {
    if (study.ingested) return;
    const decision = await digestOne(store, repo, study);
    console.log(`   ${decision}  ${study.title.slice(0, 72)}`);
  });
};

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const mode = process.argv.includes('--watch') ? 'watch' : 'batch';
  const repo = await getRepo();
  const store = new JevMemoryStore();
  if (mode === 'watch') {
    const handle = await watchInbox(repo, store);
    const stop = async () => {
      await handle.close();
      await repo.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
    await new Promise(() => {
      /* run until signal */
    });
  } else {
    const res = await drainInbox(repo, store);
    console.log(`✅ Digested inbox: ${res.accepted} accepted, ${res.rejected} rejected, ${res.superseded} superseded`);
    await repo.close();
  }
}

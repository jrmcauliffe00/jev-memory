/**
 * Landing — the dumb ETL sink. Insert normalized studies into `studies` with `ingested:false`.
 * No LLM. Digestion is `JevMemoryStore.ingest()`, driven by the worker or the demo.
 */
import type { MemoryRepo } from '../repo.js';
import type { Study } from '../types.js';

export const landStudies = async (
  repo: MemoryRepo,
  studies: Omit<Study, '_id'>[],
): Promise<Study[]> => {
  if (studies.length === 0) return [];
  return repo.insertStudies(studies.map((s) => ({ ...s, ingested: false })));
};

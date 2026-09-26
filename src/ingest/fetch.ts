/**
 * Deterministic source adapters. First adapter: PubMedQA (`qiaojin/PubMedQA`, `pqa_labeled`)
 * from Hugging Face. Downloads once, caches to `data/cache/pubmedqa.json`, never hits the
 * network on subsequent seeds.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvidenceLevel, Study } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBMEDQA_CACHE = join(ROOT, 'data', 'cache', 'pubmedqa.json');

const HF_ROWS =
  'https://datasets-server.huggingface.co/rows?dataset=qiaojin/PubMedQA&config=pqa_labeled&split=train';
const PAGE = 100;
export const PUBMEDQA_DEFAULT_LIMIT = 200;

interface HfRow {
  row: {
    question?: string;
    long_answer?: string;
    context?: { contexts?: string[]; meshes?: string[] };
  };
}

const slug = (q: string): string =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('_') || 'pubmedqa';

const evidenceOf = (text: string): EvidenceLevel =>
  /\brandomiz/i.test(text) ? 'RCT' : 'observational';

export const pubmedqaToStudy = (row: HfRow['row']): Omit<Study, '_id'> | null => {
  const title = row.question?.trim();
  const conclusion = row.long_answer?.trim();
  if (!title || !conclusion) return null;
  const abstract = (row.context?.contexts ?? []).join(' ').trim() || conclusion;
  return {
    title,
    abstract,
    topic: `pubmedqa_${slug(title)}`,
    year: 2018,
    evidence_level: evidenceOf(`${abstract} ${conclusion}`),
    conclusion,
    ingested: false,
  };
};

const fetchPage = async (offset: number, length: number): Promise<HfRow['row'][]> => {
  const url = `${HF_ROWS}&offset=${offset}&length=${length}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Hugging Face HTTP ${res.status} at offset ${offset}`);
  const json = (await res.json()) as { rows?: HfRow[] };
  return (json.rows ?? []).map((r) => r.row);
};

export const fetchPubmedqa = async (
  limit = PUBMEDQA_DEFAULT_LIMIT,
): Promise<Omit<Study, '_id'>[]> => {
  try {
    const cached = JSON.parse(await readFile(PUBMEDQA_CACHE, 'utf8')) as Omit<Study, '_id'>[];
    if (Array.isArray(cached) && cached.length > 0) {
      console.log(`   pubmedqa: ${Math.min(limit, cached.length)} from cache`);
      return cached.slice(0, limit);
    }
  } catch {
    // cache miss
  }

  const rows: HfRow['row'][] = [];
  while (rows.length < limit) {
    const page = await fetchPage(rows.length, Math.min(PAGE, limit - rows.length));
    if (page.length === 0) break;
    rows.push(...page);
  }

  const studies = rows
    .map(pubmedqaToStudy)
    .filter((s): s is Omit<Study, '_id'> => s !== null)
    .slice(0, limit);

  await mkdir(dirname(PUBMEDQA_CACHE), { recursive: true });
  await writeFile(PUBMEDQA_CACHE, JSON.stringify(studies, null, 2));
  console.log(`   pubmedqa: fetched ${studies.length} from Hugging Face (cached)`);
  return studies;
};

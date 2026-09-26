/**
 * Citation reviewer — second agent job.
 *
 * Takes a paper's cited claims and asks Mongo: does any cite contradict the
 * current record, or restate a finding we already retired? Uses filed evidence
 * reviews plus active/superseded memories. Not medical advice.
 */
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { classifyDetailed } from '../jev.js';
import { logJevVerdict } from '../traceHook.js';
import { embed } from '../embed.js';
import { getRepo } from '../repo.js';
import { evidenceRank, type Brief, type Memory } from '../types.js';

const YES_NO = [
  { label: 'A', key: 'yes', description: 'Yes.' },
  { label: 'B', key: 'no', description: 'No.' },
] as const;

export type CitationVerdict = 'contradicts_current' | 'restates_retired' | 'consistent';

export interface CitationHit {
  citation: string;
  verdict: CitationVerdict;
  against: string;
}

export interface CitationReview {
  paper_title: string;
  markdown: string;
  hits: CitationHit[];
  contradiction_count: number;
  brief: Brief;
}

const leadFinding = (active: Memory[]): Memory | undefined =>
  [...active].sort((a, b) => {
    const ev = evidenceRank(b.evidence_level) - evidenceRank(a.evidence_level);
    return ev !== 0 ? ev : b.year - a.year;
  })[0];

const unique = (items: string[]): string[] =>
  [...new Set(items.map((s) => s.trim()).filter(Boolean))];

export const reviewPaperCitations = async (input: {
  title: string;
  abstract: string;
  citations: string[];
  topic?: string;
}): Promise<CitationReview> => {
  const repo = await getRepo();
  const citations = unique(input.citations);
  const query = [input.title, input.abstract, ...citations].join('\n');
  let hits: Awaited<ReturnType<typeof repo.recall>> = [];
  try {
    hits = await repo.recall(await embed(query), { limit: 8, topic: input.topic });
  } catch {
    hits = [];
  }

  const topics = new Set<string>();
  if (input.topic) topics.add(input.topic);
  for (const h of hits) topics.add(h.memory.topic);

  const active: Memory[] = [];
  const superseded: Memory[] = [];
  for (const topic of topics) {
    active.push(...(await repo.listMemories({ topic, status: 'active' })));
    superseded.push(...(await repo.listMemories({ topic, status: 'superseded' })));
  }
  const memos = (
    await Promise.all(
      [...topics].map((topic) =>
        repo.listBriefs({ kind: 'evidence_review', topic, status: 'active' }),
      ),
    )
  ).flat();

  const retiredTexts = unique(superseded.map((m) => m.text));
  const currentLead =
    memos[memos.length - 1]?.finding ??
    leadFinding(active)?.text ??
    active[0]?.text ??
    '';

  const results: CitationHit[] = [];
  for (const citation of citations) {
    let verdict: CitationVerdict = 'consistent';
    let against = currentLead || 'no current finding on file';

    if (currentLead) {
      const contra = await classifyDetailed(
        { new_finding: citation, existing_finding: currentLead },
        'Does this citation contradict the current active finding in the record?',
        YES_NO,
        { defaultKey: 'no' },
      );
      await logJevVerdict(repo, {
        step: 'citation_check',
        input_ref: `cite:${citation.slice(0, 80)}`,
        jev_question: 'Does this citation contradict the current active finding?',
        jev_options: ['yes', 'no'],
        jev_output: contra.key,
        decision: contra.key === 'yes' ? 'contradiction' : 'consistent',
        latency_ms: contra.latencyMs,
      });
      if (contra.key === 'yes') {
        verdict = 'contradicts_current';
        against = currentLead;
      }
    }

    if (verdict === 'consistent') {
      for (const retired of retiredTexts) {
        const restates = await classifyDetailed(
          { citation, retired_finding: retired },
          'Does this citation restate a retired finding?',
          YES_NO,
          { defaultKey: 'no' },
        );
        await logJevVerdict(repo, {
          step: 'citation_check',
          input_ref: `stale:${citation.slice(0, 80)}`,
          jev_question: 'Does this citation restate a retired finding?',
          jev_options: ['yes', 'no'],
          jev_output: restates.key,
          decision: restates.key === 'yes' ? 'restates_retired' : 'consistent',
          latency_ms: restates.latencyMs,
        });
        if (restates.key === 'yes') {
          verdict = 'restates_retired';
          against = retired;
          break;
        }
      }
    }

    results.push({ citation, verdict, against });
  }

  const contradiction_count = results.filter((r) => r.verdict !== 'consistent').length;
  const topic = input.topic ?? hits[0]?.memory.topic ?? [...topics][0] ?? null;
  const lines = results.map((r) => {
    const flag =
      r.verdict === 'contradicts_current'
        ? 'CONTRADICTS current record'
        : r.verdict === 'restates_retired'
          ? 'RESTATES a retired finding'
          : 'consistent with current record';
    return `- **${flag}:** ${r.citation}\n  — against: ${r.against}`;
  });

  const markdown = [
    `# Citation review — ${input.title}`,
    `Issued: ${new Date().toISOString()}`,
    '',
    '## Paper',
    input.abstract,
    '',
    '## Current record (from Mongo memos + active findings)',
    currentLead || 'No active finding on file.',
    '',
    '## Citation checks',
    ...(lines.length ? lines : ['- No citations supplied.']),
    '',
    `Flagged: **${contradiction_count}** of ${results.length} citations.`,
    '',
    '_Citation / evidence review. Not medical advice. Not a treatment recommendation._',
  ].join('\n');

  const brief = await repo.insertBrief({
    kind: 'citation_review',
    topic,
    title: `Citation review — ${input.title}`,
    markdown,
    finding: currentLead || null,
    paper_title: input.title,
    contradiction_count,
  });

  return { paper_title: input.title, markdown, hits: results, contradiction_count, brief };
};

export const createReviewPaperCitationsTool = () =>
  tool({
    name: 'review_paper_citations',
    description:
      "Review a paper's cited claims against the Mongo evidence record (filed memos + active/superseded findings). Flags cites that contradict the current finding or restate a retired one. Not medical advice.",
    inputSchema: z.object({
      title: z.string().describe('Paper title'),
      abstract: z.string().describe('Paper abstract or summary'),
      citations: z
        .array(z.string())
        .describe('Cited claims — the statements the paper treats as current'),
      topic: z.string().optional().describe('Optional topic slug to scope the record'),
    }),
    callback: async ({ title, abstract, citations, topic }) => {
      const review = await reviewPaperCitations({ title, abstract, citations, topic });
      return review.markdown;
    },
  });

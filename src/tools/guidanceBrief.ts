/**
 * The agent's job: file an evidence review for a topic — what the record currently
 * supports, and what prior finding was contradicted. Not medical advice.
 *
 * The tool reads Atlas memory (active + superseded), files a short memo, then Jev
 * checks the artifact — Jev never writes the prose. Same tool call, twice in the demo:
 * before LEAP the review cites the old finding; after digestion it cites the new RCT
 * and names what was retired.
 */
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { classifyDetailed } from '../jev.js';
import { logJevVerdict } from '../traceHook.js';
import { JevMemoryStore } from '../memoryStore.js';
import { getRepo } from '../repo.js';
import { evidenceRank, type Memory } from '../types.js';

const YES_NO = [
  { label: 'A', key: 'yes', description: 'Yes.' },
  { label: 'B', key: 'no', description: 'No.' },
] as const;

const CHANGE = [
  { label: 'A', key: 'yes', description: 'Yes — the review correctly names the superseded prior finding.' },
  { label: 'B', key: 'no', description: 'No — a contradiction happened but the review hides it.' },
  { label: 'C', key: 'no_change', description: 'No prior finding was superseded; nothing to acknowledge.' },
] as const;

const QUALITY = [
  { label: 'A', key: 'bad', description: 'Ungrounded, or treats a superseded finding as current.' },
  { label: 'B', key: 'weak', description: 'Partially grounded or missing the contradiction note.' },
  { label: 'C', key: 'good', description: 'Grounded in active evidence and honest about what was contradicted.' },
] as const;

const QUALITY_REWARD: Record<string, number> = { good: 1, weak: 0.5, bad: 0 };

export interface BriefChecks {
  grounded: 'yes' | 'no';
  change: 'yes' | 'no' | 'no_change';
  quality: 'good' | 'weak' | 'bad';
  reward_value: number;
  jevStub: boolean;
}

export interface GuidanceBrief {
  topic: string;
  issued_at: string;
  markdown: string;
  finding: string;
  active: Memory[];
  superseded: Memory[];
  checks: BriefChecks;
}

const pickLead = (active: Memory[]): Memory | undefined =>
  [...active].sort((a, b) => {
    const ev = evidenceRank(b.evidence_level) - evidenceRank(a.evidence_level);
    return ev !== 0 ? ev : b.year - a.year;
  })[0];

const renderBrief = (topic: string, active: Memory[], superseded: Memory[]): {
  markdown: string;
  finding: string;
} => {
  const issued = new Date().toISOString();
  const lead = pickLead(active);
  const disclaimer =
    '_Evidence review of stored findings. Not medical advice. Not a treatment recommendation._';
  if (!lead) {
    const markdown = [
      `# Evidence review — ${topic}`,
      `Issued: ${issued}`,
      '',
      '## Current finding',
      'Insufficient evidence in active memory. Do not invent a finding.',
      '',
      '## What was contradicted',
      superseded.length
        ? superseded.map((m) => `- Retired (${m.year}, ${m.evidence_level}): ${m.text}`).join('\n')
        : 'No prior finding on file.',
      '',
      disclaimer,
    ].join('\n');
    return { markdown, finding: 'Insufficient evidence.' };
  }

  const change = superseded.length
    ? superseded
        .map(
          (m) =>
            `- Previously (${m.year}, ${m.evidence_level}): ${m.text} — **contradicted / superseded**.`,
        )
        .join('\n')
    : 'No prior finding was contradicted. This is the first active finding on this topic.';

  const markdown = [
    `# Evidence review — ${topic}`,
    `Issued: ${issued}`,
    '',
    '## Current finding',
    `${lead.text} _(evidence: ${lead.evidence_level}, ${lead.year})_`,
    '',
    '## What was contradicted',
    change,
    '',
    '## Citations (active only)',
    ...active.map((m) => `- [${m.evidence_level}/${m.year}] ${m.text}`),
    '',
    disclaimer,
  ].join('\n');

  return { markdown, finding: lead.text };
};

const judgeBrief = async (
  topic: string,
  markdown: string,
  active: Memory[],
  superseded: Memory[],
): Promise<BriefChecks> => {
  const repo = await getRepo();
  const lead = pickLead(active);
  const evidence = lead?.text ?? '';

  const grounded = await classifyDetailed(
    { brief: markdown, active_finding: evidence },
    'Is this brief grounded only in the active findings?',
    YES_NO,
    { defaultKey: 'no' },
  );
  await logJevVerdict(repo, {
    step: 'brief_check',
    input_ref: `brief:${topic}:grounded`,
    jev_question: 'Is this brief grounded only in the active findings?',
    jev_options: ['yes', 'no'],
    jev_output: grounded.key,
    decision: grounded.key === 'yes' ? 'grounded' : 'ungrounded',
    latency_ms: grounded.latencyMs,
  });

  const change = await classifyDetailed(
    { brief: markdown, superseded_count: superseded.length },
    'Does this review correctly acknowledge a superseded prior finding?',
    CHANGE,
    { defaultKey: superseded.length ? 'no' : 'no_change' },
  );
  await logJevVerdict(repo, {
    step: 'brief_check',
    input_ref: `brief:${topic}:change`,
    jev_question: 'Does this review correctly acknowledge a superseded prior finding?',
    jev_options: ['yes', 'no', 'no_change'],
    jev_output: change.key,
    decision: change.key,
    latency_ms: change.latencyMs,
  });

  const quality = await classifyDetailed(
    { brief: markdown, evidence, change: change.key, grounded: grounded.key },
    'Is this a good, complete, evidence-grounded review of what the record supports and what was contradicted?',
    QUALITY,
  );
  const reward_value = QUALITY_REWARD[quality.key] ?? 0;
  await logJevVerdict(repo, {
    step: 'reward_judge',
    input_ref: `brief:${topic}`,
    jev_question: 'Is this evidence review good and honest about contradictions?',
    jev_options: ['good', 'weak', 'bad'],
    jev_output: quality.key,
    decision: quality.key,
    reward_value,
    latency_ms: quality.latencyMs,
  });

  return {
    grounded: grounded.key,
    change: change.key,
    quality: quality.key,
    reward_value,
    jevStub: grounded.stub || change.stub || quality.stub,
  };
};

/** File the living brief for a topic. Used by the Strands tool and by the canned demo. */
export const issueGuidanceBrief = async (
  topic: string,
  _store: JevMemoryStore = new JevMemoryStore(),
): Promise<GuidanceBrief> => {
  const repo = await getRepo();
  const active = await repo.listMemories({ topic, status: 'active' });
  const superseded = await repo.listMemories({ topic, status: 'superseded' });
  const { markdown, finding } = renderBrief(topic, active, superseded);
  const checks = await judgeBrief(topic, markdown, active, superseded);
  const checked = [
    markdown,
    '',
    '## Jev review',
    `- grounded in active memory: **${checks.grounded}**`,
    `- contradiction acknowledged: **${checks.change}**`,
    `- quality: **${checks.quality}** (reward ${checks.reward_value})`,
  ].join('\n');

  const prior = await repo.listBriefs({
    kind: 'evidence_review',
    topic,
    status: 'active',
  });
  const filed = await repo.insertBrief({
    kind: 'evidence_review',
    topic,
    title: `Evidence review — ${topic}`,
    markdown: checked,
    finding,
    paper_title: null,
    contradiction_count: superseded.length,
  });
  for (const old of prior) await repo.supersedeBrief(old._id, filed._id);

  return {
    topic,
    issued_at: filed.issued_at.toISOString(),
    markdown: checked,
    finding,
    active,
    superseded,
    checks,
  };
};

export const createWriteGuidanceBriefTool = (store: JevMemoryStore) =>
  tool({
    name: 'write_evidence_review',
    description:
      'File the current evidence review for a research topic: the active finding, any contradicted prior finding, and citations. Not medical advice. Use this instead of inventing a review.',
    inputSchema: z.object({
      topic: z
        .string()
        .describe('Topic slug, e.g. infant_peanut_introduction'),
    }),
    callback: async ({ topic }) => {
      const brief = await issueGuidanceBrief(topic, store);
      return brief.markdown;
    },
  });

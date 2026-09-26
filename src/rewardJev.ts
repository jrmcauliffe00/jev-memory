/**
 * `rewardJev` — a lightweight RewardFunction (the mental model borrowed from the Strands Harness
 * Optimizer). Jev acts as the judge: it scores an agent answer against the recalled evidence and the
 * verdict is logged to `traces` (step `reward_judge`) so `evolvePolicy()` can factor answer quality
 * into policy evolution.
 *
 * Jev is the RewardFunction/judge here — NOT the optimizer (which would rewrite prose). It only
 * classifies: is this answer well-grounded in the cited evidence?
 */
import { classifyDetailed } from './jev.js';
import { logJevVerdict } from './traceHook.js';
import type { MemoryRepo } from './repo.js';

// Jev requires consecutive A..X labels; options are ordered weakest -> strongest (matches the
// delivered jev.ts reward convention, so the offline stub grades correctly).
const QUALITY = [
  { label: 'A', key: 'bad', description: 'Ungrounded, evasive, or contradicts the evidence.' },
  { label: 'B', key: 'weak', description: 'Partially grounded or hedged.' },
  { label: 'C', key: 'good', description: 'Answer is correct and grounded in the cited evidence.' },
] as const;

const REWARD: Record<string, number> = { good: 1, weak: 0.5, bad: 0 };

export interface RewardResult {
  label: 'good' | 'weak' | 'bad';
  reward_value: number;
  jevStub: boolean;
}

/**
 * Judge an answer's quality given the evidence it was supposed to use, returning a numeric reward
 * in [0,1] and logging a `reward_judge` trace.
 */
export const judgeReward = async (
  repo: MemoryRepo,
  args: { question: string; answer: string; evidence: string },
): Promise<RewardResult> => {
  const verdict = await classifyDetailed(
    { answer: args.answer, evidence: args.evidence },
    `Is this a good, evidence-grounded answer to: "${args.question}"?`,
    QUALITY,
  );
  const reward_value = REWARD[verdict.key] ?? 0;
  await logJevVerdict(repo, {
    step: 'reward_judge',
    input_ref: args.question.slice(0, 120),
    jev_question: 'Is this answer good and evidence-grounded?',
    jev_options: ['good', 'weak', 'bad'],
    jev_output: verdict.key,
    decision: verdict.key,
    reward_value,
    latency_ms: verdict.latencyMs,
  });
  return { label: verdict.key, reward_value, jevStub: verdict.stub };
};

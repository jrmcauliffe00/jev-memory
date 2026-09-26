/**
 * `evolvePolicy()` — the recursion. Aggregate the closed-schema `traces` log and rewrite the memory
 * policy (`harness_config`) accordingly, appending an `evolution_log` entry. This is the harness
 * improving *itself* from its own logged, type-safe decisions — computed in MongoDB.
 *
 * Rules (deliberately simple + legible for the demo):
 *   - If the write-gate accept rate is high (agent hoards), RAISE `write_threshold` (be pickier).
 *   - If it is low (agent is too shy), LOWER `write_threshold`.
 *   - If contradictions are frequent, RAISE `recency_weight` (favor newer/stronger evidence sooner).
 *   - If average answer reward is low, LOWER `write_threshold` (recall more context).
 */
import { getRepo, type MemoryRepo } from './repo.js';
import type { EvolutionLogEntry, Policy } from './types.js';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface EvolveResult {
  changed: boolean;
  policy: Policy;
  entries: EvolutionLogEntry[];
  reasonSummary: string;
}

const HIGH_ACCEPT = 0.8;
const LOW_ACCEPT = 0.4;
const HIGH_CONTRADICTION = 0.5;
const LOW_REWARD = 0.5;

export const evolvePolicy = async (repoArg?: MemoryRepo): Promise<EvolveResult> => {
  const repo = repoArg ?? (await getRepo());
  const agg = await repo.aggregateTraces();
  const policy = await repo.getPolicy();
  const now = new Date();
  const entries: EvolutionLogEntry[] = [];

  const propose = (field: 'write_threshold' | 'recency_weight', to: number, reason: string) => {
    const from = policy[field];
    const next = round2(clamp(to, 0.05, 0.95));
    if (next !== from) {
      entries.push({ at: now, field, from, to: next, reason });
      policy[field] = next;
    }
  };

  // Only evolve once we have a meaningful sample of gate decisions.
  if (agg.gateCount >= 2) {
    if (agg.acceptRate > HIGH_ACCEPT) {
      propose(
        'write_threshold',
        policy.write_threshold + 0.15,
        `accept_rate=${round2(agg.acceptRate)}>${HIGH_ACCEPT}: be more selective`,
      );
    } else if (agg.acceptRate < LOW_ACCEPT) {
      propose(
        'write_threshold',
        policy.write_threshold - 0.1,
        `accept_rate=${round2(agg.acceptRate)}<${LOW_ACCEPT}: capture more`,
      );
    }
  }

  if (agg.contradictionChecks >= 1 && agg.contradictionRate >= HIGH_CONTRADICTION) {
    propose(
      'recency_weight',
      policy.recency_weight + 0.1,
      `contradiction_rate=${round2(agg.contradictionRate)}>=${HIGH_CONTRADICTION}: favor newer evidence`,
    );
  }

  if (agg.avgReward !== null && agg.avgReward < LOW_REWARD) {
    propose(
      'write_threshold',
      policy.write_threshold - 0.1,
      `avg_reward=${round2(agg.avgReward)}<${LOW_REWARD}: recall more context`,
    );
  }

  const changed = entries.length > 0;
  if (changed) {
    policy.last_evolved_at = now;
    policy.evolution_log = [...policy.evolution_log, ...entries];
    await repo.savePolicy(policy);
  }

  const reasonSummary = changed
    ? entries.map((e) => `${e.field}: ${e.from}→${e.to} (${e.reason})`).join('; ')
    : `No change (accept_rate=${round2(agg.acceptRate)}, contradiction_rate=${round2(agg.contradictionRate)}, avg_reward=${agg.avgReward === null ? 'n/a' : round2(agg.avgReward)}).`;

  return { changed, policy, entries, reasonSummary };
};

// Allow `npm run evolve` to run this standalone.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const repo = await getRepo();
  const res = await evolvePolicy(repo);
  console.log(res.changed ? '🧬 Policy evolved:' : 'No policy change:');
  console.log('  ' + res.reasonSummary);
  console.log('  Current policy:', {
    write_threshold: res.policy.write_threshold,
    recency_weight: res.policy.recency_weight,
  });
  await repo.close();
}

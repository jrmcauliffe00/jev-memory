/**
 * Curated evidence-reversal pairs for the demo (PLAN §3 / §6.1).
 *
 * Each pair = an OLD `baselineMemory` (seeded directly as `active`) + a NEW `study` whose
 * conclusion overturns it. Peanut / LEAP is the flagship money shot; the others sit in Atlas so
 * Vector Search and the studies inbox look like a real corpus, not a single-doc toy.
 */
import type { EvidenceLevel, Study } from '../types.js';

export const TOPIC = 'infant_peanut_introduction';

export interface BaselineMemory {
  topic: string;
  text: string;
  evidence_level: EvidenceLevel;
  year: number;
}

export interface ReversalPair {
  topic: string;
  baseline: BaselineMemory;
  study: Omit<Study, '_id'>;
}

export const reversalPairs: ReversalPair[] = [
  {
    topic: TOPIC,
    baseline: {
      topic: TOPIC,
      text: 'Guidance: avoid introducing peanut-containing foods to infants; early exposure may increase the risk of developing a peanut allergy.',
      evidence_level: 'observational',
      year: 2008,
    },
    study: {
      title: 'Learning Early About Peanut Allergy (LEAP) — randomized controlled trial',
      abstract:
        'In a randomized controlled trial of infants at high risk for peanut allergy, early and sustained introduction of dietary peanut significantly reduced the incidence of peanut allergy compared with avoidance.',
      topic: TOPIC,
      year: 2026,
      evidence_level: 'RCT',
      conclusion:
        'Early introduction of peanut in infancy reduces the risk of developing peanut allergy.',
      ingested: false,
    },
  },
  {
    topic: 'postmenopausal_hrt',
    baseline: {
      topic: 'postmenopausal_hrt',
      text: 'Guidance: hormone replacement therapy is recommended to protect postmenopausal women against heart disease.',
      evidence_level: 'observational',
      year: 1995,
    },
    study: {
      title: 'Women\'s Health Initiative — combined hormone therapy and coronary heart disease',
      abstract:
        'A large randomized trial of combined estrogen plus progestin in postmenopausal women found no coronary protection and an increase in coronary events versus placebo.',
      topic: 'postmenopausal_hrt',
      year: 2002,
      evidence_level: 'RCT',
      conclusion:
        'Combined hormone replacement therapy increases the risk of coronary events and does not prevent heart disease.',
      ingested: false,
    },
  },
  {
    topic: 'vitamin_e_supplementation',
    baseline: {
      topic: 'vitamin_e_supplementation',
      text: 'Guidance: vitamin E supplements prevent heart disease and are recommended for cardiovascular protection.',
      evidence_level: 'observational',
      year: 1996,
    },
    study: {
      title: 'HOPE-TOO — long-term vitamin E supplementation and cardiovascular outcomes',
      abstract:
        'A randomized trial of long-term vitamin E found no reduction in cardiovascular events and a signal of increased heart failure.',
      topic: 'vitamin_e_supplementation',
      year: 2005,
      evidence_level: 'RCT',
      conclusion:
        'Vitamin E supplementation has no benefit for preventing heart disease and may increase the risk of heart failure.',
      ingested: false,
    },
  },
  {
    topic: 'intensive_glucose_control',
    baseline: {
      topic: 'intensive_glucose_control',
      text: 'Guidance: intensive tight glucose control is recommended to protect patients with type 2 diabetes from cardiovascular events.',
      evidence_level: 'observational',
      year: 2003,
    },
    study: {
      title: 'ACCORD — intensive glucose lowering in type 2 diabetes',
      abstract:
        'A randomized trial of intensive glycemic control in high-risk type 2 diabetes was stopped early after an increase in mortality versus standard targets.',
      topic: 'intensive_glucose_control',
      year: 2008,
      evidence_level: 'RCT',
      conclusion:
        'Intensive glucose lowering increases mortality in high-risk type 2 diabetes and has no benefit over standard targets.',
      ingested: false,
    },
  },
  {
    topic: 'routine_bed_rest',
    baseline: {
      topic: 'routine_bed_rest',
      text: 'Guidance: routine bed rest is recommended to protect recovery from low back pain and threatened miscarriage.',
      evidence_level: 'observational',
      year: 1990,
    },
    study: {
      title: 'Routine bed rest for low back pain and threatened miscarriage — evidence review',
      abstract:
        'Randomized and observational evidence found that prescribing routine bed rest does not improve outcomes and increases deconditioning and thromboembolic risk.',
      topic: 'routine_bed_rest',
      year: 2016,
      evidence_level: 'meta-analysis',
      conclusion:
        'Routine bed rest has no benefit for low back pain or threatened miscarriage and may increase the risk of harm from deconditioning.',
      ingested: false,
    },
  },
];

export const baselineMemories: BaselineMemory[] = reversalPairs.map((p) => p.baseline);
export const newStudies: Omit<Study, '_id'>[] = reversalPairs.map((p) => p.study);
export const flagshipStudy: Omit<Study, '_id'> = reversalPairs[0]!.study;

/** A non-evidence note used to demonstrate the write gate rejecting junk. */
export const junkNote =
  'Reminder to self: grab coffee before the standup, and the wifi password is on the whiteboard. Thanks!';

/**
 * A manuscript that still treats 2008 avoidance as current. The citation-reviewer
 * should flag that cite against the post-LEAP record — not give feeding advice.
 */
export const staleCitingPaper = {
  title: 'Infant feeding in 2026 — a narrative review',
  abstract:
    'We summarize infant feeding practice and continue to treat delayed peanut introduction as current, based on 2008 observational guidance.',
  citations: [
    'AAP 2008 observational guidance: avoid introducing peanut-containing foods to infants; early exposure may increase the risk of developing a peanut allergy.',
    'Unrelated background: vitamin D supplementation in winter is common in northern latitudes.',
  ],
};

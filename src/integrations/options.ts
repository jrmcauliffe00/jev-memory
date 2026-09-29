import type { Option } from '../jev.js';

const WIRE_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');

/** App-facing option: key + description. Labels A–X are assigned in order. */
export interface DecisionOption {
  key: string;
  description: string;
}

/** Turn unordered decision options into the Jev wire contract (labels A–X). */
export function toWireOptions(options: readonly DecisionOption[]): Option[] {
  if (options.length < 2 || options.length > 24) {
    throw new Error('Jev requires 2–24 options');
  }
  return options.map((o, i) => ({
    label: WIRE_LABELS[i]!,
    key: o.key,
    description: o.description,
  }));
}

export const YES_NO: readonly DecisionOption[] = [
  { key: 'yes', description: 'Yes.' },
  { key: 'no', description: 'No.' },
];

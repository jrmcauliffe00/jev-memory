/**
 * Catalog of Jev ↔ Strands harness integrations.
 *
 * These plug into harness seams Strands already exposes (tools, memory stores,
 * later interventions / extractors). We do not fork or patch Strands.
 *
 * Status
 * ------
 * shipped  — import and compose today
 * next     — planned seam, same classify contract underneath
 */

export type IntegrationStatus = 'shipped' | 'next';

export interface CatalogEntry {
  id: string;
  status: IntegrationStatus;
  /** Harness seam this plugs into. */
  seam: 'tools' | 'memory.stores' | 'interventions' | 'memory.extraction' | 'memory.injection';
  summary: string;
  /** Import path hint for consumers. */
  exportName: string;
}

export const INTEGRATION_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'classify-tool',
    status: 'shipped',
    seam: 'tools',
    summary:
      'Generic agent-callable closed-set classifier (question + options at call time).',
    exportName: 'createJevClassifyTool',
  },
  {
    id: 'decision-tool',
    status: 'shipped',
    seam: 'tools',
    summary:
      'Fixed question/options tool — agent only supplies state. Easiest first wire-up.',
    exportName: 'createJevDecisionTool',
  },
  {
    id: 'gated-tool',
    status: 'shipped',
    seam: 'tools',
    summary:
      'Classify then run a side effect only if acceptKeys + minConfidence both pass.',
    exportName: 'createJevGatedTool / callIfConfident',
  },
  {
    id: 'memory-store',
    status: 'shipped',
    seam: 'memory.stores',
    summary:
      'Jev-gated memory writes (persist? contradict?) behind MemoryStore add/search.',
    exportName: 'JevMemoryStore',
  },
  {
    id: 'intervention-gate',
    status: 'next',
    seam: 'interventions',
    summary:
      'Replace harness `"smart"` / NL risk prose with Jev allow|ask|deny on tool calls.',
    exportName: 'createJevIntervention (planned)',
  },
  {
    id: 'extraction-gate',
    status: 'next',
    seam: 'memory.extraction',
    summary:
      'Gate ModelExtractor outputs: is this turn a durable fact worth storing?',
    exportName: 'createJevExtractionGate (planned)',
  },
  {
    id: 'injection-filter',
    status: 'next',
    seam: 'memory.injection',
    summary:
      'Grade recall hits before injection: inject | skip.',
    exportName: 'createJevInjectionFilter (planned)',
  },
] as const;

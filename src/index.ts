export { JevMemoryStore } from './memoryStore.js';
export { getRepo, clearRepoCache } from './repo.js';
export { classify, classifyDetailed, gateMemory, checkContradiction, JEV_SYSTEM } from './jev.js';
export type { Option, ClassifyResult } from './jev.js';
export { confidenceFromLogprobs } from './confidence.js';
export { callIfConfident } from './callIfConfident.js';
export type {
  CallIfConfidentArgs,
  ConfidentCallResult,
  ConfidentProceed,
  ConfidentSkip,
  RejectReason,
} from './callIfConfident.js';
export type { IngestMeta, IngestResult, SearchHit } from './memoryStore.js';
export type { Memory, Policy, Trace, EvidenceLevel } from './types.js';

/** Classifier ↔ harness integrations (tools today; interventions next). */
export {
  createJevClassifyTool,
  createJevDecisionTool,
  createJevGatedTool,
  toWireOptions,
  YES_NO,
  INTEGRATION_CATALOG,
} from './integrations/index.js';
export type {
  JevToolConfig,
  JsonSchema,
  DecisionOption,
  ClassifyToolInput,
  ClassifyToolResult,
  DecisionToolInput,
  DecisionToolResult,
  DecisionToolSpec,
  GatedToolInput,
  GatedToolResult,
  GatedToolSpec,
  CatalogEntry,
  IntegrationStatus,
} from './integrations/index.js';

/**
 * Central runtime configuration + capability detection.
 *
 * Every external dependency (MongoDB Atlas, Together AI, OpenAI) is optional so the demo can run
 * end-to-end with zero cloud setup ("insurance" mode): a missing `MONGODB_URI` falls back to an
 * in-memory store, a missing `TOGETHER_API_KEY`/`JEV_MODEL` falls back to the deterministic Jev
 * stub, and a missing `OPENAI_API_KEY` falls back to a local pseudo-embedding. The architecture is
 * identical in every mode — only the backing implementation swaps.
 */
import 'dotenv/config';

const trimmed = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

const DEFAULT_JEV_BASE_URL = 'https://api.together.ai/v1';

/**
 * Together's hosted serverless model, used as the default Jev endpoint when neither
 * `TOGETHER_MODEL` nor `JEV_MODEL` is set (but an API key is present and we are not
 * pointed at a local OpenAI-compatible server).
 */
export const HOSTED_JEV_MODEL = 'together/Tev1-4B-experimental';

export const config = {
  mongoUri: trimmed(process.env.MONGODB_URI),
  mongoDb: trimmed(process.env.MONGODB_DB) ?? 'jev',

  togetherApiKey: trimmed(process.env.TOGETHER_API_KEY),
  // Local MLX / llama.cpp / Ollama speak OpenAI chat/completions. Point this at
  // http://127.0.0.1:8080/v1 to serve the fine-tune on-device and skip Together hosting.
  jevBaseUrl: (trimmed(process.env.JEV_BASE_URL) ?? DEFAULT_JEV_BASE_URL).replace(/\/$/, ''),
  // Real precedence confirmed against tev1/examples/decide.py: TOGETHER_MODEL is primary,
  // JEV_MODEL is the blog-compatible alias used only when TOGETHER_MODEL is empty; if both are
  // empty we default to the hosted serverless model so a bare API key still works.
  jevModel:
    trimmed(process.env.TOGETHER_MODEL) ??
    trimmed(process.env.JEV_MODEL) ??
    HOSTED_JEV_MODEL,

  openaiApiKey: trimmed(process.env.OPENAI_API_KEY),
  embedModel: trimmed(process.env.EMBED_MODEL) ?? 'text-embedding-3-small',
  harnessModel: trimmed(process.env.HARNESS_MODEL) ?? 'openai/gpt-5.6-sol',
} as const;

/** OpenAI `text-embedding-3-small` dimensionality — MUST match the Atlas vector index. */
export const EMBED_DIM = 1536;

/** Whether a real MongoDB Atlas cluster is configured. */
export const useMongo = (): boolean => Boolean(config.mongoUri);

/** True when Jev is served from a local OpenAI-compatible server (MLX on this machine). */
export const useLocalJev = (): boolean => {
  try {
    const host = new URL(config.jevBaseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
};

/**
 * Whether a live classifier (Together or local server) is used. A Together API key still
 * enables the hosted path; `JEV_BASE_URL` pointing at localhost enables the on-device path
 * even without a key.
 */
export const useLiveJev = (): boolean => Boolean(config.togetherApiKey) || useLocalJev();

/** Whether real OpenAI embeddings are configured. */
export const useLiveEmbeddings = (): boolean => Boolean(config.openaiApiKey);

const jevBackend = (): string => {
  if (useLocalJev()) return 'local';
  if (useLiveJev()) return 'together';
  return 'stub';
};

/** A one-line human summary of which backends are live vs. stubbed. */
export const describeMode = (): string => {
  const parts = [
    `mongo=${useMongo() ? 'atlas' : 'in-memory'}`,
    `jev=${jevBackend()}`,
    `embeddings=${useLiveEmbeddings() ? 'openai' : 'local'}`,
  ];
  return parts.join('  ');
};

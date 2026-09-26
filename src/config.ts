/**
 * Runtime config. Every cloud dependency is optional:
 *   - no MONGODB_URI        → in-memory store
 *   - no TOGETHER_API_KEY   → Jev stub (unless JEV_BASE_URL is localhost)
 *   - no OPENAI_API_KEY     → local pseudo-embeddings
 */
import 'dotenv/config';

const trimmed = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

const DEFAULT_JEV_BASE_URL = 'https://api.together.ai/v1';

/** Hosted serverless fallback when a Together key is set but no model id is. */
export const HOSTED_JEV_MODEL = 'together/Tev1-4B-experimental';

export const config = {
  mongoUri: trimmed(process.env.MONGODB_URI),
  mongoDb: trimmed(process.env.MONGODB_DB) ?? 'jev',

  togetherApiKey: trimmed(process.env.TOGETHER_API_KEY),
  jevBaseUrl: (trimmed(process.env.JEV_BASE_URL) ?? DEFAULT_JEV_BASE_URL).replace(/\/$/, ''),
  jevModel:
    trimmed(process.env.TOGETHER_MODEL) ??
    trimmed(process.env.JEV_MODEL) ??
    HOSTED_JEV_MODEL,

  openaiApiKey: trimmed(process.env.OPENAI_API_KEY),
  embedModel: trimmed(process.env.EMBED_MODEL) ?? 'text-embedding-3-small',
} as const;

/** OpenAI `text-embedding-3-small` dimensionality — must match the Atlas vector index. */
export const EMBED_DIM = 1536;

export const useMongo = (): boolean => Boolean(config.mongoUri);

export const useLocalJev = (): boolean => {
  try {
    const host = new URL(config.jevBaseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
};

export const useLiveJev = (): boolean => Boolean(config.togetherApiKey) || useLocalJev();

export const useLiveEmbeddings = (): boolean => Boolean(config.openaiApiKey);

/**
 * Embeddings — OpenAI `text-embedding-3-small` (1536-dim) with a local fallback.
 */
import OpenAI from 'openai';
import { config, EMBED_DIM, useLiveEmbeddings } from './config.js';

let client: OpenAI | null = null;
const openai = (): OpenAI => {
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
};

const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const localEmbed = (text: string): number[] => {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of tokenize(text)) {
    const h1 = fnv1a(tok);
    const h2 = fnv1a(`${tok}#`);
    const i1 = h1 % EMBED_DIM;
    const i2 = h2 % EMBED_DIM;
    vec[i1] = (vec[i1] ?? 0) + 1;
    vec[i2] = (vec[i2] ?? 0) + ((h2 & 1) === 0 ? 1 : -1);
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
};

const assertDim = (vec: number[] | undefined): number[] => {
  if (!vec || vec.length !== EMBED_DIM) {
    throw new Error(`Embedding returned ${vec?.length ?? 0} dims; expected ${EMBED_DIM}.`);
  }
  return vec;
};

export const embed = async (text: string): Promise<number[]> => {
  if (!useLiveEmbeddings()) return localEmbed(text);
  const res = await openai().embeddings.create({
    model: config.embedModel,
    input: text,
    dimensions: EMBED_DIM,
  });
  return assertDim(res.data[0]?.embedding);
};

/** Cosine similarity of two equal-length vectors. */
export const cosineSim = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
};

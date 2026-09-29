/**
 * Confidence from Jev logprobs.
 *
 * Live Together/OpenAI-style chat completions return token logprobs for the
 * single letter reply. We map that to a probability in [0, 1].
 *
 * Stub / missing logprobs: callers pass an explicit fallback (gated calls use 0
 * so we do not fire side effects without evidence; decision tools may surface 1
 * for the deterministic stub so demos still run).
 */

/** OpenAI / Together chat-completion logprobs content entry (partial). */
type LogprobToken = {
  token?: string;
  logprob?: number;
  top_logprobs?: { token?: string; logprob?: number }[];
};

type LogprobsPayload = {
  content?: LogprobToken[];
} | null;

/**
 * Probability of the chosen wire letter. Returns `null` when logprobs are
 * absent or unusable so callers can apply their own fallback.
 */
export function confidenceFromLogprobs(
  logprobs: unknown,
  chosenLabel: string,
): number | null {
  const payload = logprobs as LogprobsPayload;
  const entry = payload?.content?.[0];
  if (!entry || typeof entry.logprob !== 'number' || !Number.isFinite(entry.logprob)) {
    return null;
  }

  // Prefer the chosen label's mass from top_logprobs when present (more stable
  // than the sampled token if the API ever returns a different first token).
  const tops = entry.top_logprobs;
  if (Array.isArray(tops) && tops.length > 0) {
    const match = tops.find((t) => (t.token ?? '').trim() === chosenLabel);
    if (match && typeof match.logprob === 'number' && Number.isFinite(match.logprob)) {
      return clamp01(Math.exp(match.logprob));
    }
  }

  const token = (entry.token ?? '').trim();
  if (token && token !== chosenLabel) {
    // Sampled token ≠ chosen label — do not trust this mass for the decision.
    return null;
  }
  return clamp01(Math.exp(entry.logprob));
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

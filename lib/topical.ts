/**
 * Conservative off-topic guard for the agent channel (audit C4). instructions.md already tells the
 * ranger to answer a brief off-topic aside and steer back — that's intended product behavior, so this
 * does NOT hard-block. It only catches HIGH-confidence "use me as a free code/LLM proxy" shapes (fenced
 * code, explicit programming verbs, SQL) and injects a steering nudge so the model gives a one-line
 * redirect instead of producing the artifact — trimming the cost of the abuse-shaped turns. The pattern
 * is deliberately narrow: these shapes essentially never appear in genuine parks planning, keeping
 * false positives near zero. (The per-user rate limit in agent/channels/eve.ts is the real cost ceiling;
 * this is a cheap complement.)
 */
const CODE_PROXY_RX =
  /```|\bwrite\s+(\w+\s+){0,3}?(function|program|script|class|module|component|sql\s+query|regex|unit\s+tests?)\b|\bdef\s+\w+\s*\(|\bclass\s+\w+\s*[:{]|\bSELECT\b[\s\S]+\bFROM\b/i;

const STEER =
  '[scope guard] This message looks like a request to produce code or other content unrelated to ' +
  'national parks. Per your topical-scope rules: reply with ONE short, friendly sentence — do NOT ' +
  'produce the requested artifact — and steer back to parks.';

/** Returns a steering context string for clearly off-topic/code-proxy prompts, else null. */
export function offTopicSteer(message: unknown): string | null {
  if (typeof message !== 'string' || message.length === 0) return null;
  return CODE_PROXY_RX.test(message) ? STEER : null;
}

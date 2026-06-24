import { defineAgent } from 'eve';

/**
 * Ranger — the TrailGraph trip-planning agent (ADR-014: one model for v1).
 * Model string is config-swappable; resolved via AI Gateway (OIDC, no provider keys in code).
 */
export default defineAgent({
  // Note: AI Gateway / Eve metadata keys this model with a DOT ('4.6'), not a dash — the dash
  // variant has no context-window metadata and Eve refuses to compile compaction against it.
  model: process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-4.6',
  // Extended thinking on, so the ranger emits `reasoning` parts the chat surfaces behind the tool-call
  // pill's optional "Show reasoning" disclosure. Modest budget caps the added latency/cost; forwarded to
  // Anthropic via the AI Gateway provider-options passthrough.
  modelOptions: {
    providerOptions: {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 1024 },
      },
    },
  },
  // Cost ceiling (audit C2). Compact earlier than Eve's 0.9 default so one pathological/looping turn
  // can't churn ~90% of the context window repeatedly before summarizing. Eve has no first-class
  // per-turn step cap; the per-user rate limit (agent/channels/eve.ts) and the runaway clamp
  // (agent/hooks/turn-accounting.ts) cap turn *count* and runaway turns respectively.
  // (Optional further saving: set `compaction.model` to a cheaper gateway model for summaries — use the
  // DOT model id, e.g. 'anthropic/claude-haiku-4.5', and verify it carries context-window metadata, or
  // Eve refuses to compile compaction against it.)
  compaction: {
    thresholdPercent: 0.6,
  },
});

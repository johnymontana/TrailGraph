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
});

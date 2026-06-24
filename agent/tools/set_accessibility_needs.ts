import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setAccessibilityNeeds, clearAccessibilityNeeds } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Record the user's accessibility needs (plan F5) as durable `(:User)-[:REQUIRES]->(:Amenity)` edges,
 * reusing the existing constraint machinery so recommendations and `find_parks` honor them on every turn.
 * Identity comes from the session (never a model-supplied id).
 */
const FEATURE_TO_ID: Record<string, string> = {
  wheelchair: 'amen:wheelchair-accessible',
  audio_description: 'amen:audio-description',
  braille: 'amen:braille',
  assistive_listening: 'amen:assistive-listening',
  accessible_restroom: 'amen:accessible-restroom',
  accessible_parking: 'amen:accessible-parking',
};

export default defineTool({
  description:
    "Save the user's DURABLE accessibility needs (persists across sessions) so every later recommendation and `find_parks` honors them — e.g. wheelchair access, audio description, braille, assistive listening, accessible restroom/parking. Call when the user states an accessibility requirement for themselves or a companion. Pass `clear: true` (or an empty `features` list) to remove all saved accessibility needs. For a ONE-TRIP need that should NOT be saved globally, pass `requiredAmenities` to `find_parks` instead.",
  inputSchema: z.object({
    features: z
      .array(z.enum(['wheelchair', 'audio_description', 'braille', 'assistive_listening', 'accessible_restroom', 'accessible_parking']))
      .default([]),
    clear: z.boolean().optional().describe('Remove all saved accessibility needs.'),
  }),
  async execute({ features, clear }, ctx) {
    const userId = callerId(ctx);
    if (clear || features.length === 0) {
      await clearAccessibilityNeeds(userId);
      return { kind: 'constraints_saved', data: { cleared: true, needs: [] } };
    }
    const ids = features.map((f) => FEATURE_TO_ID[f]).filter(Boolean);
    const applied = await setAccessibilityNeeds(userId, ids);
    // Non-rendering envelope (like record_pass) — the model narrates the confirmation from this data.
    return {
      kind: 'constraints_saved',
      data: { saved: true, needs: applied.map((id) => id.replace('amen:', '').replace(/-/g, ' ')) },
    };
  },
});

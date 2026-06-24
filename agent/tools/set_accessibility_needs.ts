import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setAccessibilityNeeds } from '../../lib/bridges';
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
    "Save the user's accessibility needs so park recommendations honor them (e.g. wheelchair access, audio description, braille, assistive listening, accessible restroom/parking). Call when the user states an accessibility requirement for themselves or a companion.",
  inputSchema: z.object({
    features: z
      .array(z.enum(['wheelchair', 'audio_description', 'braille', 'assistive_listening', 'accessible_restroom', 'accessible_parking']))
      .min(1),
  }),
  async execute({ features }, ctx) {
    const userId = callerId(ctx);
    const ids = features.map((f) => FEATURE_TO_ID[f]).filter(Boolean);
    const applied = await setAccessibilityNeeds(userId, ids);
    // Non-rendering envelope (like record_pass) — the model narrates the confirmation from this data.
    return {
      kind: 'constraints_saved',
      data: { saved: true, needs: applied.map((id) => id.replace('amen:', '').replace(/-/g, ' ')) },
    };
  },
});

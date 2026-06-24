import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { accessibilityScorecard } from '../../lib/queries';

/**
 * Accessibility scorecard for a park (plan F5): the accessibility amenities reported across its places,
 * campgrounds, visitor centers, trails, and parking — plus accessible-campground and audio-described
 * counts. Graph-grounded (R6). Self-reported NPS data: frame as "reported, verify with the park."
 */
export default defineTool({
  description:
    "Accessibility scorecard for a park by parkCode: which accessibility features (wheelchair access, audio description, braille, accessible restrooms/parking) are reported across its places/campgrounds/trails, plus accessible-campground and audio-described-place counts. Data is reported by the park, not a guarantee.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const res = await accessibilityScorecard(parkCode);
    if (!res) return { kind: 'accessibility_card', data: { error: `No park with code ${parkCode}` } };
    return { kind: 'accessibility_card', data: res };
  },
});

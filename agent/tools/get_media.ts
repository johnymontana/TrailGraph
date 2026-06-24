import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { mediaForPark } from '../../lib/queries';

/**
 * Self-guided audio tours, galleries, and videos for a park (plan F6/P2-1). Great for the offline pack
 * and for the accessibility audience (audio-described content). Graph-grounded (R6); only populated when
 * the multimedia corpus has been synced (SYNC_MULTIMEDIA=1).
 */
export default defineTool({
  description:
    "Self-guided audio tours, photo galleries, and videos for a park (by parkCode) — useful for offline planning and audio-described accessibility content. Returns nothing when multimedia isn't synced for the park.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const media = await mediaForPark(parkCode);
    const has = media.audio.length || media.galleries.length || media.videos.length;
    if (!has) return { kind: 'media_card', data: { error: `No self-guided audio or media available for ${parkCode} yet.` } };
    return { kind: 'media_card', data: { parkCode, ...media } };
  },
});

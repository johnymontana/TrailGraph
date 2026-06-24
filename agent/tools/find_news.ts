import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { newsForPark } from '../../lib/queries';

/**
 * Latest NPS news releases for a park (plan F8): timely closures, new programs, events. Graph-grounded
 * from `(:NewsRelease)-[:ABOUT]->(:Park)`, most recent first. "As of last sync."
 */
export default defineTool({
  description:
    "Latest official NPS news releases for a park (by parkCode) — recent closures, new programs, seasonal updates. Most recent first.",
  inputSchema: z.object({
    parkCode: z.string(),
    limit: z.number().min(1).max(10).default(5),
  }),
  async execute({ parkCode, limit }) {
    const news = await newsForPark(parkCode, limit);
    if (!news.length) return { kind: 'news_card', data: { parkCode, news: [] } };
    return { kind: 'news_card', data: { parkCode, news } };
  },
});

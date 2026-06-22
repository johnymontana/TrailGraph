import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { thematicTrail } from '../../lib/queries';

/**
 * Thematic cross-park trail (NPS-expansion P0 #2): the parks tied together by a historical figure or a
 * topic — e.g. a Civil Rights trail, an Ansel Adams photography trail. A multi-hop graph traversal the
 * ranger can turn into a multi-park itinerary. Graph-grounded (R6).
 */
export default defineTool({
  description:
    "Find a cross-park 'trail' of parks connected by a historical person or a topic (e.g. person='Ansel Adams' or topic='Civil Rights'). Returns the connected parks to seed a thematic multi-park trip.",
  inputSchema: z
    .object({
      person: z.string().optional().describe('A historical figure, e.g. "Ansel Adams"'),
      topic: z.string().optional().describe('An exact NPS topic name, e.g. "Civil Rights"'),
      limit: z.number().max(15).default(10),
    })
    .refine((v) => v.person || v.topic, { message: 'Provide a person or a topic' }),
  async execute({ person, topic, limit }) {
    const parks = await thematicTrail({ person, topic }, limit);
    if (parks.length === 0) {
      return { kind: 'park_card', data: { error: `No trail found for ${person ?? topic}.` } };
    }
    return { kind: 'park_card', data: { parks, trail: person ?? topic } };
  },
});

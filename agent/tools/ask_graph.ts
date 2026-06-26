import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { runIntent, INTENT_IDS, INTENT_GUIDE } from '../../lib/graph-intents';

/**
 * "Ask the graph" (#5a): answer a structural question about how parks connect by picking a CURATED intent
 * and filling typed params — the model never writes Cypher. Returns a narrated answer + a `graph_result`
 * subgraph card. Use for questions like "parks connected to John Muir", "how are Zion and Acadia linked",
 * "parks sharing both Volcanoes and Dark Skies", "what do Zion and Bryce share".
 */
export default defineTool({
  description:
    `Answer a question about how parks CONNECT, rendered as a graph. Pick one intent and fill its params ` +
    `(the model never writes Cypher). Available intents:\n${INTENT_GUIDE}\n` +
    `params examples — parks_by_person: {"person":"John Muir"}; parks_by_topic: {"topic":"Volcanoes"}; ` +
    `similar_to: {"park":"Yosemite"}; parks_near: {"park":"Zion","miles":150}; ` +
    `parks_sharing_topics: {"topic1":"Volcanoes","topic2":"Dark Skies"}; ` +
    `parks_near_with_topic: {"park":"Zion","topic":"Dark Skies","miles":200}; ` +
    `how_connected: {"a":"Gettysburg","b":"Yosemite"}; shared_between: {"a":"Zion","b":"Bryce"}.`,
  inputSchema: z.object({
    intent: z.enum(INTENT_IDS),
    params: z.record(z.string(), z.unknown()).describe('Typed params for the chosen intent (see the description).'),
  }),
  async execute({ intent, params }) {
    const result = await runIntent(intent, params ?? {});
    return { kind: 'graph_result', data: { ...result, intent } };
  },
});

import { Box, Heading, Text } from '@chakra-ui/react';
import { graphSeed, journeyTrail } from '../../lib/queries';
import { getServerUserId } from '../../lib/session';
import { getUserMemory, userContextGraph, userContextBridges } from '../../lib/memory-graph';
import { bridgesToRels } from '../../lib/graph-nvl';
import { GraphConstellation } from '../../components/graph/GraphConstellation';

/** Signature graph view (R2 §P3, centerpiece §5e): National Parks linked by shared topics, with your
 * own parks highlighted and a topic filter — the graph, literally. */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function GraphPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const userId = await getServerUserId();
  // A `?person=`/`?topic=` link from /journeys highlights that journey's parks instead of the
  // user's considered set — the cross-park traversal made literal on the constellation.
  const person = sp.person?.trim() || undefined;
  const topic = sp.topic?.trim() || undefined;
  const trailTheme = person ?? topic;
  const [data, mem, trail, context] = await Promise.all([
    graphSeed().catch(() => ({ nodes: [], links: [] })),
    userId ? getUserMemory(userId).catch(() => null) : Promise.resolve(null),
    trailTheme ? journeyTrail({ person, topic }).catch(() => []) : Promise.resolve([]),
    userId ? userContextGraph(userId).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const highlight = trailTheme ? trail.map((p) => p.parkCode) : (mem?.considered.map((c) => c.parkCode) ?? []);
  // Bridges (#8) connect the user's context nodes to the parks they touch — fetched after the seed so we
  // can scope them to the parks actually on the constellation (+ any considered park).
  const parkCodes = [
    ...new Set([
      ...data.nodes.filter((n) => n.label === 'Park').map((n) => n.parkCode ?? n.id),
      ...(mem?.considered.map((c) => c.parkCode) ?? []),
    ]),
  ];
  const bridges =
    userId && parkCodes.length
      ? bridgesToRels(await userContextBridges(userId, parkCodes).catch(() => []))
      : [];
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0} data-fullscreen>
      <Box position="absolute" top={3} left={3} zIndex={1} bg="bg.panel" borderWidth="1px" borderRadius="md" px={3} py={2} shadow="md" maxW="sm">
        <Heading as="h1" size="sm">The park graph</Heading>
        <Text fontSize="xs" color="fg.muted">
          {data.nodes.length} National Parks, each linked to its most similar parks by their most
          distinctive shared topics. Filter by topic, click a node to expand its connections, and switch
          to “me + the world” to see yourself in the graph.
          {trailTheme
            ? ` The ${trailTheme} trail (${highlight.length} park${highlight.length === 1 ? '' : 's'}) is highlighted.`
            : highlight.length > 0
              ? ' Your parks are highlighted.'
              : ''}
        </Text>
      </Box>
      <GraphConstellation data={data} highlight={highlight} context={context ?? undefined} bridges={bridges} authed={!!userId} />
    </Box>
  );
}

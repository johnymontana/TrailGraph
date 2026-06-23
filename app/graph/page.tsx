import { Box, Heading, Text } from '@chakra-ui/react';
import { graphNeighborhood, thematicTrail } from '../../lib/queries';
import { getServerUserId } from '../../lib/session';
import { getUserMemory } from '../../lib/memory-graph';
import { GraphConstellation } from '../../components/graph/GraphConstellation';

/** Signature graph view (R2 §P3, centerpiece §5e): National Parks linked by shared topics, with your
 * own parks highlighted and a topic filter — the graph, literally. */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function GraphPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const userId = await getServerUserId();
  // A `?person=`/`?topic=` link from /trails highlights that thematic trail's parks instead of the
  // user's considered set — the cross-park traversal made literal on the constellation.
  const person = sp.person?.trim() || undefined;
  const topic = sp.topic?.trim() || undefined;
  const trailTheme = person ?? topic;
  const [data, mem, trail] = await Promise.all([
    graphNeighborhood().catch(() => ({ nodes: [], links: [] })),
    userId ? getUserMemory(userId).catch(() => null) : Promise.resolve(null),
    trailTheme ? thematicTrail({ person, topic }).catch(() => []) : Promise.resolve([]),
  ]);
  const highlight = trailTheme ? trail.map((p) => p.parkCode) : (mem?.considered.map((c) => c.parkCode) ?? []);
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0} data-fullscreen>
      <Box position="absolute" top={3} left={3} zIndex={1} bg="bg.panel" borderWidth="1px" borderRadius="md" px={3} py={2} shadow="md" maxW="sm">
        <Heading as="h1" size="sm">The park graph</Heading>
        <Text fontSize="xs" color="fg.muted">
          {data.nodes.length} National Parks linked by shared topics. Filter by topic, hover an edge to
          see why two parks connect, and click a park to open it.
          {trailTheme
            ? ` The ${trailTheme} trail (${highlight.length} park${highlight.length === 1 ? '' : 's'}) is highlighted.`
            : highlight.length > 0
              ? ' Your parks are highlighted.'
              : ''}
        </Text>
      </Box>
      <GraphConstellation data={data} highlight={highlight} />
    </Box>
  );
}

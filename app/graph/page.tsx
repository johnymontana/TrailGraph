import { Box, Heading, Text } from '@chakra-ui/react';
import { graphNeighborhood } from '../../lib/queries';
import { getServerUserId } from '../../lib/session';
import { getUserMemory } from '../../lib/memory-graph';
import { GraphConstellation } from '../../components/graph/GraphConstellation';

/** Signature graph view (R2 §P3, centerpiece §5e): National Parks linked by shared topics, with your
 * own parks highlighted and a topic filter — the graph, literally. */
export const dynamic = 'force-dynamic';

export default async function GraphPage() {
  const userId = await getServerUserId();
  const [data, mem] = await Promise.all([
    graphNeighborhood().catch(() => ({ nodes: [], links: [] })),
    userId ? getUserMemory(userId).catch(() => null) : Promise.resolve(null),
  ]);
  const highlight = mem?.considered.map((c) => c.parkCode) ?? [];
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0}>
      <Box position="absolute" top={3} left={3} zIndex={1} bg="bg.panel" borderWidth="1px" borderRadius="md" px={3} py={2} shadow="md" maxW="sm">
        <Heading as="h1" size="sm">The park graph</Heading>
        <Text fontSize="xs" color="fg.muted">
          {data.nodes.length} National Parks linked by shared topics. Filter by topic, hover an edge to
          see why two parks connect, and click a park to open it.
          {highlight.length > 0 ? ' Your parks are highlighted.' : ''}
        </Text>
      </Box>
      <GraphConstellation data={data} highlight={highlight} />
    </Box>
  );
}

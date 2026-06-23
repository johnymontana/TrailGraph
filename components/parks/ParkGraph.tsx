'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Heading, Text, HStack, Wrap } from '@chakra-ui/react';
import { NvlGraph } from '../graph/NvlGraph';
import { parkNodeNav, labelColor } from '../../lib/graph-nvl';
import type { ParkGraphData } from '../../lib/queries';

/**
 * Interactive one-hop graph of a park's connections (§NVL), rendered with Neo4j NVL. Center park +
 * its activities/topics/state/campgrounds/visitor-centers/things-to-do/alerts, plus its top similar
 * parks. Click an Activity/Topic/State → Explore filter; click a Park → that park's page.
 */
export function ParkGraph({ data, parkName }: { data: ParkGraphData; parkName: string }) {
  const router = useRouter();

  // id → nav descriptor for click routing; and the set of labels present, for the legend.
  const navById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.nav])), [data]);
  const labels = useMemo(() => [...new Set(data.nodes.map((n) => n.label))], [data]);

  if (data.nodes.length <= 1) return null; // nothing to show beyond the park itself

  const legend = (
    <Box position="absolute" bottom={3} left={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" maxW="90%">
      <Wrap gap={3}>
        {labels.map((l) => (
          <HStack key={l} gap={1.5}>
            <Box w="10px" h="10px" borderRadius="full" bg={labelColor(l)} />
            <Text fontSize="xs">{l}</Text>
          </HStack>
        ))}
      </Wrap>
    </Box>
  );

  return (
    <Box mt={12}>
      <Heading size="md" mb={1}>How {parkName} connects</Heading>
      <Text fontSize="sm" color="fg.muted" mb={3}>
        This park&apos;s activities, topics, location, and on-the-ground places — one hop in the graph.
        Drag to explore; click an activity, topic, or related park to follow it.
      </Text>
      <Box borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" bg="bg.subtle">
        <NvlGraph
          nodes={data.nodes}
          rels={data.relationships}
          height={420}
          onNodeClick={(id) => {
            const route = parkNodeNav(navById.get(id));
            if (route) router.push(route);
          }}
          legend={legend}
        />
      </Box>
    </Box>
  );
}

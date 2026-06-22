'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Text, HStack, Stack } from '@chakra-ui/react';
import { NvlGraph } from './NvlGraph';
import { neighborhoodToNvl } from '../../lib/graph-nvl';

interface GraphLink { source: string; target: string; value: number; topics?: string[] }
interface GraphNode { id: string; name: string; degree?: number }
interface GraphData { nodes: GraphNode[]; links: GraphLink[] }

/**
 * The /graph constellation, rendered with Neo4j NVL (R4 — replaces react-force-graph-2d). Keeps the
 * topic filter, "your parks" highlight, legend, and click-to-open; NVL handles pan/zoom/labels/hover.
 */
export function GraphConstellation({ data, highlight = [] }: { data: GraphData; highlight?: string[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');

  const allTopics = useMemo(() => {
    const s = new Set<string>();
    for (const l of data.links) for (const t of l.topics ?? []) s.add(t);
    return [...s].sort();
  }, [data]);

  // Filter to a single topic (links carrying it + the nodes they touch).
  const view = useMemo(() => {
    if (!topic) return data;
    const links = data.links.filter((l) => l.topics?.includes(topic));
    const keep = new Set<string>();
    for (const l of links) {
      keep.add(l.source);
      keep.add(l.target);
    }
    return { nodes: data.nodes.filter((n) => keep.has(n.id)), links };
  }, [data, topic]);

  const { nodes, rels } = useMemo(() => neighborhoodToNvl(view, highlight), [view, highlight]);

  const legend = (
    <>
      {allTopics.length > 0 ? (
        <Box position="absolute" top={3} right={3} bg="bg.panel" borderWidth="1px" borderRadius="md" px={2} py={1.5} shadow="md">
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Filter the graph by topic"
            style={{ fontSize: '14px', background: 'transparent', border: 'none', outline: 'none' }}
          >
            <option value="">All topics</option>
            {allTopics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Box>
      ) : null}
      <Stack position="absolute" bottom={3} right={3} bg="bg.panel" borderWidth="1px" borderRadius="md" px={3} py={2} shadow="md" gap={1}>
        <HStack gap={2}>
          <Box w="10px" h="10px" borderRadius="full" bg="#1864ab" />
          <Text fontSize="xs">Hub park (shares many topics)</Text>
        </HStack>
        {highlight.length > 0 ? (
          <HStack gap={2}>
            <Box w="10px" h="10px" borderRadius="full" bg="#e8590c" />
            <Text fontSize="xs">Your saved / considered parks</Text>
          </HStack>
        ) : null}
        <Text fontSize="xs" color="fg.muted">Scroll to zoom · drag to pan · click a park to open it</Text>
      </Stack>
    </>
  );

  return (
    <Box position="absolute" inset={0}>
      <NvlGraph nodes={nodes} rels={rels} height="100%" onNodeClick={(id) => router.push(`/parks/${id}`)} legend={legend} />
    </Box>
  );
}

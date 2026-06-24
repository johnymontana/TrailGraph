'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, Text, HStack, Stack } from '@chakra-ui/react';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';
import { NvlGraph } from './NvlGraph';
import { neighborhoodToNvl, isContextParkId } from '../../lib/graph-nvl';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';

interface GraphLink { source: string; target: string; value: number; topics?: string[] }
interface GraphNode { id: string; name: string; degree?: number }
interface GraphData { nodes: GraphNode[]; links: GraphLink[] }
interface ContextGraphData { nodes: NvlNode[]; rels: NvlRel[] }

/**
 * The /graph constellation, rendered with Neo4j NVL (R4 — replaces react-force-graph-2d). Keeps the
 * topic filter, "your parks" highlight, legend, and click-to-open; NVL handles pan/zoom/labels/hover.
 * The optional two-graph overlay (ADR-047) layers the user's context graph (trail accent) on top of the
 * domain constellation (pine) — you literally see yourself inside the data.
 */
export function GraphConstellation({
  data,
  highlight = [],
  context,
}: {
  data: GraphData;
  highlight?: string[];
  context?: ContextGraphData;
}) {
  const router = useRouter();
  const { colorMode } = useColorMode();
  const [topic, setTopic] = useState('');
  const [showContext, setShowContext] = useState(false);
  const fadeColor = brandColors(colorMode).faded;
  const hasContext = (context?.nodes.length ?? 0) > 1; // more than just the "You" node

  const allTopics = useMemo(() => {
    const s = new Set<string>();
    for (const l of data.links) for (const t of l.topics ?? []) s.add(t);
    return [...s].sort();
  }, [data]);

  // Topic filter (R4 §2.8): instead of removing non-matching nodes, keep the whole graph and DIM the
  // ones that don't share the selected topic, plus report a match count — so it's clear what changed.
  const { nodes, rels, matchCount } = useMemo(() => {
    const base = neighborhoodToNvl(data, highlight);
    if (!topic) return { ...base, matchCount: 0 };
    const matchIds = new Set<string>();
    for (const l of data.links) {
      if (l.topics?.includes(topic)) {
        matchIds.add(l.source);
        matchIds.add(l.target);
      }
    }
    const nodes = base.nodes.map((n) =>
      matchIds.has(n.id) ? n : { ...n, color: fadeColor, size: Math.max(4, (n.size ?? 8) * 0.55) },
    );
    const rels = base.rels.map((r) => {
      const carries = data.links.find((l) => `${l.source}--${l.target}` === r.id)?.topics?.includes(topic);
      return carries ? r : { ...r, color: 'rgba(171,155,119,0.18)' };
    });
    return { nodes, rels, matchCount: matchIds.size };
  }, [data, highlight, topic, fadeColor]);

  // Two-graph overlay merge (ADR-047): context nodes/rels layered on top, de-duped by id so a CONSIDERED
  // park (bare parkCode) attaches to its existing domain node rather than duplicating. Domain wins color.
  const { nodes: viewNodes, rels: viewRels } = useMemo(() => {
    if (!showContext || !context) return { nodes, rels };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const cn of context.nodes) if (!byId.has(cn.id)) byId.set(cn.id, cn);
    return { nodes: [...byId.values()], rels: [...rels, ...context.rels] };
  }, [nodes, rels, showContext, context]);

  const legend = (
    <>
      {hasContext ? (
        <Box position="absolute" bottom={3} left={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md">
          <Button size="xs" variant={showContext ? 'solid' : 'outline'} colorPalette="trail" onClick={() => setShowContext((v) => !v)}>
            {showContext ? 'Hide my context' : 'Show my context'}
          </Button>
        </Box>
      ) : null}
      {allTopics.length > 0 ? (
        <Box position="absolute" top={3} right={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md">
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Filter the graph by topic"
            style={{
              fontSize: '14px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--chakra-colors-fg)',
            }}
          >
            <option value="">All topics</option>
            {allTopics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {topic ? (
            <Text fontSize="xs" color="fg.muted" mt={1}>
              {matchCount} park{matchCount === 1 ? '' : 's'} share {topic}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Stack position="absolute" bottom={3} right={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={1}>
        <HStack gap={2}>
          <Box w="10px" h="10px" borderRadius="full" bg="pine.solid" />
          <Text fontSize="xs">Hub park (shares many topics)</Text>
        </HStack>
        {highlight.length > 0 || (showContext && hasContext) ? (
          <HStack gap={2}>
            <Box w="10px" h="10px" borderRadius="full" bg="accent.solid" />
            <Text fontSize="xs">{showContext && hasContext ? 'You + your memory' : 'Your saved / considered parks'}</Text>
          </HStack>
        ) : null}
        <Text fontSize="xs" color="fg.muted">Scroll to zoom · drag to pan · click a park to open it</Text>
      </Stack>
    </>
  );

  return (
    <Box position="absolute" inset={0}>
      <NvlGraph
        nodes={viewNodes}
        rels={viewRels}
        height="100%"
        // Only navigate for park nodes (bare parkCode). Context-only nodes (ctx:* prefix) aren't routable.
        onNodeClick={(id) => {
          if (isContextParkId(id)) router.push(`/parks/${id}`);
        }}
        legend={legend}
      />
    </Box>
  );
}

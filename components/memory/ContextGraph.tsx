'use client';
import { useRouter } from 'next/navigation';
import { Box, HStack, Text } from '@chakra-ui/react';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';
import { NvlGraph } from '../graph/NvlGraph';
import { isContextParkId } from '../../lib/graph-nvl';

/**
 * The `/me` context graph (ADR-047): the user's memory rendered as the living graph the product is named
 * for — (You)→preferences, considered parks, constraints, passes, stamps, travel window. Explicit pixel
 * height (NVL renders blank at zero height — CLAUDE.md NVL gotcha #1). CONSIDERED-park nodes (bare
 * parkCode) route to the park page; context-only nodes aren't navigable. This surface is also the future
 * target for the memory-forming animation (ADR-044, wired in the motion workstream).
 */
export function ContextGraph({ nodes, rels }: { nodes: NvlNode[]; rels: NvlRel[] }) {
  const router = useRouter();
  if (nodes.length <= 1) return null; // just the "You" node — nothing to show yet
  return (
    <Box mb={8}>
      <Text fontSize="sm" color="fg.muted" mb={2}>
        This is what the ranger remembers about you, as a graph — click a park to open it.
      </Text>
      <Box borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" bg="bg.subtle" h={{ base: '320px', md: '420px' }}>
        <NvlGraph
          nodes={nodes}
          rels={rels}
          height="100%"
          onNodeClick={(id) => {
            if (isContextParkId(id)) router.push(`/parks/${id}`);
          }}
          legend={
            <HStack position="absolute" bottom={3} right={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={2}>
              <Box w="10px" h="10px" borderRadius="full" bg="accent.solid" />
              <Text fontSize="xs">You + your memory</Text>
            </HStack>
          }
        />
      </Box>
    </Box>
  );
}

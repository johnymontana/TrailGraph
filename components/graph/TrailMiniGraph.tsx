'use client';
import { useRouter } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import { NvlGraph } from './NvlGraph';
import { trailToNvl, TRAIL_THEME_PREFIX } from '../../lib/graph-nvl';

/**
 * Inline thematic-trail mini-graph (ADR-039): a small NVL graph of the theme connected to its parks,
 * shown above the card grid on /trails so a "trail" reads as a connected traversal, not just a grid.
 * Clicking a park node opens its page; the center theme node is non-navigable.
 */
export function TrailMiniGraph({
  themeLabel,
  parks,
}: {
  themeLabel: string;
  parks: { parkCode: string; name: string }[];
}) {
  const router = useRouter();
  const { nodes, rels } = trailToNvl(themeLabel, parks);

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" bg="bg.subtle">
      <NvlGraph
        nodes={nodes}
        rels={rels}
        height={280}
        onNodeClick={(id) => {
          if (id.startsWith(TRAIL_THEME_PREFIX)) return; // the theme hub isn't a destination
          router.push(`/parks/${id}`);
        }}
      />
    </Box>
  );
}

'use client';
import { Box, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import { ChartCard } from './ChartCard';
import type { CrowdHeatCell } from '../../../lib/park-charts';

/**
 * Best-time-to-visit calendar (ADR — park data-viz) — a 12-cell month heatmap where intensity tracks
 * relative crowds (lighter = quieter) and the lowest-crowd ("best") months are ringed. A crisp custom
 * grid (not recharts); cell shade uses `color-mix` over the theme's pine token so it adapts to color mode.
 */
export function CrowdCalendar({ cells }: { cells: CrowdHeatCell[] }) {
  if (!cells.length) return null;
  return (
    <ChartCard title="Best time to visit" caption="Relative crowds by month — lighter is quieter; ringed months are calmest.">
      <SimpleGrid columns={{ base: 4, sm: 6 }} gap={1.5}>
        {cells.map((c) => {
          const mix = Math.round(12 + 0.78 * c.pct); // quiet ≈ 12%, busiest ≈ 90%
          return (
            <Stack
              key={c.month}
              gap={0}
              align="center"
              borderRadius="md"
              borderWidth="2px"
              borderColor={c.best ? 'trail.solid' : 'transparent'}
              py={2}
              px={1}
              style={{ backgroundColor: `color-mix(in srgb, var(--chakra-colors-pine-solid) ${mix}%, transparent)` }}
              title={`${c.month}: ${c.visits.toLocaleString()} visits`}
            >
              <Text fontSize="xs" fontWeight="semibold" color="fg">
                {c.month}
              </Text>
              <Text fontSize="10px" color="fg.muted">
                {c.pct}%
              </Text>
            </Stack>
          );
        })}
      </SimpleGrid>
      <Box mt={2} fontSize="10px" color="fg.subtle">
        % of the busiest month's visits.
      </Box>
    </ChartCard>
  );
}

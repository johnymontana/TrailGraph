'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Cell, PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { Box, Stack, Text } from '@chakra-ui/react';
import { ChartCard } from './ChartCard';
import type { DarkSkyGauge as Gauge } from '../../../lib/park-charts';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

/**
 * Dark-sky quality gauge (ADR — park data-viz) — a radial dial where a darker sky (lower Bortle) fills
 * more of the arc; center shows Bortle + star rating + the SQM estimate. `responsive` required. Bar color
 * via `<Cell>`; the center label is an absolute overlay (reliable for RadialBar). Dark-sky parks only.
 */
export function DarkSkyGauge({ gauge }: { gauge: Gauge }) {
  const chart = useChart({ data: [{ value: gauge.fillPct }] });
  return (
    <ChartCard title="Dark sky" caption="How dark the night sky is — darker (lower Bortle) fills the dial.">
      <Box position="relative" w="full">
        <Chart.Root maxH="52" chart={chart} aria-label={`Dark-sky gauge: Bortle ${gauge.bortle}`}>
          <RadialBarChart data={chart.data} innerRadius={70} outerRadius={106} startAngle={220} endAngle={-40} responsive>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              dataKey={chart.key('value')}
              angleAxisId={0}
              background={{ fill: chart.color('bg.muted') }}
              cornerRadius={10}
              isAnimationActive={false}
            >
              <Cell fill={chart.color('purple.solid')} />
            </RadialBar>
          </RadialBarChart>
        </Chart.Root>
        <Stack position="absolute" inset="0" align="center" justify="center" gap={0} pointerEvents="none">
          <Text fontSize="2xl" fontFamily="heading" fontWeight="bold" lineHeight="1">
            Bortle {gauge.bortle}
          </Text>
          <Text fontSize="sm" color="purple.fg" letterSpacing="0.08em" aria-label={`${gauge.stars} of 5 stars`}>
            {stars(gauge.stars)}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            SQM ~{gauge.sqm}
          </Text>
        </Stack>
      </Box>
    </ChartCard>
  );
}

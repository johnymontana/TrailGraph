'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartCard } from './ChartCard';
import type { ScatterTrail, TrailDifficulty } from '../../../lib/park-charts';

const GROUPS: { key: TrailDifficulty; label: string; color: string }[] = [
  { key: 'easy', label: 'Easy', color: 'pine.solid' },
  { key: 'moderate', label: 'Moderate', color: 'yellow.solid' },
  { key: 'strenuous', label: 'Strenuous', color: 'red.solid' },
  { key: 'unknown', label: 'Unrated', color: 'gray.solid' },
];

/**
 * Trail profile scatter (ADR — park data-viz) — each trail a point: length (mi) × elevation gain (ft),
 * colored by difficulty (one `<Scatter>` per group, so no shape callback). `responsive` required. Null
 * when no trail has both metrics.
 */
export function TrailScatter({ trails }: { trails: ScatterTrail[] }) {
  const chart = useChart({ data: trails });
  if (!trails.length) return null;
  return (
    <ChartCard title="Trail profile" caption="Each dot is a trail — distance vs. elevation gain, by difficulty.">
      <Chart.Root maxH="64" chart={chart} aria-label="Trail length versus elevation gain">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }} responsive>
          <XAxis
            type="number"
            dataKey="length"
            name="Length"
            unit=" mi"
            stroke={chart.color('border')}
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="elevationGain"
            name="Elevation"
            unit=" ft"
            stroke={chart.color('border')}
            fontSize={11}
            width={48}
            tickLine={false}
            tickFormatter={chart.formatNumber({ notation: 'compact' })}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<Chart.Tooltip hideLabel />} />
          {GROUPS.map((g) => {
            const data = trails.filter((t) => t.difficulty === g.key);
            if (!data.length) return null;
            return <Scatter key={g.key} name={g.label} data={data} fill={chart.color(g.color)} isAnimationActive={false} />;
          })}
        </ScatterChart>
      </Chart.Root>
    </ChartCard>
  );
}

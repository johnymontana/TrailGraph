'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Cell, Label, Pie, PieChart, Tooltip } from 'recharts';
import { ChartCard } from './ChartCard';
import type { DifficultySlice, TrailDifficulty } from '../../../lib/park-charts';

const COLOR: Record<TrailDifficulty, string> = {
  easy: 'pine.solid',
  moderate: 'yellow.solid',
  strenuous: 'red.solid',
  unknown: 'gray.solid',
};
const LABEL: Record<TrailDifficulty, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  strenuous: 'Strenuous',
  unknown: 'Unrated',
};

/**
 * Trail difficulty donut (ADR — park data-viz) — easy/moderate/strenuous mix across a park's trails,
 * intuitive green→yellow→red. Center label = total trails. `responsive` required. Per-slice colors via
 * `<Cell>` (no shape callback). Null when the park has no trails.
 */
export function TrailDifficultyDonut({ slices }: { slices: DifficultySlice[] }) {
  const data = slices.map((s) => ({ name: LABEL[s.difficulty], value: s.count, color: COLOR[s.difficulty] }));
  const chart = useChart({ data });
  if (!slices.length) return null;
  const total = slices.reduce((n, s) => n + s.count, 0);
  return (
    <ChartCard title="Trail difficulty" caption="Difficulty mix across this park's trails.">
      <Chart.Root boxSize="200px" chart={chart} mx="auto">
        <PieChart responsive>
          <Tooltip cursor={false} content={<Chart.Tooltip hideLabel />} />
          <Pie
            innerRadius={62}
            outerRadius={92}
            data={chart.data}
            dataKey={chart.key('value')}
            nameKey="name"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {chart.data.map((d, i) => (
              <Cell key={i} fill={chart.color(d.color)} stroke="none" />
            ))}
            <Label
              content={({ viewBox }) => (
                <Chart.RadialText viewBox={viewBox} title={String(total)} description={total === 1 ? 'trail' : 'trails'} />
              )}
            />
          </Pie>
        </PieChart>
      </Chart.Root>
    </ChartCard>
  );
}

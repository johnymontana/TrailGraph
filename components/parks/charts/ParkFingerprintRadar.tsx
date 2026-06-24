'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from 'recharts';
import { ChartCard } from './ChartCard';
import type { FingerprintAxis } from '../../../lib/park-charts';

/**
 * Park "fingerprint" radar (ADR — park data-viz) — a 6-axis personality (Trails, Dark sky, Solitude,
 * Water, Wildlife, History & culture), each 0–100. Universal: every park has one. `responsive` required.
 */
export function ParkFingerprintRadar({ axes, parkName }: { axes: FingerprintAxis[]; parkName: string }) {
  const chart = useChart({ data: axes, series: [{ name: 'value', color: 'pine.solid' }] });
  if (!axes.length) return null;
  return (
    <ChartCard title="Park fingerprint" caption="How this park scores across the dimensions travelers care about.">
      <Chart.Root maxH="64" chart={chart} aria-label={`Park fingerprint for ${parkName}`}>
        <RadarChart data={chart.data} responsive>
          <PolarGrid stroke={chart.color('border')} />
          <PolarAngleAxis dataKey={chart.key('axis')} tick={{ fontSize: 11, fill: chart.color('fg.muted') }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip content={<Chart.Tooltip hideLabel />} />
          {chart.series.map((s) => (
            <Radar
              key={s.name}
              name={s.name}
              dataKey={chart.key('value')}
              stroke={chart.color(s.color)}
              fill={chart.color(s.color)}
              fillOpacity={0.25}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </RadarChart>
      </Chart.Root>
    </ChartCard>
  );
}

'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Area, AreaChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from './ChartCard';
import type { WeatherRangePoint } from '../../../lib/park-charts';

/**
 * 3-day temperature range (ADR — park data-viz) — daily high (warm) + low (cool) as gradient areas.
 * `responsive` required. Reuses the live `getWeather` forecast already fetched on the park page.
 */
export function WeatherRangeChart({ points }: { points: WeatherRangePoint[] }) {
  const chart = useChart({
    data: points,
    series: [
      { name: 'hi', label: 'High', color: 'trail.solid' },
      { name: 'lo', label: 'Low', color: 'blue.solid' },
    ],
  });
  if (points.length < 2) return null;
  return (
    <ChartCard title="3-day forecast" caption="Daily high and low temperatures (°F).">
      <Chart.Root maxH="48" chart={chart} aria-label="Three-day temperature range">
        <AreaChart data={chart.data} responsive>
          <defs>
            {chart.series.map((s) => (
              <Chart.Gradient
                key={s.name}
                id={`temp-${s.name}`}
                stops={[
                  { offset: '0%', color: s.color, opacity: 0.3 },
                  { offset: '100%', color: s.color, opacity: 0.04 },
                ]}
              />
            ))}
          </defs>
          <CartesianGrid stroke={chart.color('border.muted')} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={chart.key('day')} tickLine={false} axisLine={false} fontSize={11} />
          <YAxis width={32} tickLine={false} axisLine={false} fontSize={11} unit="°" />
          <Tooltip cursor={false} content={<Chart.Tooltip />} />
          <Legend content={<Chart.Legend />} />
          {chart.series.map((s) => (
            <Area
              key={s.name}
              type="natural"
              dataKey={chart.key(s.name)}
              name={s.label as string}
              fill={`url(#temp-${s.name})`}
              stroke={chart.color(s.color)}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </Chart.Root>
    </ChartCard>
  );
}

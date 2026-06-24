'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Text } from '@chakra-ui/react';

/**
 * Crowd curve (Collective Intelligence v2, ADR-053) — normalized seasonality (0–100 of the busiest
 * month) for one or more parks overlaid, so the user sees when their considered parks are quietest.
 * Client (Recharts); colors resolve through Chakra tokens. Distinct from the park page's raw-visits bar.
 */
export interface Curve {
  parkCode: string;
  name: string;
  points: { label: string; pct: number }[];
}

const SERIES_COLORS = ['trail.solid', 'pine.solid', 'sand.solid', 'pine.emphasized'];

export function CrowdCurve({ curves }: { curves: Curve[] }) {
  const usable = curves.filter((c) => c.points.length === 12);
  if (!usable.length) return null;

  const labels = usable[0].points.map((p) => p.label);
  const data = labels.map((label, i) => {
    const row: Record<string, string | number> = { month: label };
    for (const c of usable) row[c.name] = c.points[i]?.pct ?? 0;
    return row;
  });
  const chart = useChart({
    data,
    series: usable.map((c, i) => ({ name: c.name, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
  });

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb={2}>
        Crowd curve — each line is a park’s monthly visits as a share of its busiest month. Lower = quieter.
      </Text>
      <Chart.Root maxH="48" chart={chart} aria-label="Crowd curve for considered parks">
        <LineChart data={chart.data}>
          <CartesianGrid stroke={chart.color('border.muted')} vertical={false} />
          <XAxis dataKey={chart.key('month')} tickLine={false} axisLine={false} fontSize={11} />
          <YAxis width={32} tickLine={false} axisLine={false} fontSize={11} domain={[0, 100]} />
          <Tooltip cursor={false} content={<Chart.Tooltip />} />
          {chart.series.map((s) => (
            <Line
              key={s.name}
              dataKey={chart.key(s.name)}
              stroke={chart.color(s.color)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Chart.Root>
    </Box>
  );
}

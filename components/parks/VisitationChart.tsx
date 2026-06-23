'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Text } from '@chakra-ui/react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Monthly recreation-visits bar chart (§5b) for the park "Conditions" panel. Server passes the 12-month
 * array + the derived lowest-crowd `bestMonths`; those bars are colored green so "when to visit" reads
 * at a glance. Client component (Recharts needs the browser); colors resolve through Chakra tokens so
 * the chart respects the theme.
 */
export function VisitationChart({
  monthly,
  bestMonths,
  parkName,
}: {
  monthly: number[];
  bestMonths: number[];
  parkName: string;
}) {
  const best = new Set(bestMonths);
  const chart = useChart({
    data: monthly.map((v, i) => ({ month: MONTHS[i], visits: v, best: best.has(i + 1) })),
    series: [{ name: 'visits', color: 'pine.solid' }],
  });

  if (monthly.length !== 12) return null;

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb={2}>
        Monthly recreation visits — <Text as="span" color="accent.fg" fontWeight="medium">orange</Text>{' '}
        months are the lowest-crowd times to visit.
      </Text>
      <Chart.Root maxH="44" chart={chart} aria-label={`Monthly visitation for ${parkName}`}>
        <BarChart data={chart.data}>
          <CartesianGrid stroke={chart.color('border.muted')} vertical={false} />
          <XAxis dataKey={chart.key('month')} tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            width={40}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={chart.formatNumber({ notation: 'compact' })}
          />
          <Tooltip
            cursor={false}
            content={
              <Chart.Tooltip
                hideSeriesLabel
                formatter={(value) => chart.formatNumber({ notation: 'compact' })(Number(value))}
              />
            }
          />
          <Bar dataKey={chart.key('visits')} radius={4}>
            {chart.data.map((d, i) => (
              <Cell key={i} fill={chart.color(d.best ? 'trail.solid' : 'pine.muted')} />
            ))}
          </Bar>
        </BarChart>
      </Chart.Root>
    </Box>
  );
}

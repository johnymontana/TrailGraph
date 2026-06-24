'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Area, AreaChart, CartesianGrid, ReferenceDot, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Text } from '@chakra-ui/react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Visitation throughout the year" — a gradient area chart of typical monthly recreation visits (real NPS
 * data, §5b). Server passes the 12-month array + the derived lowest-crowd `bestMonths` (highlighted as
 * accent dots) + the averaged year range for honest labeling. Client component (Recharts needs the DOM);
 * colors resolve through Chakra tokens. The `responsive` prop is REQUIRED — `@chakra-ui/charts` has no
 * ResponsiveContainer, so without it recharts collapses to zero height.
 */
export function VisitationChart({
  monthly,
  bestMonths,
  parkName,
  years,
}: {
  monthly: number[];
  bestMonths: number[];
  parkName: string;
  years?: readonly [number, number];
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
        Typical monthly recreation visits{years ? ` · NPS avg ${years[0]}–${years[1]}` : ''} —{' '}
        <Text as="span" color="accent.fg" fontWeight="medium">orange</Text> months are the quietest by crowds.
      </Text>
      <Chart.Root maxH="52" chart={chart} aria-label={`Monthly visitation for ${parkName}`}>
        <AreaChart data={chart.data} responsive>
          <defs>
            <Chart.Gradient
              id="visits-gradient"
              stops={[
                { offset: '0%', color: 'pine.solid', opacity: 0.4 },
                { offset: '100%', color: 'pine.solid', opacity: 0.03 },
              ]}
            />
          </defs>
          <CartesianGrid stroke={chart.color('border.muted')} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={chart.key('month')} tickLine={false} axisLine={false} fontSize={11} tickMargin={6} />
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
          <Area
            type="natural"
            dataKey={chart.key('visits')}
            fill="url(#visits-gradient)"
            stroke={chart.color('pine.solid')}
            strokeWidth={2}
            isAnimationActive={false}
          />
          {chart.data.map((d, i) =>
            d.best ? (
              <ReferenceDot key={i} x={d.month} y={d.visits} r={4} fill={chart.color('trail.solid')} stroke="none" />
            ) : null,
          )}
        </AreaChart>
      </Chart.Root>
    </Box>
  );
}

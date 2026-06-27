'use client';
import { useId } from 'react';
import { Chart, useChart } from '@chakra-ui/charts';
import { Area, AreaChart } from 'recharts';

export interface SparkPoint {
  distMi: number;
  elevFt: number;
}

/**
 * Tiny elevation sparkline for a trail card (ADR-068) — a gradient area of elevation over the downsampled
 * profile, no axes/grid/tooltip. Follows the @chakra-ui/charts `sparkline-with-gradient` pattern; the
 * gradient id is per-instance (useId) so many cards on a page don't collide on one SVG id. `responsive`
 * fills the card width at every breakpoint. Renders nothing without a profile (graceful pre-elevation-sync).
 */
export function TrailSparkline({ profile }: { profile: SparkPoint[] }) {
  const gid = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const chart = useChart({ data: profile, series: [{ name: 'elevFt', color: 'pine.solid' }] });
  if (!profile || profile.length < 2) return null;
  return (
    <Chart.Root width="full" height="8" chart={chart}>
      <AreaChart data={chart.data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} responsive>
        <defs>
          <Chart.Gradient
            id={gid}
            stops={[
              { offset: '0%', color: 'pine.solid', opacity: 0.5 },
              { offset: '100%', color: 'pine.solid', opacity: 0.04 },
            ]}
          />
        </defs>
        {chart.series.map((item) => (
          <Area
            key={item.name}
            type="natural"
            isAnimationActive={false}
            dataKey={chart.key(item.name)}
            fill={`url(#${gid})`}
            stroke={chart.color(item.color)}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </Chart.Root>
  );
}

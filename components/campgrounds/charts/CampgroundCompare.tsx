'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip, Legend } from 'recharts';
import { ChartCard } from '../../parks/charts/ChartCard';
import type { CompareDatum } from '../../../lib/camp-charts';

const SERIES_COLORS = ['pine.solid', 'trail.solid', 'sand.solid', 'blue.solid'];

/**
 * Campground comparison radar (Campgrounds feature, Phase 3 viz) — overlays 2–4 campgrounds across the fixed
 * 0–100 axes (amenities, affordability, hookups, accessibility, size, connectivity, dark sky, booking ease).
 * Pure-data-in (the `campgroundCompareData` shaper); booking-ease greys for campgrounds with unknown difficulty.
 */
export function CampgroundCompare({ data, campgrounds }: { data: CompareDatum[]; campgrounds: { key: string; name: string }[] }) {
  const chart = useChart({
    data,
    series: campgrounds.map((c, i) => ({ name: c.key, label: c.name, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
  });
  if (!data.length || !campgrounds.length) return null;
  return (
    <ChartCard title="Side-by-side" caption="How these campgrounds score across the dimensions campers care about (0–100). Booking-ease is greyed when difficulty is unknown.">
      <Chart.Root maxH="80" chart={chart} aria-label="Campground comparison radar">
        <RadarChart data={chart.data} responsive>
          <PolarGrid stroke={chart.color('border')} />
          <PolarAngleAxis dataKey={chart.key('axis')} tick={{ fontSize: 11, fill: chart.color('fg.muted') }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Legend content={<Chart.Legend />} />
          <Tooltip content={<Chart.Tooltip />} />
          {chart.series.map((s) => (
            <Radar
              key={s.name}
              name={String(s.label ?? s.name)}
              dataKey={s.name}
              stroke={chart.color(s.color)}
              fill={chart.color(s.color)}
              fillOpacity={0.18}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </RadarChart>
      </Chart.Root>
    </ChartCard>
  );
}

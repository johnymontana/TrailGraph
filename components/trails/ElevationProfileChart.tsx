'use client';
import { Chart, useChart } from '@chakra-ui/charts';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '../parks/charts/ChartCard';

export interface ProfilePoint {
  distMi: number;
  elevFt: number;
}

/**
 * Trail elevation profile (ADR-068) — a gradient area of elevation (ft) over distance (mi), the numbers
 * hikers care about. Data is the downsampled `profile` array derived from the DEM and stored in the Blob
 * Feature props (read server-side, passed in). Null when there's no profile (geometry not yet synced).
 */
export function ElevationProfileChart({
  profile,
  gainFt,
  lossFt,
}: {
  profile: ProfilePoint[];
  gainFt?: number | null;
  lossFt?: number | null;
}) {
  const chart = useChart({
    data: profile,
    series: [{ name: 'elevFt', label: 'Elevation', color: 'pine.solid' }],
  });
  if (!profile || profile.length < 2) return null;
  const caption =
    gainFt != null || lossFt != null
      ? `${gainFt != null ? `+${gainFt.toLocaleString()} ft gain` : ''}${gainFt != null && lossFt != null ? ' · ' : ''}${lossFt != null ? `−${lossFt.toLocaleString()} ft loss` : ''} — an estimate from a DEM.`
      : 'Elevation along the trail (estimate from a DEM).';
  return (
    <ChartCard title="Elevation profile" caption={caption}>
      <Chart.Root maxH="56" chart={chart} aria-label="Trail elevation profile">
        <AreaChart data={chart.data} responsive>
          <defs>
            <Chart.Gradient
              id="elev-grad"
              stops={[
                { offset: '0%', color: 'pine.solid', opacity: 0.3 },
                { offset: '100%', color: 'pine.solid', opacity: 0.04 },
              ]}
            />
          </defs>
          <CartesianGrid stroke={chart.color('border.muted')} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={chart.key('distMi')} tickLine={false} axisLine={false} fontSize={11} unit=" mi" />
          <YAxis width={56} tickLine={false} axisLine={false} fontSize={11} unit=" ft" />
          <Tooltip cursor={false} content={<Chart.Tooltip />} />
          <Area
            type="natural"
            dataKey={chart.key('elevFt')}
            name="Elevation"
            fill="url(#elev-grad)"
            stroke={chart.color('pine.solid')}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </Chart.Root>
    </ChartCard>
  );
}

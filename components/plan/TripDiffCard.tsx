'use client';
import { Badge, Box, Card, Grid, HStack, Text } from '@chakra-ui/react';

/**
 * Trip diff card (Trip Lab, ADR-056) — two of the user's trips side-by-side across drive time, dark
 * hours, entrance cost, and risk, with the better value highlighted per row. Pure presentational; the
 * metrics arrive precomputed from `tripDiff` (graph + ephemeris). Reference it in prose, don't re-list.
 */
interface Metrics {
  tripId: string;
  name: string;
  version: number;
  parentId: string | null;
  stops: number;
  parks: number;
  driveMiles: number;
  driveMinutes: number;
  darkHoursTotal: number | null;
  darkHoursAvg: number | null;
  costTotal: number;
  alertCount: number;
  riskScore: number;
  riskLabel: string;
}

function fmtMin(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

type Better = 'low' | 'high' | 'none';

export function TripDiffCard({ data }: { data: Record<string, unknown> }) {
  const a = data.a as Metrics | undefined;
  const b = data.b as Metrics | undefined;
  // Optional column labels (P1.1): a before/after edit snapshot reuses the same trip name on both sides, so
  // 'Before'/'After' read clearer than two identical names. compare_trips passes none → fall back to m.name.
  const aLabel = data.aLabel as string | undefined;
  const bLabel = data.bLabel as string | undefined;
  if (!a || !b) return null;

  const rows: { label: string; a: string; b: string; aVal: number | null; bVal: number | null; better: Better }[] = [
    { label: 'Stops', a: `${a.stops}`, b: `${b.stops}`, aVal: a.stops, bVal: b.stops, better: 'none' },
    {
      label: 'Drive',
      a: `${a.driveMiles} mi · ${fmtMin(a.driveMinutes)}`,
      b: `${b.driveMiles} mi · ${fmtMin(b.driveMinutes)}`,
      aVal: a.driveMinutes,
      bVal: b.driveMinutes,
      better: 'low',
    },
    {
      label: 'Dark hours',
      a: a.darkHoursTotal != null ? `${a.darkHoursTotal} h` : '—',
      b: b.darkHoursTotal != null ? `${b.darkHoursTotal} h` : '—',
      aVal: a.darkHoursTotal,
      bVal: b.darkHoursTotal,
      better: 'high',
    },
    { label: 'Entrance cost', a: `$${a.costTotal}`, b: `$${b.costTotal}`, aVal: a.costTotal, bVal: b.costTotal, better: 'low' },
    { label: 'Risk', a: a.riskLabel, b: b.riskLabel, aVal: a.riskScore, bVal: b.riskScore, better: 'low' },
  ];

  const winner = (aVal: number | null, bVal: number | null, better: Better): 'a' | 'b' | null => {
    if (better === 'none' || aVal == null || bVal == null || aVal === bVal) return null;
    const aWins = better === 'low' ? aVal < bVal : aVal > bVal;
    return aWins ? 'a' : 'b';
  };

  const head = (m: Metrics, label?: string) => (
    <HStack gap={2} wrap="wrap">
      <Text fontWeight="semibold" fontFamily="heading" fontSize="sm">
        {label ?? m.name}
      </Text>
      {!label && m.parentId ? (
        <Badge colorPalette="sand" size="sm">
          fork · v{m.version}
        </Badge>
      ) : null}
    </HStack>
  );

  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>
          Trip comparison
        </Text>
        <Grid templateColumns="minmax(70px, auto) 1fr 1fr" gap={2} alignItems="center">
          <Box />
          {head(a, aLabel)}
          {head(b, bLabel)}
          {rows.map((r) => {
            const w = winner(r.aVal, r.bVal, r.better);
            return (
              <Box key={r.label} display="contents">
                <Text fontSize="xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
                  {r.label}
                </Text>
                <Text fontSize="sm" fontWeight={w === 'a' ? 'semibold' : 'normal'} color={w === 'a' ? 'brand.fg' : w === 'b' ? 'fg.muted' : 'fg'}>
                  {r.a}
                </Text>
                <Text fontSize="sm" fontWeight={w === 'b' ? 'semibold' : 'normal'} color={w === 'b' ? 'brand.fg' : w === 'a' ? 'fg.muted' : 'fg'}>
                  {r.b}
                </Text>
              </Box>
            );
          })}
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

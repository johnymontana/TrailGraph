'use client';
import { Box, Text, Badge, Stack, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';

/** Renders a tool's `{kind,data}` output as a structured card (ADR-013, D5). Graph-grounded only. */
export function ToolCard({ kind, data: raw }: { kind: string; data: unknown }) {
  const data = (raw ?? {}) as Record<string, unknown>;
  // Surface tool errors instead of silently dropping them (R2 §3.1 — the blank "save as trip" turn).
  if (typeof data.error === 'string') {
    return (
      <Box borderWidth="1px" borderColor="orange.300" borderRadius="md" p={2} my={2} bg="orange.50">
        <Text fontSize="sm" color="orange.800">{data.error}</Text>
      </Box>
    );
  }
  switch (kind) {
    case 'park_card':
      return <ParkCards data={data} />;
    case 'node_results':
      return <NodeResults data={data} />;
    case 'itinerary_preview':
      return <ItineraryCard data={data} />;
    case 'alert_list':
      return <AlertList data={data} />;
    default:
      return null;
  }
}

/** True when a tool output renders nothing visible (used by ChatPanel's empty-message guard). */
export function isRenderableToolOutput(kind: string, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.error === 'string') return true;
  if (kind === 'park_card') return ((d.parks as unknown[])?.length ?? (d.park ? 1 : 0)) > 0;
  if (kind === 'node_results') return ((d.results as unknown[])?.length ?? 0) > 0;
  if (kind === 'itinerary_preview') return !!d.trip;
  if (kind === 'alert_list') return ((d.parks as unknown[])?.length ?? 0) > 0;
  return false;
}

function ParkCards({ data }: { data: Record<string, unknown> }) {
  const raw = (data.parks ?? (data.park ? [data.park] : [])) as {
    parkCode: string;
    name: string;
    designation?: string;
    matched?: string[];
  }[];
  // De-dupe by parkCode (§2.6) — the model can surface the same park more than once.
  const seen = new Set<string>();
  const parks = raw.filter((p) => (seen.has(p.parkCode) ? false : (seen.add(p.parkCode), true)));
  if (!parks.length) return null;
  return (
    <Stack gap={2} my={2}>
      {parks.map((p) => (
        <CLink key={p.parkCode} asChild _hover={{ textDecoration: 'none' }}>
          <NextLink href={`/parks/${p.parkCode}`}>
            <Box borderWidth="1px" borderRadius="md" p={3} bg="bg.panel" _hover={{ shadow: 'sm', borderColor: 'blue.300' }}>
              <Text as="span" fontWeight="semibold">{p.name}</Text>
              {p.designation ? (
                <Badge ml={2} colorPalette="blue">
                  {p.designation}
                </Badge>
              ) : null}
              {p.matched?.length ? (
                <Text fontSize="xs" color="fg.muted" mt={1}>
                  matches: {p.matched.join(', ')}
                </Text>
              ) : null}
            </Box>
          </NextLink>
        </CLink>
      ))}
    </Stack>
  );
}

/** Semantic place/person results (find_place / find_person). Each links to its related park page —
 * places/people have no detail route, so the park is the navigable target. */
function NodeResults({ data }: { data: Record<string, unknown> }) {
  const type = (data.type as 'place' | 'person') ?? 'place';
  const results = (data.results ?? []) as {
    id: string;
    title: string;
    parks?: { parkCode: string; parkName: string }[];
    isStamp?: boolean;
    tags?: string[];
  }[];
  if (!results.length) return null;
  return (
    <Stack gap={2} my={2}>
      {results.map((r) => (
        <Box key={r.id} borderWidth="1px" borderRadius="md" p={3} bg="bg.panel">
          <HStack mb={r.tags?.length || r.parks?.length ? 1 : 0} wrap="wrap" gap={2}>
            <Badge colorPalette={type === 'place' ? 'purple' : 'teal'}>{type}</Badge>
            <Text as="span" fontWeight="semibold">{r.title}</Text>
            {type === 'place' && r.isStamp ? <Badge colorPalette="orange">stamp</Badge> : null}
          </HStack>
          {type === 'person' && r.tags?.length ? (
            <Text fontSize="xs" color="fg.muted">{r.tags.slice(0, 4).join(', ')}</Text>
          ) : null}
          {r.parks?.length ? (
            <HStack wrap="wrap" gap={2} mt={1}>
              <Text fontSize="xs" color="fg.muted">at</Text>
              {r.parks.map((p) => (
                <CLink key={p.parkCode} asChild fontSize="xs" color="blue.600">
                  <NextLink href={`/parks/${p.parkCode}`}>{p.parkName}</NextLink>
                </CLink>
              ))}
            </HStack>
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}

function ItineraryCard({ data }: { data: Record<string, unknown> }) {
  const trip = data.trip as
    | { name: string; stops: ({ name?: string; parkName?: string; driveTo?: { miles: number; minutes: number } } | null)[] }
    | undefined;
  if (!trip) return null;
  const stops = (trip.stops ?? []).filter(Boolean) as {
    parkName?: string;
    name?: string;
    driveTo?: { miles: number; minutes: number };
  }[];
  return (
    <Box borderWidth="1px" borderRadius="md" p={3} my={2} bg="bg.panel">
      <Text fontWeight="semibold" mb={2}>
        {trip.name}
      </Text>
      <Stack gap={1}>
        {stops.map((s, i) => (
          <Box key={i}>
            <Text fontSize="sm">
              {i + 1}. {s.parkName ?? s.name ?? 'Stop'}
            </Text>
            {s.driveTo ? (
              <Text fontSize="xs" color="fg.muted" pl={4}>
                ↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min
              </Text>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function AlertList({ data }: { data: Record<string, unknown> }) {
  const parks = (data.parks ?? []) as { park: string; alerts: { category: string; title: string }[] }[];
  if (!parks.length) return <Text fontSize="sm" color="fg.muted" my={2}>No active Closure/Danger alerts.</Text>;
  return (
    <Stack gap={2} my={2}>
      {parks.map((p, i) => (
        <Box key={i} borderLeftWidth="4px" borderColor="orange.500" pl={3}>
          <Text fontWeight="semibold" fontSize="sm">{p.park}</Text>
          {p.alerts.map((a, j) => (
            <HStack key={j}>
              <Badge colorPalette={a.category === 'Danger' ? 'red' : 'orange'}>{a.category}</Badge>
              <Text fontSize="sm">{a.title}</Text>
            </HStack>
          ))}
        </Box>
      ))}
    </Stack>
  );
}

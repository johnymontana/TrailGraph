'use client';
import { Badge, Box, Card, Icon, Text, Stack, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuTriangleAlert } from 'react-icons/lu';

/** Renders a tool's `{kind,data}` output as a structured card (ADR-013, D5). Graph-grounded only. */
export function ToolCard({ kind, data: raw }: { kind: string; data: unknown }) {
  const data = (raw ?? {}) as Record<string, unknown>;
  // Surface tool errors instead of silently dropping them (R2 §3.1 — the blank "save as trip" turn).
  if (typeof data.error === 'string') {
    return (
      <HStack
        borderWidth="1px"
        borderColor="orange.emphasized"
        borderRadius="l2"
        p={3}
        my={2}
        bg="orange.subtle"
        gap={2}
        align="start"
      >
        <Icon as={LuTriangleAlert} color="orange.fg" mt={0.5} flexShrink={0} />
        <Text fontSize="sm" color="orange.fg">{data.error}</Text>
      </HStack>
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
            <Card.Root variant="interactive" size="sm">
              <Card.Body p={3}>
                <HStack gap={2} wrap="wrap">
                  <Text as="span" fontWeight="semibold" fontFamily="heading">{p.name}</Text>
                  {p.designation ? <Badge colorPalette="pine">{p.designation}</Badge> : null}
                </HStack>
                {p.matched?.length ? (
                  <Text fontSize="xs" color="fg.muted" mt={1}>
                    matches: {p.matched.join(', ')}
                  </Text>
                ) : null}
              </Card.Body>
            </Card.Root>
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
        <Card.Root key={r.id} variant="outline" size="sm">
          <Card.Body p={3}>
            <HStack mb={r.tags?.length || r.parks?.length ? 1 : 0} wrap="wrap" gap={2}>
              <Badge colorPalette={type === 'place' ? 'trail' : 'pine'}>{type}</Badge>
              <Text as="span" fontWeight="semibold" fontFamily="heading">{r.title}</Text>
              {type === 'place' && r.isStamp ? <Badge colorPalette="trail" variant="solid">stamp</Badge> : null}
            </HStack>
            {type === 'person' && r.tags?.length ? (
              <Text fontSize="xs" color="fg.muted">{r.tags.slice(0, 4).join(', ')}</Text>
            ) : null}
            {r.parks?.length ? (
              <HStack wrap="wrap" gap={2} mt={1}>
                <Text fontSize="xs" color="fg.muted">at</Text>
                {r.parks.map((p) => (
                  <CLink key={p.parkCode} asChild fontSize="xs" color="brand.fg">
                    <NextLink href={`/parks/${p.parkCode}`}>{p.parkName}</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
          </Card.Body>
        </Card.Root>
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
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>
          {trip.name}
        </Text>
        <Stack gap={1}>
          {stops.map((s, i) => (
            <Box key={i}>
              <HStack gap={2} align="baseline">
                <Badge colorPalette="pine" variant="solid" borderRadius="full" minW="20px" justifyContent="center">
                  {i + 1}
                </Badge>
                <Text fontSize="sm">{s.parkName ?? s.name ?? 'Stop'}</Text>
              </HStack>
              {s.driveTo ? (
                <Text fontSize="xs" color="fg.muted" pl={7}>
                  ↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min
                </Text>
              ) : null}
            </Box>
          ))}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function AlertList({ data }: { data: Record<string, unknown> }) {
  const parks = (data.parks ?? []) as { park: string; alerts: { category: string; title: string }[] }[];
  if (!parks.length) return <Text fontSize="sm" color="fg.muted" my={2}>No active Closure/Danger alerts.</Text>;
  return (
    <Stack gap={2} my={2}>
      {parks.map((p, i) => {
        const hasDanger = p.alerts.some((a) => a.category === 'Danger');
        return (
          <Box key={i} borderLeftWidth="4px" borderColor={hasDanger ? 'red.solid' : 'orange.solid'} pl={3}>
            <Text fontWeight="semibold" fontSize="sm" fontFamily="heading">{p.park}</Text>
            {p.alerts.map((a, j) => (
              <HStack key={j} gap={2} mt={0.5}>
                <Badge colorPalette={a.category === 'Danger' ? 'red' : 'orange'}>{a.category}</Badge>
                <Text fontSize="sm">{a.title}</Text>
              </HStack>
            ))}
          </Box>
        );
      })}
    </Stack>
  );
}

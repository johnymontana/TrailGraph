import { Badge, Box, Card, HStack, Icon, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuMapPin, LuRuler, LuMountain, LuClock, LuAccessibility } from 'react-icons/lu';
import type { TrailSummary } from '../../lib/queries';
import { TrailSparkline } from './TrailSparkline';

/** Difficulty → accent-bar + dot color (Chakra default palettes). easy/moderate/strenuous. */
const DIFF_COLOR: Record<string, string> = {
  easy: 'green.500',
  moderate: 'yellow.500',
  strenuous: 'red.500',
};

const ROUTE_LABEL: Record<string, string> = {
  loop: 'Loop',
  'point-to-point': 'Point-to-point',
  'out-and-back': 'Out & back',
  network: 'Network',
};

const USE_EMOJI: Record<string, string> = {
  hike: '🥾',
  bike: '🚲',
  horse: '🐎',
  ski: '⛷️',
  ada: '♿',
  water: '🛶',
  motorized: '🏍️',
};

/** Format Naismith hours as "5h 24m" / "48m". */
function formatHrs(h: number | null): string | null {
  if (h == null) return null;
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return hh > 0 ? `${hh}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

/** Trail finder card (ADR-066). Metadata-driven (geometry/profile load on the detail page). Links to the
 *  trail detail; the id carries colons so it's encoded here and decoded in the route. */
export function TrailCard({
  trail,
  profile,
}: {
  trail: TrailSummary;
  profile?: { distMi: number; elevFt: number }[];
}) {
  const bar = DIFF_COLOR[trail.difficulty ?? ''] ?? 'border.emphasized';
  const uses = trail.allowedUses.map((u) => USE_EMOJI[u]).filter(Boolean);
  const time = formatHrs(trail.estTimeHrs);
  const sourceLabel = trail.source === 'osm' ? 'OSM' : 'NPS GIS';
  const confidence = trail.dataConfidence ?? 'medium';

  return (
    <CLink asChild display="block" w="full" h="full" _hover={{ textDecoration: 'none' }}>
      <NextLink href={`/trails/${encodeURIComponent(trail.id)}`}>
        <Card.Root variant="interactive" overflow="hidden" minW={0} w="full" h="full">
          <Box h="4px" bg={bar} />
          <Card.Body p={4} gap={2.5}>
            <Stack gap={0.5} minW={0}>
              <Text fontFamily="heading" fontWeight="semibold" lineClamp={1}>
                {trail.name}
              </Text>
              <HStack gap={1} color="fg.muted" fontSize="xs" minW={0}>
                <Icon boxSize={3} flexShrink={0}><LuMapPin /></Icon>
                <Text lineClamp={1}>{trail.parkName}</Text>
              </HStack>
            </Stack>

            <HStack gap={3} fontSize="sm" flexWrap="wrap">
              <HStack gap={1.5}>
                <Box boxSize={2.5} borderRadius="full" bg={bar} />
                <Text textTransform="capitalize">{trail.difficulty ?? 'unrated'}</Text>
              </HStack>
              {trail.lengthMiles != null ? (
                <HStack gap={1}><Icon boxSize={3.5} color="fg.subtle"><LuRuler /></Icon><Text>{trail.lengthMiles} mi</Text></HStack>
              ) : null}
              {trail.elevationGainFt != null ? (
                <HStack gap={1}><Icon boxSize={3.5} color="fg.subtle"><LuMountain /></Icon><Text>{trail.elevationGainFt.toLocaleString()} ft</Text></HStack>
              ) : null}
              {time ? (
                <HStack gap={1}><Icon boxSize={3.5} color="fg.subtle"><LuClock /></Icon><Text>{time}</Text></HStack>
              ) : null}
            </HStack>

            {profile && profile.length >= 2 ? (
              <Box h="34px" mt={0.5} aria-label={`Elevation profile for ${trail.name}`}>
                <TrailSparkline profile={profile} />
              </Box>
            ) : null}

            <HStack gap={2} flexWrap="wrap">
              {trail.routeType ? (
                <Badge variant="subtle" colorPalette="trail">{ROUTE_LABEL[trail.routeType] ?? trail.routeType}</Badge>
              ) : null}
              {uses.length > 0 ? (
                <Text fontSize="sm" aria-label={`Allowed uses: ${trail.allowedUses.join(', ')}`}>{uses.join(' ')}</Text>
              ) : null}
            </HStack>

            {trail.permitRequired || trail.dogsAllowed || trail.wheelchairAccessible ? (
              <HStack gap={2} flexWrap="wrap">
                {trail.permitRequired ? (
                  <Badge colorPalette="orange" variant="solid">Permit</Badge>
                ) : null}
                {trail.dogsAllowed ? (
                  <Badge colorPalette="pine" variant="subtle">Dog-friendly</Badge>
                ) : null}
                {trail.wheelchairAccessible ? (
                  <Badge colorPalette="sand" variant="subtle" gap={1} title="Wheelchair-accessible">
                    <Icon boxSize={3}><LuAccessibility /></Icon> Accessible
                  </Badge>
                ) : null}
              </HStack>
            ) : null}

            <Text fontSize="2xs" color="fg.subtle">
              {sourceLabel} · {confidence} confidence · verify at the trailhead
            </Text>
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
  );
}

import { Badge, Box, Card, HStack, Icon, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import {
  LuMapPin,
  LuPlug,
  LuSignal,
  LuDroplets,
  LuShowerHead,
  LuTruck,
  LuAccessibility,
  LuPawPrint,
  LuMoon,
  LuTentTree,
} from 'react-icons/lu';
import type { CampgroundSummary } from '../../lib/campgrounds';
import { bookingSignal, BOOKING_BADGE_LABEL, BOOKING_PALETTE } from '../../lib/camp-booking';

/** Managing-agency → accent-bar color (mirrors TrailCard's DIFF_COLOR). */
const AGENCY_COLOR: Record<string, string> = {
  NPS: 'pine.500',
  USFS: 'green.600',
  BLM: 'sand.500',
  USACE: 'blue.500',
  STATE: 'trail.500',
  PRIVATE: 'purple.500',
};

const AGENCY_LABEL: Record<string, string> = {
  NPS: 'NPS',
  USFS: 'Forest Service',
  BLM: 'BLM',
  USACE: 'Army Corps',
  STATE: 'State',
  PRIVATE: 'Private',
};

/** Data-provenance label by `source` (NOT the managing agency). */
const SOURCE_LABEL: Record<string, string> = {
  'nps+ridb': 'NPS + RIDB',
  ridb: 'Recreation.gov',
  usfs: 'USFS GIS',
  osm: 'OSM (ODbL)',
  overture: 'Overture',
  state: 'State system',
  nps: 'NPS',
};

export interface CampAvailabilityChip {
  sitesOpen: number | null;
  total: number | null;
  state: 'ok' | 'unavailable';
}

/**
 * The availability chip is the one heavily-nullable element. Absence of availability is shown as
 * "unknown → go verify", NEVER as a positive (open/green) or false-negative (closed/red):
 *   undefined           → no chip (dates not queried)
 *   state 'unavailable' / sitesOpen null → muted "Check on recreation.gov ↗"
 *   sitesOpen === 0     → "Booked out"
 *   sitesOpen > 0       → "{open} of {total} open"
 */
function AvailabilityChip({
  availability,
  bookingUrl,
}: {
  availability?: CampAvailabilityChip;
  bookingUrl: string | null;
}) {
  if (!availability) return null;
  if (availability.state === 'unavailable' || availability.sitesOpen == null) {
    return bookingUrl ? (
      <Badge variant="surface" colorPalette="sand" alignSelf="start">
        Check on recreation.gov ↗
      </Badge>
    ) : (
      <Badge variant="surface" colorPalette="sand" alignSelf="start">
        Availability unknown
      </Badge>
    );
  }
  if (availability.sitesOpen === 0) {
    return <Badge colorPalette="red" variant="solid" alignSelf="start">Booked out</Badge>;
  }
  return (
    <Badge colorPalette="pine" variant="solid" alignSelf="start">
      {availability.sitesOpen}{availability.total != null ? ` of ${availability.total}` : ''} open
    </Badge>
  );
}

/**
 * Campground finder card (Campgrounds feature). Metadata-driven, mirroring TrailCard: a single link to the
 * detail page (id carries colons → encoded here, decoded in the route). Server component — actions
 * (Set Watch / Book / Add to trip) live on the detail page. Availability is always nullable (see above).
 */
export function CampgroundCard({
  cg,
  availability,
}: {
  cg: CampgroundSummary;
  availability?: CampAvailabilityChip;
}) {
  const bar = AGENCY_COLOR[cg.agency ?? ''] ?? 'border.emphasized';
  // No badge when the agency is unknown — a generic "Campground" chip is noise next to the card title.
  const agencyLabel = AGENCY_LABEL[cg.agency ?? ''] ?? cg.agency ?? null;
  const where = cg.parkName ?? cg.recAreaName ?? null;
  const confidence = cg.dataConfidence ?? (cg.source === 'nps+ridb' ? 'high' : 'medium');
  const sourceLabel = SOURCE_LABEL[cg.source] ?? 'NPS';
  const booking = bookingSignal(cg); // reservation vs first-come, in plain English

  return (
    <CLink asChild display="block" w="full" h="full" _hover={{ textDecoration: 'none' }}>
      <NextLink href={`/campgrounds/${encodeURIComponent(cg.id)}`}>
        <Card.Root variant="interactive" overflow="hidden" minW={0} w="full" h="full">
          <Box h="4px" bg={bar} />
          <Card.Body p={4} gap={2.5}>
            <Stack gap={0.5} minW={0}>
              <HStack justify="space-between" align="start" gap={2}>
                {/* Two lines before truncating — "Fishing Bridge RV Park" / "Gallatin Dispersed Area"
                    were clamping to "Fishing Bridge…" with plenty of card height to spare. */}
                <Text fontFamily="heading" fontWeight="semibold" lineClamp={2}>
                  {cg.name}
                </Text>
                {agencyLabel ? (
                  <Badge variant="subtle" colorPalette="trail" flexShrink={0}>{agencyLabel}</Badge>
                ) : null}
              </HStack>
              {where ? (
                <HStack gap={1} color="fg.muted" fontSize="xs" minW={0}>
                  <Icon boxSize={3} flexShrink={0}><LuMapPin /></Icon>
                  <Text lineClamp={1}>{where}</Text>
                </HStack>
              ) : null}
            </Stack>

            <HStack gap={3} fontSize="sm" flexWrap="wrap">
              {cg.totalSites != null ? <Text>{cg.totalSites} sites</Text> : null}
              {booking.kind !== 'unknown' ? (
                <Badge colorPalette={BOOKING_PALETTE[booking.kind]} variant="subtle" title={booking.detail ?? booking.label}>
                  {BOOKING_BADGE_LABEL[booking.kind]}
                </Badge>
              ) : null}
              {booking.detail ? <Text color="fg.muted" fontSize="xs">{booking.detail}</Text> : null}
              {cg.distanceMiles != null ? (
                <HStack gap={1}><Icon boxSize={3.5} color="fg.subtle"><LuMapPin /></Icon><Text>{cg.distanceMiles} mi</Text></HStack>
              ) : null}
              {cg.free ? (
                <Badge colorPalette="pine" variant="subtle">Free</Badge>
              ) : cg.feeUSD != null ? (
                <Text>${cg.feeUSD}/night</Text>
              ) : null}
            </HStack>

            {/* Amenity icon row — only those present. */}
            <HStack gap={2.5} fontSize="xs" color="fg.muted" flexWrap="wrap">
              {cg.hasHookups ? (
                <HStack gap={1}><Icon boxSize={3.5}><LuPlug /></Icon><Text>{cg.maxAmps ? `${cg.maxAmps}A` : 'Hookups'}</Text></HStack>
              ) : null}
              {cg.dumpStation ? <HStack gap={1}><Icon boxSize={3.5}><LuTruck /></Icon><Text>Dump</Text></HStack> : null}
              {cg.showers ? <Icon boxSize={3.5} aria-label="Showers"><LuShowerHead /></Icon> : null}
              {cg.drinkingWater ? <Icon boxSize={3.5} aria-label="Potable water"><LuDroplets /></Icon> : null}
              {cg.cellReception ? <Icon boxSize={3.5} aria-label="Cell reception"><LuSignal /></Icon> : null}
            </HStack>

            {cg.ada || cg.petsAllowed || cg.darkSky || cg.dispersed ? (
              <HStack gap={2} flexWrap="wrap">
                {cg.ada ? (
                  <Badge colorPalette="sand" variant="subtle" gap={1} title="Accessible sites">
                    <Icon boxSize={3}><LuAccessibility /></Icon> ADA
                  </Badge>
                ) : null}
                {cg.petsAllowed ? (
                  <Badge colorPalette="pine" variant="subtle" gap={1}><Icon boxSize={3}><LuPawPrint /></Icon> Pets</Badge>
                ) : null}
                {cg.darkSky ? (
                  <Badge colorPalette="purple" variant="subtle" gap={1}><Icon boxSize={3}><LuMoon /></Icon> Dark sky</Badge>
                ) : null}
                {cg.dispersed ? (
                  <Badge colorPalette="trail" variant="subtle" gap={1}><Icon boxSize={3}><LuTentTree /></Icon> Dispersed</Badge>
                ) : null}
              </HStack>
            ) : null}

            <AvailabilityChip availability={availability} bookingUrl={cg.reservationUrl} />

            <Text fontSize="2xs" color="fg.subtle">
              {sourceLabel} · {confidence} confidence · verify before you book
            </Text>
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
  );
}

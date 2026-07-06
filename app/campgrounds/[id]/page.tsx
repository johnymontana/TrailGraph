import type { ReactNode } from 'react';
import { Box, Badge, Button, Container, Heading, HStack, Icon, SimpleGrid, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { notFound } from 'next/navigation';
import {
  LuArrowLeft,
  LuCalendarCheck,
  LuMapPin,
  LuPlug,
  LuDollarSign,
  LuTriangleAlert,
  LuExternalLink,
  LuTentTree,
  LuAccessibility,
  LuPawPrint,
  LuMoon,
  LuShowerHead,
  LuDroplets,
  LuSignal,
  LuTruck,
} from 'react-icons/lu';
import { campgroundDetail, campsitesForCampground } from '../../../lib/campgrounds';
import { bookingSignal, BOOKING_PALETTE } from '../../../lib/camp-booking';
import { getWeather } from '../../../lib/datasources/weather';
import { recreationUrl } from '../../../lib/datasources/recreation';

/**
 * Campground detail (Campgrounds feature) — RSC. Metadata + site-level inventory + nearby trails/parks
 * from the graph; current weather from the runtime adapter. The id carries colons ('ridb:232449'), so it
 * arrives URL-encoded in prod — decode it before the lookup (the documented dynamic-param gotcha).
 *
 * Phase 1: availability + the Set-a-Camp-Watch action + the pitch-level site map are Phase-2/3 overlays;
 * here we surface the Book ↗ deep link and a "coming" note for those, so nothing ships as a dead button.
 */
export const dynamic = 'force-dynamic';

const AGENCY_LABEL: Record<string, string> = {
  NPS: 'National Park Service',
  USFS: 'Forest Service',
  BLM: 'Bureau of Land Management',
  USACE: 'Army Corps of Engineers',
  STATE: 'State Parks',
  PRIVATE: 'Private',
};

export default async function CampgroundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const cg = await campgroundDetail(id);
  if (!cg) notFound();

  const [sites, weather] = await Promise.all([
    cg.sites.length ? Promise.resolve(cg.sites) : campsitesForCampground(id).catch(() => []),
    cg.lat != null && cg.lng != null ? getWeather(cg.lat, cg.lng).catch(() => null) : Promise.resolve(null),
  ]);

  const bookUrl = cg.reservationUrl ?? (cg.ridbId ? recreationUrl(cg.ridbId) : null);
  const booking = bookingSignal(cg); // the plain-English "reservation vs first-come" answer
  const agencyLabel = cg.agencyName ?? AGENCY_LABEL[cg.agency ?? ''] ?? 'Campground';
  const where = cg.parkName ?? cg.recAreaName ?? null;
  const confidence = cg.dataConfidence ?? (cg.source === 'nps+ridb' ? 'high' : 'medium');
  const sourceLabel =
    ({
      'nps+ridb': 'NPS + Recreation.gov (RIDB)',
      ridb: 'Recreation.gov (RIDB)',
      usfs: 'USFS Recreation Sites GIS',
      osm: 'OpenStreetMap (ODbL)',
      overture: 'Overture Maps',
      state: 'State reservation system',
      nps: 'NPS Data API',
    } as Record<string, string>)[cg.source] ?? 'NPS Data API';

  // Site-mix summary from the real :Campsite inventory.
  const byType = new Map<string, number>();
  let amps30 = 0;
  let amps50 = 0;
  let adaSites = 0;
  for (const s of sites) {
    if (s.type) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
    if (s.electricAmps && s.electricAmps >= 50) amps50++;
    else if (s.electricAmps && s.electricAmps >= 30) amps30++;
    if (s.ada) adaSites++;
  }
  const typeSummary = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}`).join(' · ');

  const stat = (icon: ReactNode, label: string, value: string) => (
    <HStack gap={1.5}>
      <Icon boxSize={4} color="fg.subtle">{icon}</Icon>
      <Text fontSize="sm"><Text as="span" color="fg.muted">{label}:</Text> {value}</Text>
    </HStack>
  );

  return (
    <Container maxW="5xl" px={{ base: 4, md: 8 }} py={{ base: 6, md: 10 }}>
      <CLink asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }}>
        <NextLink href="/campgrounds"><Icon boxSize={3.5}><LuArrowLeft /></Icon> All campgrounds</NextLink>
      </CLink>

      <Stack gap={1} mt={3} mb={5}>
        <Heading as="h1" size="xl" lineHeight="1.1">{cg.name}</Heading>
        <HStack gap={2} flexWrap="wrap" color="fg.muted" fontSize="sm">
          <Badge variant="subtle" colorPalette="trail">{agencyLabel}</Badge>
          {where ? (
            <>
              <Icon boxSize={4}><LuMapPin /></Icon>
              {cg.parkCode ? (
                <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${cg.parkCode}`}>{where}</NextLink></CLink>
              ) : (
                <Text>{where}</Text>
              )}
            </>
          ) : null}
        </HStack>
      </Stack>

      {/* At-a-glance stats */}
      <HStack gap={5} flexWrap="wrap" mb={5}>
        {cg.totalSites != null ? stat(<LuTentTree />, 'Sites', String(cg.totalSites)) : null}
        {cg.sitesReservable != null ? stat(<LuTentTree />, 'Reservable', String(cg.sitesReservable)) : null}
        {cg.sitesFirstCome != null ? stat(<LuTentTree />, 'First-come', String(cg.sitesFirstCome)) : null}
        {cg.hasHookups ? stat(<LuPlug />, 'Hookups', cg.maxAmps ? `up to ${cg.maxAmps}A` : 'yes') : null}
        {cg.free ? stat(<LuDollarSign />, 'Fee', 'Free') : cg.feeUSD != null ? stat(<LuDollarSign />, 'Fee', `$${cg.feeUSD}/night`) : null}
        {cg.booksOutDays != null ? stat(<LuTriangleAlert />, 'Books out', `~${cg.booksOutDays} days ahead`) : null}
        {weather?.currentTempF != null ? (
          <HStack gap={1.5}>
            <Text fontSize="sm" aria-hidden>{weather.emoji}</Text>
            <Text fontSize="sm"><Text as="span" color="fg.muted">Now:</Text> {weather.currentTempF}°F {weather.condition}</Text>
          </HStack>
        ) : null}
      </HStack>

      {/* Amenity / accessibility badges */}
      <HStack gap={2} flexWrap="wrap" mb={5}>
        {cg.ada ? <Badge colorPalette="sand" variant="subtle" gap={1}><Icon boxSize={3}><LuAccessibility /></Icon> Accessible sites</Badge> : null}
        {cg.petsAllowed ? <Badge colorPalette="pine" variant="subtle" gap={1}><Icon boxSize={3}><LuPawPrint /></Icon> Pets</Badge> : null}
        {cg.dumpStation ? <Badge variant="subtle" gap={1}><Icon boxSize={3}><LuTruck /></Icon> Dump station</Badge> : null}
        {cg.showers ? <Badge variant="subtle" gap={1}><Icon boxSize={3}><LuShowerHead /></Icon> Showers</Badge> : null}
        {cg.drinkingWater ? <Badge variant="subtle" gap={1}><Icon boxSize={3}><LuDroplets /></Icon> Potable water</Badge> : null}
        {cg.cellReception ? <Badge variant="subtle" gap={1}><Icon boxSize={3}><LuSignal /></Icon> Cell reception</Badge> : null}
        {cg.darkSky ? <Badge colorPalette="purple" variant="subtle" gap={1}><Icon boxSize={3}><LuMoon /></Icon> Dark sky</Badge> : null}
        {cg.dispersed ? <Badge colorPalette="trail" variant="subtle" gap={1}><Icon boxSize={3}><LuTentTree /></Icon> Dispersed</Badge> : null}
      </HStack>

      {/* Booking clarity — the plain-English "do I reserve or just show up?" callout (user feedback). */}
      <Box
        colorPalette={BOOKING_PALETTE[booking.kind]}
        borderWidth="1px"
        borderColor="colorPalette.muted"
        borderLeftWidth="4px"
        borderLeftColor="colorPalette.solid"
        borderRadius="md"
        bg="colorPalette.subtle"
        p={4}
        mb={5}
      >
        <HStack gap={2} align="start">
          <Icon boxSize={4} mt={0.5} color="colorPalette.fg">
            {booking.kind === 'fcfs' ? <LuTentTree /> : booking.kind === 'unknown' ? <LuTriangleAlert /> : <LuCalendarCheck />}
          </Icon>
          <Stack gap={0.5}>
            <Text fontWeight="bold" fontSize="sm" color="colorPalette.fg">{booking.label}</Text>
            {booking.detail ? <Text fontSize="sm">{booking.detail}</Text> : null}
            {booking.kind === 'fcfs' ? (
              <Text fontSize="sm">No reservations — arrive early to claim a site.</Text>
            ) : null}
          </Stack>
        </HStack>
      </Box>

      {/* CTAs — ONE booking action (the callout above stays informational), labeled to match the booking
          kind: "Book" would contradict a first-come or unknown-booking campground. */}
      <HStack gap={3} flexWrap="wrap" mb={6}>
        {bookUrl ? (
          <Button asChild colorPalette="pine">
            <a href={bookUrl} target="_blank" rel="noopener noreferrer">
              {booking.kind === 'reservation' || booking.kind === 'mixed'
                ? 'Book on Recreation.gov'
                : booking.kind === 'fcfs'
                  ? 'View on Recreation.gov'
                  : 'Check on Recreation.gov'}{' '}
              <Icon boxSize={4}><LuExternalLink /></Icon>
            </a>
          </Button>
        ) : null}
        <Button variant="outline" disabled title="Cancellation alerts arrive with availability (coming soon)">Set a Camp Watch (soon)</Button>
      </HStack>

      {/* Site/loop map — pitch-level geometry is a later phase; degrade to a note + the inventory below. */}
      <Box h="200px" borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.panel" display="flex" alignItems="center" justifyContent="center" p={6} mb={6}>
        <Text fontSize="sm" color="fg.muted" textAlign="center">A site/loop map appears once pitch-level geometry is available. For now, see the site inventory below.</Text>
      </Box>

      {/* Site-level inventory (the differentiator) */}
      {sites.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={2}>Sites</Heading>
          {typeSummary ? <Text fontSize="sm" color="fg.muted" mb={3}>{sites.length} sites — {typeSummary}{amps30 ? ` · ${amps30} with 30A` : ''}{amps50 ? ` · ${amps50} with 50A` : ''}{adaSites ? ` · ${adaSites} ADA` : ''}</Text> : null}
          <Box borderWidth="1px" borderColor="border" borderRadius="md" overflow="hidden">
            <HStack gap={0} px={3} py={2} bg="bg.panel" fontSize="xs" fontWeight="semibold" color="fg.muted">
              <Text flex="0 0 70px">Loop</Text>
              <Text flex="0 0 80px">Site</Text>
              <Text flex="0 0 90px">Type</Text>
              <Text flex="0 0 70px">Max RV</Text>
              <Text flex="0 0 70px">Electric</Text>
              <Text flex="1">Notes</Text>
            </HStack>
            <Box maxH="420px" overflowY="auto">
              {sites.slice(0, 200).map((s) => (
                <HStack key={s.id} gap={0} px={3} py={1.5} fontSize="sm" borderTopWidth="1px" borderColor="border">
                  <Text flex="0 0 70px" color="fg.muted">{s.loop ?? '—'}</Text>
                  <Text flex="0 0 80px">{s.number ?? '—'}</Text>
                  <Text flex="0 0 90px" textTransform="capitalize">{s.type ?? '—'}</Text>
                  <Text flex="0 0 70px">{s.maxRvLengthFt ? `${s.maxRvLengthFt} ft` : '—'}</Text>
                  <Text flex="0 0 70px">{s.electricAmps ? `${s.electricAmps}A` : '—'}</Text>
                  <HStack flex="1" gap={1.5} flexWrap="wrap" fontSize="xs" color="fg.muted">
                    {s.maxPeople != null ? <Text>up to {s.maxPeople} people</Text> : null}
                    {s.hasWater ? <Text>water</Text> : null}
                    {s.hasSewer ? <Text>sewer</Text> : null}
                    {s.pullThrough ? <Text>pull-through</Text> : null}
                    {s.campfireAllowed != null ? <Text>{s.campfireAllowed ? 'campfire ok' : 'no campfires'}</Text> : null}
                    {s.shade ? <Text>shade</Text> : null}
                    {s.ada ? <Text>ADA</Text> : null}
                    {s.reservable ? <Text>reservable</Text> : <Text>first-come</Text>}
                  </HStack>
                </HStack>
              ))}
            </Box>
          </Box>
          {sites.length > 200 ? <Text fontSize="xs" color="fg.subtle" mt={1}>Showing 200 of {sites.length} sites.</Text> : null}
        </Box>
      ) : null}

      {/* Amenities */}
      {cg.amenities.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>Amenities</Heading>
          <HStack gap={2} flexWrap="wrap">
            {cg.amenities.map((a) => (
              <Badge key={a.id} variant="outline">{a.name}</Badge>
            ))}
          </HStack>
        </Box>
      ) : null}

      {/* Nearby trails + park entrance */}
      {cg.nearTrails.length > 0 || cg.nearParks.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>Nearby</Heading>
          <Stack gap={2}>
            {cg.nearParks.length > 0 ? (
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="sm" color="fg.muted">Parks:</Text>
                {cg.nearParks.slice(0, 6).map((p) => (
                  <CLink key={p.parkCode} asChild color="brand.fg" fontSize="sm">
                    <NextLink href={`/parks/${p.parkCode}`}>{p.name} ({p.miles} mi)</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
            {cg.nearTrails.length > 0 ? (
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="sm" color="fg.muted">Trailheads:</Text>
                {cg.nearTrails.map((t) => (
                  <CLink key={t.id} asChild color="brand.fg" fontSize="sm">
                    <NextLink href={`/trails/${encodeURIComponent(t.id)}`}>{t.name} ({t.miles} mi)</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {/* Safety + provenance */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.panel" p={4} mb={6}>
        <HStack gap={2} mb={1}><Icon color="orange.fg"><LuTriangleAlert /></Icon><Text fontWeight="semibold" fontSize="sm">Verify before you book or tow</Text></HStack>
        <Text fontSize="sm" color="fg.muted">
          Site counts, RV length limits, hookups, and accessibility are reported by the operator and merged from
          {' '}{sourceLabel} ({confidence} confidence) — they change. Confirm current rates, closures, fire bans, and
          length limits on Recreation.gov or with the managing agency before you rely on them.
          {cg.dispersed ? ' This is dispersed camping: no reservation, stay limits apply, pack it in / pack it out (Leave No Trace).' : ''}
        </Text>
      </Box>

      <HStack gap={4} flexWrap="wrap">
        {cg.parkCode ? <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${cg.parkCode}`}>View {cg.parkName} →</NextLink></CLink> : null}
        <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href="/campgrounds">Find more campgrounds →</NextLink></CLink>
      </HStack>
    </Container>
  );
}

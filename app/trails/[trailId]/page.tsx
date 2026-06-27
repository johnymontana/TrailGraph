import type { ReactNode } from 'react';
import { Box, Badge, Container, Heading, HStack, Icon, SimpleGrid, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { notFound } from 'next/navigation';
import type { MultiLineString } from 'geojson';
import {
  LuArrowLeft,
  LuMapPin,
  LuRuler,
  LuMountain,
  LuClock,
  LuAccessibility,
  LuTriangleAlert,
  LuTentTree,
  LuSquareParking,
} from 'react-icons/lu';
import { trailDetail, connectedTrails, parkTrailNetwork, trailCrossLinks } from '../../../lib/queries';
import { suggestLoops } from '../../../lib/loop-builder';
import { readParkTrails } from '../../../lib/blob-trails';
import { TrailRouteMap } from '../../../components/trails/TrailRouteMap';
import { ElevationProfileChart, type ProfilePoint } from '../../../components/trails/ElevationProfileChart';

/**
 * Trail detail (ADR-066) — RSC. Metadata + logistics from the graph; geometry + elevation profile from the
 * park's Blob FC (degrades to a note when a park hasn't been trail-synced). The id carries colons, so it
 * arrives URL-encoded in prod — decode it before the lookup (the documented dynamic-param gotcha).
 */
export const dynamic = 'force-dynamic';

const DIFF_COLOR: Record<string, string> = { easy: 'green.500', moderate: 'yellow.500', strenuous: 'red.500' };
const ROUTE_LABEL: Record<string, string> = {
  loop: 'Loop',
  'point-to-point': 'Point-to-point',
  'out-and-back': 'Out & back',
  network: 'Network',
};

function formatHrs(h: number | null): string | null {
  if (h == null) return null;
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return hh > 0 ? `${hh}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

export default async function TrailDetailPage({ params }: { params: Promise<{ trailId: string }> }) {
  const { trailId: raw } = await params;
  const trailId = decodeURIComponent(raw);
  const t = await trailDetail(trailId);
  if (!t) notFound();

  // Geometry + downsampled elevation profile live in the park's Blob FC (read server-side, passed to the
  // client map/chart). Absent for parks not yet trail-synced → the UI degrades to a note.
  const fc = await readParkTrails(t.parkCode, t.geoUrl);
  const feature = fc?.features?.find((f) => (f.properties as { id?: string } | null)?.id === t.id) ?? null;
  const geometry =
    feature?.geometry && feature.geometry.type === 'MultiLineString' ? (feature.geometry as MultiLineString) : null;
  const profile = (feature?.properties as { profile?: ProfilePoint[] } | null)?.profile ?? null;

  // Phase 4 (ADR-072): connected trails + suggested loops involving THIS trail + Learn/Journeys cross-links.
  const [connections, network, crossLinks] = await Promise.all([
    connectedTrails(trailId),
    parkTrailNetwork(t.parkCode),
    trailCrossLinks(trailId),
  ]);
  const loops = suggestLoops(network.trails, network.connections)
    .filter((l) => l.trailIds.includes(t.id))
    .slice(0, 4);

  const bar = DIFF_COLOR[t.difficulty ?? ''] ?? 'border.emphasized';
  const time = formatHrs(t.estTimeHrs);
  const sourceLabel = t.source === 'osm' ? 'OpenStreetMap (ODbL)' : 'NPS Public Trails GIS';

  const stat = (icon: ReactNode, label: string, value: string) => (
    <HStack gap={1.5}>
      <Icon boxSize={4} color="fg.subtle">{icon}</Icon>
      <Text fontSize="sm"><Text as="span" color="fg.muted">{label}:</Text> {value}</Text>
    </HStack>
  );

  return (
    <Container maxW="5xl" px={{ base: 4, md: 8 }} py={{ base: 6, md: 10 }}>
      <CLink asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }}>
        <NextLink href="/trails"><Icon boxSize={3.5}><LuArrowLeft /></Icon> All trails</NextLink>
      </CLink>

      <Stack gap={1} mt={3} mb={5}>
        <Heading as="h1" size="xl" lineHeight="1.1">{t.name}</Heading>
        <HStack gap={2} flexWrap="wrap" color="fg.muted" fontSize="sm">
          <Icon boxSize={4}><LuMapPin /></Icon>
          <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${t.parkCode}`}>{t.parkName}</NextLink></CLink>
          <Text>·</Text>
          <HStack gap={1.5}><Box boxSize={2.5} borderRadius="full" bg={bar} /><Text textTransform="capitalize">{t.difficulty ?? 'unrated'}</Text></HStack>
        </HStack>
      </Stack>

      {/* At-a-glance stats */}
      <HStack gap={5} flexWrap="wrap" mb={5}>
        {t.lengthMiles != null ? stat(<LuRuler />, 'Length', `${t.lengthMiles} mi`) : null}
        {time ? stat(<LuClock />, 'Est. time', time) : null}
        {t.elevationGainFt != null ? stat(<LuMountain />, 'Gain', `${t.elevationGainFt.toLocaleString()} ft`) : null}
        {t.elevationLossFt != null ? stat(<LuMountain />, 'Loss', `${t.elevationLossFt.toLocaleString()} ft`) : null}
        {t.maxElevationFt != null ? stat(<LuMountain />, 'Max elev', `${t.maxElevationFt.toLocaleString()} ft`) : null}
      </HStack>

      <HStack gap={2} flexWrap="wrap" mb={6}>
        {t.routeType ? <Badge variant="subtle" colorPalette="trail">{ROUTE_LABEL[t.routeType] ?? t.routeType}</Badge> : null}
        {t.trailClass != null ? <Badge variant="subtle">Trail class {t.trailClass}</Badge> : null}
        {t.surface ? <Badge variant="subtle">{t.surface}</Badge> : null}
        {t.allowedUses.map((u) => (
          <Badge key={u} variant="outline" textTransform="capitalize">{u}</Badge>
        ))}
        {t.permitRequired ? <Badge colorPalette="orange" variant="solid">Permit required</Badge> : null}
        {t.dogsAllowed ? <Badge colorPalette="pine" variant="subtle">Dog-friendly</Badge> : null}
        {t.wheelchairAccessible ? (
          <Badge colorPalette="sand" variant="subtle" gap={1}><Icon boxSize={3}><LuAccessibility /></Icon> Accessible</Badge>
        ) : null}
      </HStack>

      {/* Route map + elevation profile (from Blob geometry; degrade gracefully when unsynced). */}
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={5} mb={6}>
        <Box>
          {geometry ? (
            <TrailRouteMap geometry={geometry} trailheadLat={t.trailheadLat} trailheadLng={t.trailheadLng} difficulty={t.difficulty} />
          ) : (
            <Box h="320px" borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.panel" display="flex" alignItems="center" justifyContent="center" p={6}>
              <Text fontSize="sm" color="fg.muted" textAlign="center">The route map appears once this park&apos;s trail geometry is synced from NPS GIS.</Text>
            </Box>
          )}
        </Box>
        <Box>
          {profile && profile.length >= 2 ? (
            <ElevationProfileChart profile={profile} gainFt={t.elevationGainFt} lossFt={t.elevationLossFt} />
          ) : (
            <Box h="320px" borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.panel" display="flex" alignItems="center" justifyContent="center" p={6}>
              <Text fontSize="sm" color="fg.muted" textAlign="center">
                {t.elevationGainFt != null
                  ? `Total gain ${t.elevationGainFt.toLocaleString()} ft. The full elevation profile appears once geometry is synced.`
                  : 'Elevation profile appears once this trail is synced + sampled against a DEM.'}
              </Text>
            </Box>
          )}
        </Box>
      </SimpleGrid>

      {/* Logistics: trailhead parking + nearby services */}
      {t.trailheads.length > 0 || t.nearby.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>Trailhead &amp; logistics</Heading>
          <Stack gap={2}>
            {t.trailheads.map((th, i) => (
              <HStack key={`th-${i}`} gap={2} fontSize="sm">
                <Icon boxSize={4} color="fg.subtle"><LuSquareParking /></Icon>
                <Text>{th.name ?? 'Trailhead parking'}{th.kind ? ` (${th.kind})` : ''}{th.accessibleSpaces != null ? ` · ${th.accessibleSpaces} accessible spaces` : ''}</Text>
              </HStack>
            ))}
            {t.nearby.map((n, i) => (
              <HStack key={`nb-${i}`} gap={2} fontSize="sm">
                <Icon boxSize={4} color="fg.subtle"><LuTentTree /></Icon>
                <Text>{n.name}{n.kind ? ` (${n.kind})` : ''}</Text>
              </HStack>
            ))}
          </Stack>
        </Box>
      ) : null}

      {/* Curated NPS "recommended hike" detail joined from :ThingToDo */}
      {t.curated.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>What to know</Heading>
          <Stack gap={3}>
            {t.curated.map((c) => (
              <Box key={c.id} fontSize="sm" color="fg.muted">
                <Text fontWeight="medium" color="fg">{c.title}</Text>
                <HStack gap={3} flexWrap="wrap" mt={1}>
                  {c.durationText ? <Text>⏱ {c.durationText}</Text> : null}
                  {c.season.length > 0 ? <Text textTransform="capitalize">🗓 {c.season.join(', ')}</Text> : null}
                  {c.petsAllowed != null ? <Text>🐾 {c.petsAllowed ? 'Pets OK' : 'No pets'}</Text> : null}
                  {c.feesApply != null ? <Text>💵 {c.feesApply ? 'Fees apply' : 'No fee'}</Text> : null}
                </HStack>
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}

      {/* Build a loop (ADR-072 Phase 4) — loops that include this trail + the connected-trail network. */}
      {loops.length > 0 || connections.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>Build a loop</Heading>
          {loops.length > 0 ? (
            <Stack gap={2} mb={connections.length ? 3 : 0}>
              {loops.map((l) => (
                <HStack key={l.trailIds.join('|')} gap={2} flexWrap="wrap">
                  <Badge colorPalette="trail" variant="surface">{l.kind === 'pair' ? 'stitched loop' : 'loop'}</Badge>
                  <Text fontSize="sm" fontWeight="medium">{l.names.join(' + ')}</Text>
                  <Text fontSize="sm" color="fg.muted">
                    {l.lengthMiles} mi · +{l.elevationGainFt.toLocaleString()} ft · ~{l.estTimeHrs} hr (est.)
                  </Text>
                </HStack>
              ))}
            </Stack>
          ) : null}
          {connections.length > 0 ? (
            <HStack gap={2} flexWrap="wrap">
              <Text fontSize="sm" color="fg.muted">Connects to:</Text>
              {connections.map((c) => (
                <CLink key={c.id} asChild color="brand.fg" fontSize="sm">
                  <NextLink href={`/trails/${encodeURIComponent(c.id)}`}>{c.name}</NextLink>
                </CLink>
              ))}
            </HStack>
          ) : null}
        </Box>
      ) : null}

      {/* Connect the dots (ADR-072 Phase 4) — Trail ↔ Learn ↔ Journeys cross-links. */}
      {crossLinks.lessons.length > 0 || crossLinks.people.length > 0 || crossLinks.topics.length > 0 ? (
        <Box mb={6}>
          <Heading as="h2" size="md" mb={3}>Connect the dots</Heading>
          <Stack gap={2}>
            {crossLinks.lessons.length > 0 ? (
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="sm" color="fg.muted">Learn:</Text>
                {crossLinks.lessons.map((l) => (
                  <CLink key={l.id} asChild color="brand.fg" fontSize="sm">
                    <NextLink href={`/learn/${encodeURIComponent(l.id)}`}>{l.title}</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
            {crossLinks.people.length > 0 ? (
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="sm" color="fg.muted">Journeys:</Text>
                {crossLinks.people.map((p) => (
                  <CLink key={p.id} asChild color="brand.fg" fontSize="sm">
                    <NextLink href={`/journeys?person=${encodeURIComponent(p.title)}`}>{p.title}</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
            {crossLinks.topics.length > 0 ? (
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="sm" color="fg.muted">Themes:</Text>
                {crossLinks.topics.map((tp) => (
                  <CLink key={tp} asChild _hover={{ textDecoration: 'none' }}>
                    <NextLink href={`/journeys?topic=${encodeURIComponent(tp)}`}>
                      <Badge colorPalette="sand" variant="subtle" cursor="pointer" _hover={{ bg: 'sand.muted' }}>{tp}</Badge>
                    </NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {/* Safety + provenance (verifier honesty, ADR-069) */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.panel" p={4} mb={6}>
        <HStack gap={2} mb={1}><Icon color="orange.fg"><LuTriangleAlert /></Icon><Text fontWeight="semibold" fontSize="sm">Plan smart, verify on site</Text></HStack>
        <Text fontSize="sm" color="fg.muted">
          Length, elevation, and difficulty are estimates derived from open data ({sourceLabel}
          {t.dataConfidence ? `, ${t.dataConfidence} confidence` : ''}) — not a safety guarantee. Conditions
          change; check current closures, weather, and water, and carry the essentials.
          {t.permitRequired ? ' A permit is required for this trail — reserve ahead via Recreation.gov.' : ''}{' '}
          Always defer to NPS.gov and park rangers.
        </Text>
      </Box>

      {/* Actions — add-to-trip / GPX / save arrive with trip planning (Phase 3). */}
      <HStack gap={4} flexWrap="wrap">
        <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${t.parkCode}`}>View {t.parkName} →</NextLink></CLink>
        <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href="/trails">Find more trails →</NextLink></CLink>
      </HStack>
    </Container>
  );
}

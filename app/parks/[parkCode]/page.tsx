import { notFound } from 'next/navigation';
import {
  Box,
  Heading,
  Text,
  Stack,
  HStack,
  Badge,
  SimpleGrid,
  Link as CLink,
  Separator,
} from '@chakra-ui/react';
import NextImage from 'next/image';
import { parkDetail, similarParks, nearbyParks, oftenPlannedTogether, parkGraph } from '../../../lib/queries';
import { darkSkyRating, monthNames, difficultyDot, getWeather, type Difficulty } from '../../../lib/datasources';
import { explainForParks } from '../../../lib/explain';
import { getServerUserId } from '../../../lib/session';
import { MiniMap } from '../../../components/MiniMap';
import { RecordView } from '../../../components/RecordView';
import { ChipList } from '../../../components/ChipList';
import { ParkActions } from '../../../components/ParkActions';
import { ParkCard } from '../../../components/ParkCard';
import { VisitationChart } from '../../../components/parks/VisitationChart';
import { ParkGraph } from '../../../components/parks/ParkGraph';

export const dynamic = 'force-dynamic';

const ALERT_COLOR: Record<string, string> = {
  Danger: 'red',
  Closure: 'orange',
  Caution: 'yellow',
  Information: 'blue',
};

export default async function ParkPage({ params }: { params: Promise<{ parkCode: string }> }) {
  const { parkCode } = await params;
  const park = await parkDetail(parkCode);
  if (!park) notFound();

  const [similar, nearby, together, graph, weather] = await Promise.all([
    similarParks(parkCode).catch(() => []),
    nearbyParks(parkCode).catch(() => []),
    oftenPlannedTogether(parkCode).catch(() => []),
    parkGraph(parkCode, { parkName: park.name as string }).catch(() => ({ nodes: [], relationships: [] })),
    park.lat != null && park.lng != null
      ? getWeather(park.lat as number, park.lng as number).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Personalized rationale (§5f): "because you liked …" on related cards, for signed-in users.
  const userId = await getServerUserId();
  const rationale: Record<string, string[]> = userId
    ? await explainForParks(userId, [...similar, ...nearby, ...together].map((p) => p.parkCode)).catch(
        () => ({}) as Record<string, string[]>,
      )
    : {};
  const because = (code: string) => {
    const m = rationale[code];
    return m && m.length ? `Because you liked ${m.slice(0, 3).join(', ')}` : null;
  };

  const images = park.images as { url: string; altText?: string }[];
  const campgrounds = park.campgrounds as { id: string; name: string; reservationUrl: string | null }[];
  const visitorCenters = park.visitorCenters as { id: string; name: string }[];
  const thingsToDo = park.thingsToDo as {
    id: string;
    title: string;
    difficulty: Difficulty | null;
    length: number | null;
    elevationGain: number | null;
  }[];
  const bestMonths = park.bestMonths as number[];
  const monthlyVisits = park.monthlyVisits as number[];
  const dark = park.bortleScale != null ? darkSkyRating(park.bortleScale as number) : null;
  const fees = park.entranceFees as { cost: string; title: string; description: string }[];
  // "At a glance" strip data (R4 §3): dark-sky, difficulty range, fee.
  const diffOrder: Record<string, number> = { easy: 0, moderate: 1, strenuous: 2 };
  const difficulties = [...new Set(thingsToDo.map((n) => n.difficulty).filter(Boolean) as Difficulty[])].sort(
    (a, b) => diffOrder[a] - diffOrder[b],
  );
  const feeLabel = fees.length ? `$${Math.round(Number(fees[0].cost))}` : 'Free entry';
  const hours = park.operatingHours as { name: string; description: string }[];

  return (
    <Box maxW="5xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      <RecordView parkCode={parkCode} />
      <Box
        position="relative"
        h="320px"
        w="100%"
        mb={5}
        borderRadius="lg"
        overflow="hidden"
        bgGradient="to-br"
        gradientFrom="green.600"
        gradientTo="blue.700"
      >
        {images[0]?.url ? (
          <NextImage
            src={images[0].url}
            alt={images[0].altText ?? String(park.name)}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <Box position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center">
            <Text fontSize="2xl" color="whiteAlpha.900">🏞️ {park.name as string}</Text>
          </Box>
        )}
      </Box>

      <Heading as="h1" size="xl">{park.name as string}</Heading>
      <HStack mt={2} gap={3}>
        {park.designation ? <Badge colorPalette="blue">{park.designation as string}</Badge> : null}
        <Text color="fg.muted">
          {(park.states as { name: string }[]).map((s) => s.name).filter(Boolean).join(', ')}
        </Text>
      </HStack>

      {/* "At a glance" — surface the new data right under the title (R4 §3). */}
      <HStack mt={2} mb={4} gap={5} wrap="wrap" fontSize="sm" color="fg.muted">
        {dark ? (
          <HStack gap={1}><Text aria-hidden>⭐</Text><Text>{dark.label}</Text></HStack>
        ) : null}
        {difficulties.length ? (
          <HStack gap={1}><Text aria-hidden>🥾</Text><Text>{difficulties.map(difficultyDot).join(' ')} hikes</Text></HStack>
        ) : null}
        {park.crowdLevel ? (
          <HStack gap={1}><Text aria-hidden>👥</Text><Text>{park.crowdLevel as string} crowds</Text></HStack>
        ) : null}
        <HStack gap={1}><Text aria-hidden>🎟️</Text><Text>{feeLabel}</Text></HStack>
        {park.timedEntry ? (
          <CLink href={(park.permitUrl as string) ?? 'https://www.recreation.gov/timed-entry'} gap={1} display="inline-flex" alignItems="center" color="fg.muted">
            <Text aria-hidden>🎫</Text><Text>Timed entry</Text>
          </CLink>
        ) : null}
      </HStack>

      <Box mb={5}>
        <ParkActions parkCode={parkCode} />
      </Box>

      {/* Active alerts — color-coded; we surface but defer to NPS for safety (NG2) */}
      {park.alerts.length > 0 ? (
        <Stack mb={5} gap={2}>
          {park.alerts.map((a) => (
            <Box key={a.id} borderLeftWidth="4px" borderColor={`${ALERT_COLOR[a.category] ?? 'gray'}.500`} bg="bg.subtle" p={3} borderRadius="md">
              <HStack>
                <Badge colorPalette={ALERT_COLOR[a.category] ?? 'gray'}>{a.category}</Badge>
                <Text fontWeight="semibold">{a.title}</Text>
              </HStack>
              {a.description ? <Text fontSize="sm" mt={1} color="fg.muted">{a.description}</Text> : null}
              {a.url ? <CLink href={a.url} fontSize="sm" color="blue.600">Official NPS alert →</CLink> : null}
            </Box>
          ))}
        </Stack>
      ) : null}

      <Text mb={6}>{park.description as string}</Text>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={8}>
        <Stack gap={6}>
          {park.activities.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Activities</Heading>
              <ChipList items={park.activities as string[]} param="activity" />
            </Box>
          ) : null}

          {park.topics.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Topics</Heading>
              <ChipList items={park.topics as string[]} param="topic" colorPalette="green" />
            </Box>
          ) : null}

          {fees.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Entrance fees</Heading>
              <Stack gap={1}>
                {fees.map((fee, i) => (
                  <Text key={i} fontSize="sm">
                    <b>${fee.cost}</b> — {fee.title}
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : (
            <Text fontSize="sm" color="fg.muted">No entrance fee.</Text>
          )}

          {hours[0]?.description ? (
            <Box>
              <Heading size="sm" mb={2}>Hours</Heading>
              <Text fontSize="sm" color="fg.muted">{hours[0].description}</Text>
            </Box>
          ) : null}
        </Stack>

        <Stack gap={4}>
          {park.lat != null && park.lng != null ? (
            <MiniMap lat={park.lat as number} lng={park.lng as number} label={park.name as string} />
          ) : null}
          <HStack>
            {park.url ? <CLink href={park.url as string} color="blue.600">Official site →</CLink> : null}
            {park.directionsUrl ? <CLink href={park.directionsUrl as string} color="blue.600">Directions →</CLink> : null}
          </HStack>

          {/* §5 conditions: dark sky + best time/crowds (structured, from the data-source adapters). */}
          {dark || bestMonths.length > 0 || park.crowdLevel || monthlyVisits.length === 12 || weather ? (
            <Box>
              <Heading size="sm" mb={2}>Conditions</Heading>
              <Stack gap={3} fontSize="sm">
                {dark ? (
                  <HStack>
                    <Badge colorPalette="purple">
                      {'★'.repeat(dark.stars)}
                      {'☆'.repeat(5 - dark.stars)}
                    </Badge>
                    <Text>
                      {dark.label}
                      {park.darkSkyCertified ? ' · DarkSky-certified' : ''} (Bortle {park.bortleScale as number})
                    </Text>
                  </HStack>
                ) : null}
                {bestMonths.length > 0 ? (
                  <Text>
                    <Text as="span" color="fg.muted">Best time to visit (fewer crowds): </Text>
                    {monthNames(bestMonths)}
                  </Text>
                ) : null}
                {park.crowdLevel ? (
                  <Text>
                    <Text as="span" color="fg.muted">Typical crowds: </Text>
                    {park.crowdLevel as string}
                  </Text>
                ) : null}
                {weather ? (
                  <Box>
                    <Text>
                      <Text as="span" color="fg.muted">Weather now: </Text>
                      {weather.emoji} {weather.condition}
                      {weather.currentTempF != null ? `, ${weather.currentTempF}°F` : ''}
                    </Text>
                    {weather.daily.length > 0 ? (
                      <HStack gap={3} mt={1} color="fg.muted" fontSize="xs" wrap="wrap">
                        {weather.daily.map((d) => (
                          <Text key={d.date}>{d.emoji} {d.hiF}°/{d.loF}°</Text>
                        ))}
                      </HStack>
                    ) : null}
                  </Box>
                ) : null}
                {monthlyVisits.length === 12 ? (
                  <VisitationChart monthly={monthlyVisits} bestMonths={bestMonths} parkName={park.name as string} />
                ) : null}
              </Stack>
            </Box>
          ) : null}

          {/* Park-local data, previously only on the map (§7) */}
          {thingsToDo.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Things to do</Heading>
              <Stack gap={1}>
                {thingsToDo.slice(0, 8).map((n) => (
                  <Text key={n.id} fontSize="sm">
                    {n.difficulty ? `${difficultyDot(n.difficulty)} ` : ''}{n.title}
                    {n.length != null ? <Text as="span" color="fg.muted"> · {n.length} mi</Text> : null}
                    {n.elevationGain != null ? <Text as="span" color="fg.muted"> · {n.elevationGain} ft gain</Text> : null}
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : null}
          {campgrounds.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Campgrounds</Heading>
              <Stack gap={1}>
                {campgrounds.map((c) => (
                  <Text key={c.id} fontSize="sm">
                    {c.reservationUrl ? (
                      <CLink href={c.reservationUrl} color="blue.600">{c.name} ↗</CLink>
                    ) : (
                      c.name
                    )}
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : null}
          {visitorCenters.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Visitor centers</Heading>
              <Stack gap={1}>
                {visitorCenters.map((v) => (
                  <Text key={v.id} fontSize="sm">{v.name}</Text>
                ))}
              </Stack>
            </Box>
          ) : null}

          <Separator />
          <Text fontSize="xs" color="fg.muted">
            Not an official safety source — always defer to NPS.gov and rangers for life-safety decisions.
          </Text>
        </Stack>
      </SimpleGrid>

      {/* Interactive one-hop graph (NVL) — the park's immediate connections, traversable. */}
      <ParkGraph data={graph} parkName={park.name as string} />

      {/* Related parks — the graph made visible (§6) */}
      {similar.length > 0 ? (
        <Box mt={12}>
          <Heading size="md" mb={1}>Similar parks</Heading>
          <Text fontSize="sm" color="fg.muted" mb={3}>Share activities & topics with {park.name as string}.</Text>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
            {similar.map((p) => (
              <Box key={p.parkCode} minW={0}>
                <ParkCard park={p} />
                {because(p.parkCode) ? (
                  <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1} title="See this in Your memory">
                    {because(p.parkCode)}
                  </CLink>
                ) : null}
              </Box>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      {nearby.length > 0 ? (
        <Box mt={10}>
          <Heading size="md" mb={3}>Nearby parks</Heading>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
            {nearby.map((p) => (
              <Box key={p.parkCode} minW={0}>
                <ParkCard park={p} miles={p.miles} />
                {because(p.parkCode) ? (
                  <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1} title="See this in Your memory">
                    {because(p.parkCode)}
                  </CLink>
                ) : null}
              </Box>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      {together.length > 0 ? (
        <Box mt={10}>
          <Heading size="md" mb={1}>Often planned together</Heading>
          <Text fontSize="sm" color="fg.muted" mb={3}>Parks travelers add to the same trip as {park.name as string}.</Text>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
            {together.map((p) => (
              <ParkCard key={p.parkCode} park={p} />
            ))}
          </SimpleGrid>
        </Box>
      ) : null}
    </Box>
  );
}

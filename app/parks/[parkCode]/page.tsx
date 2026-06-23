import { notFound } from 'next/navigation';
import {
  Box,
  Card,
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
import { LuCalendar, LuFootprints, LuStar, LuTicket, LuUsers } from 'react-icons/lu';
import { StatCard } from '../../../components/ui/stat-card';
import { parkDetail, similarParks, nearbyParks, oftenPlannedTogether, parkGraph, peopleForPark, toursForPark, stampsForPark, eventsForPark, placesForPark, articlesForPark, parkingForPark } from '../../../lib/queries';
import { getAvailability } from '../../../lib/bridges';
import { darkSkyRating, monthNames, difficultyDot, getWeather, getConditions, type Difficulty } from '../../../lib/datasources';
import { explainForParks } from '../../../lib/explain';
import { getServerUserId } from '../../../lib/session';
import { MiniMap } from '../../../components/MiniMap';
import { RecordView } from '../../../components/RecordView';
import { ChipList } from '../../../components/ChipList';
import { ParkActions } from '../../../components/ParkActions';
import { ParkCard } from '../../../components/ParkCard';
import { VisitationChart } from '../../../components/parks/VisitationChart';
import { ParkGraph } from '../../../components/parks/ParkGraph';
import { TourList } from '../../../components/parks/TourList';
import { StampList } from '../../../components/parks/StampList';
import { Placeholder } from '../../../components/Placeholder';
import { cleanTags } from '../../../lib/people';

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

  const [similar, nearby, together, graph, weather, people, tours, conditions, places, articles, parking] = await Promise.all([
    similarParks(parkCode).catch(() => []),
    nearbyParks(parkCode).catch(() => []),
    oftenPlannedTogether(parkCode).catch(() => []),
    parkGraph(parkCode, { parkName: park.name as string }).catch(() => ({ nodes: [], relationships: [] })),
    park.lat != null && park.lng != null
      ? getWeather(park.lat as number, park.lng as number).catch(() => null)
      : Promise.resolve(null),
    peopleForPark(parkCode).catch(() => [] as { id: string; title: string; tags: string[] }[]),
    toursForPark(parkCode).catch(() => [] as { id: string; title: string; description: string | null; stops: number }[]),
    getConditions(parkCode).catch(() => ({ webcams: [], roadEvents: [] })),
    placesForPark(parkCode).catch(() => [] as { id: string; title: string; image: string | null; audioDescription: string | null; isStamp: boolean }[]),
    articlesForPark(parkCode).catch(() => [] as { id: string; title: string; url: string | null; description: string | null }[]),
    parkingForPark(parkCode).catch(() => [] as { id: string; name: string; wheelchairAccessible: boolean }[]),
  ]);

  // Personalized rationale (§5f): "because you liked …" on related cards, for signed-in users.
  const userId = await getServerUserId();
  // Passport stamps at this park + the user's collection state (NPS-expansion P2 #8).
  const stamps = await stampsForPark(parkCode, userId).catch(
    () => [] as { id: string; label: string; collected: boolean }[],
  );
  // Events, intersected with the user's saved travel window (NPS-expansion P2 #7).
  const availability = userId
    ? await getAvailability(userId).catch(() => ({ start: null, end: null }))
    : { start: null, end: null };
  const events = await eventsForPark(parkCode, availability).catch(
    () => [] as { id: string; title: string; dateStart: string | null; dateEnd: string | null; inWindow: boolean }[],
  );
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
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const diffRange = difficulties.length
    ? difficulties.length > 1
      ? `${cap(difficulties[0])}–${cap(difficulties[difficulties.length - 1])}`
      : cap(difficulties[0])
    : null;
  const statesLabel = (park.states as { name: string }[]).map((s) => s.name).filter(Boolean).join(', ');
  const hours = park.operatingHours as { name: string; description: string }[];

  return (
    <Box maxW="5xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      <RecordView parkCode={parkCode} />
      {/* Hero — image with a scrim and the park name overlaid (magazine-style). */}
      <Box
        position="relative"
        h={{ base: '280px', md: '400px' }}
        w="100%"
        mb={6}
        borderRadius="l3"
        overflow="hidden"
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
          <Placeholder name={String(park.parkCode)} label={String(park.name)} />
        )}
        <Box
          position="absolute"
          inset={0}
          style={{ background: 'linear-gradient(to top, rgba(11,46,30,0.92) 0%, rgba(11,46,30,0.30) 50%, transparent 78%)' }}
        />
        <Stack position="absolute" bottom={0} left={0} right={0} p={{ base: 5, md: 8 }} gap={2}>
          {park.designation ? (
            <Badge colorPalette="trail" variant="solid" alignSelf="start">
              {park.designation as string}
            </Badge>
          ) : null}
          <Heading
            as="h1"
            size={{ base: '2xl', md: '4xl' }}
            color="white"
            lineHeight="1.05"
            textShadow="0 2px 14px rgba(0,0,0,0.5)"
          >
            {park.name as string}
          </Heading>
          {statesLabel ? (
            <Text color="whiteAlpha.900" fontSize="sm" textShadow="0 1px 8px rgba(0,0,0,0.6)">
              {statesLabel}
            </Text>
          ) : null}
        </Stack>
      </Box>

      {/* "At a glance" stat row (R4 §3). */}
      <SimpleGrid minChildWidth="150px" gap={3} mb={6}>
        {dark ? <StatCard label="Dark sky" value={dark.label} icon={LuStar} tone="accent" /> : null}
        {diffRange ? <StatCard label="Hikes" value={diffRange} hint={`${difficulties.map(difficultyDot).join(' ')}`} icon={LuFootprints} /> : null}
        {park.crowdLevel ? <StatCard label="Crowds" value={park.crowdLevel as string} icon={LuUsers} /> : null}
        <StatCard label="Entrance" value={feeLabel} icon={LuTicket} tone="brand" />
        {park.timedEntry ? (
          <StatCard
            label="Timed entry"
            value={
              <CLink href={(park.permitUrl as string) ?? 'https://www.recreation.gov/timed-entry'} color="brand.fg">
                Required
              </CLink>
            }
            icon={LuCalendar}
          />
        ) : null}
      </SimpleGrid>

      <Box mb={6}>
        <ParkActions parkCode={parkCode} />
      </Box>

      {/* Active alerts — color-coded; we surface but defer to NPS for safety (NG2) */}
      {park.alerts.length > 0 ? (
        <Stack mb={5} gap={2}>
          {park.alerts.map((a) => (
            <Box key={a.id} borderLeftWidth="4px" borderColor={`${ALERT_COLOR[a.category] ?? 'gray'}.solid`} bg="bg.subtle" p={3} borderRadius="l1">
              <HStack>
                <Badge colorPalette={ALERT_COLOR[a.category] ?? 'gray'}>{a.category}</Badge>
                <Text fontWeight="semibold">{a.title}</Text>
              </HStack>
              {a.description ? <Text fontSize="sm" mt={1} color="fg.muted">{a.description}</Text> : null}
              {a.url ? <CLink href={a.url} fontSize="sm" color="brand.fg">Official NPS alert →</CLink> : null}
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
              <ChipList items={park.topics as string[]} param="topic" colorPalette="trail" />
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
            <MiniMap lat={park.lat as number} lng={park.lng as number} label={park.name as string} parkCode={parkCode} />
          ) : null}
          <HStack>
            {park.url ? <CLink href={park.url as string} color="brand.fg">Official site →</CLink> : null}
            {park.directionsUrl ? <CLink href={park.directionsUrl as string} color="brand.fg">Directions →</CLink> : null}
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

          {/* Live conditions (NPS-expansion P2 #6): on-demand webcams + road events, beside alerts. */}
          {conditions.webcams.length > 0 || conditions.roadEvents.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Live conditions</Heading>
              {conditions.roadEvents.length > 0 ? (
                <Stack gap={1} mb={conditions.webcams.length > 0 ? 3 : 0}>
                  {conditions.roadEvents.slice(0, 5).map((r) => (
                    <Text key={r.id} fontSize="sm">
                      <Badge mr={2} colorPalette={r.severityRank >= 3 ? 'red' : r.severityRank === 2 ? 'orange' : 'gray'}>
                        {r.severity}
                      </Badge>
                      {r.title}
                    </Text>
                  ))}
                </Stack>
              ) : null}
              {conditions.webcams.length > 0 ? (
                <Stack gap={1}>
                  {conditions.webcams.slice(0, 6).map((c) => (
                    <Text key={c.id} fontSize="sm">
                      {c.url ? <CLink href={c.url} color="brand.fg">{c.title} ↗</CLink> : c.title}
                      <Badge ml={2} colorPalette={c.isStreaming ? 'green' : c.status === 'Active' ? 'blue' : 'gray'}>
                        {c.isStreaming ? 'live' : c.status.toLowerCase()}
                      </Badge>
                    </Text>
                  ))}
                </Stack>
              ) : null}
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
                      <CLink href={c.reservationUrl} color="brand.fg">{c.name} ↗</CLink>
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
          {parking.length > 0 ? (
            <Box>
              <Heading size="sm" mb={2}>Parking</Heading>
              <Stack gap={1}>
                {parking.map((p) => (
                  <Text key={p.id} fontSize="sm">
                    {p.name}
                    {p.wheelchairAccessible ? <Badge ml={2} colorPalette="green">accessible</Badge> : null}
                  </Text>
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

      {/* People & stories — historical figures associated with this park (NPS-expansion P0 #2). */}
      {people.length > 0 ? (
        <Box mt={12}>
          <Heading size="md" mb={1}>People &amp; stories</Heading>
          <Text fontSize="sm" color="fg.muted" mb={3}>Figures tied to {park.name as string} — each spans a cross-park trail.</Text>
          <Stack gap={2}>
            {people.map((per) => {
              const tags = cleanTags(per.title, per.tags);
              return (
                <Box key={per.id}>
                  <Text fontWeight="medium" display="inline">{per.title}</Text>
                  {tags.length ? (
                    <Text as="span" fontSize="sm" color="fg.muted"> — {tags.slice(0, 3).join(', ')}</Text>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        </Box>
      ) : null}

      {/* Official NPS tours → trip builder (NPS-expansion P1 #3). */}
      <TourList parkName={park.name as string} tours={tours} />

      {/* Passport stamp collection (NPS-expansion P2 #8). */}
      <StampList stamps={stamps} />

      {/* Events, season-aware (NPS-expansion P2 #7): those inside the user's travel window come first. */}
      {events.length > 0 ? (
        <Box mt={12}>
          <Heading size="md" mb={1}>Events</Heading>
          <Text fontSize="sm" color="fg.muted" mb={3}>
            {availability.start && availability.end
              ? `Events at ${park.name as string} — those during your ${availability.start}–${availability.end} window are flagged.`
              : `Upcoming events at ${park.name as string}. Set your travel dates on “Your memory” to see what lands during your visit.`}
          </Text>
          <Stack gap={1}>
            {events.map((e) => (
              <Text key={e.id} fontSize="sm">
                {e.inWindow ? <Badge mr={2} colorPalette="green">during your visit</Badge> : null}
                {e.title}
                {e.dateStart ? <Text as="span" color="fg.muted"> · {e.dateStart}{e.dateEnd && e.dateEnd !== e.dateStart ? `–${e.dateEnd}` : ''}</Text> : null}
              </Text>
            ))}
          </Stack>
        </Box>
      ) : null}

      {/* Places of interest with real images + audio descriptions (NPS-expansion P3, accessibility). */}
      {places.length > 0 ? (
        <Box mt={12}>
          <Heading size="md" mb={3}>Places to see</Heading>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
            {places.map((pl) => (
              <Card.Root key={pl.id} variant="outline" overflow="hidden">
                <Box h="140px" position="relative" overflow="hidden">
                  {pl.image ? (
                    <NextImage src={pl.image} alt={pl.title} fill sizes="(max-width: 768px) 100vw, 33vw" style={{ objectFit: 'cover' }} />
                  ) : (
                    // Icon-only: the place title renders right below the thumbnail, so don't duplicate it.
                    <Placeholder name={pl.id} iconOnly />
                  )}
                </Box>
                <Card.Body p={3}>
                  <HStack>
                    <Text fontWeight="medium" lineClamp={1} flex="1">{pl.title}</Text>
                    {pl.isStamp ? <Badge colorPalette="trail">stamp</Badge> : null}
                    {pl.audioDescription ? <Badge colorPalette="pine" title={pl.audioDescription}>audio</Badge> : null}
                  </HStack>
                </Card.Body>
              </Card.Root>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      {/* "Learn more" — articles about this park (NPS-expansion P3). */}
      {articles.length > 0 ? (
        <Box mt={12}>
          <Heading size="md" mb={3}>Learn more</Heading>
          <Stack gap={2}>
            {articles.map((a) => (
              <Box key={a.id}>
                {a.url ? (
                  <CLink href={a.url} color="brand.fg" fontWeight="medium">{a.title} ↗</CLink>
                ) : (
                  <Text fontWeight="medium">{a.title}</Text>
                )}
                {a.description ? <Text fontSize="sm" color="fg.muted" lineClamp={2}>{a.description}</Text> : null}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}

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

import { Box, Container, Heading, SimpleGrid, Stack, Text, HStack, Icon, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuMountainSnow } from 'react-icons/lu';
import { thematicTrail, trailThemes } from '../../lib/queries';
import { ParkCard } from '../../components/ParkCard';
import { ThemeChips, type ThemeChipItem } from '../../components/trails/ThemeChips';
import { TrailMiniGraph } from '../../components/graph/TrailMiniGraph';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';

/**
 * Thematic trails (NPS-expansion P0 #2) — RSC. A "trail" is the set of parks connected by a
 * historical figure (`Person`-[:ASSOCIATED_WITH]->`Park`) or a shared `Topic`: a multi-hop graph
 * traversal no single park page reveals. Pick a theme → see the cross-park trail → open it on /graph.
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function TrailsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const person = sp.person?.trim() || undefined;
  const topic = sp.topic?.trim() || undefined;
  const selected = person || topic;

  const [themes, trail] = await Promise.all([
    // Pull the full taxonomy (capped high) — ThemeChips collapses + searches client-side so the list
    // no longer looks silently truncated (friction #6).
    trailThemes(500),
    selected ? thematicTrail({ person, topic }) : Promise.resolve([]),
  ]);

  const graphHref = person ? `/graph?person=${encodeURIComponent(person)}` : topic ? `/graph?topic=${encodeURIComponent(topic)}` : '/graph';
  const tourHref = person ? `/trails/tour?person=${encodeURIComponent(person)}` : topic ? `/trails/tour?topic=${encodeURIComponent(topic)}` : '/trails/tour';

  const peopleChips: ThemeChipItem[] = themes.people.map((p) => ({
    key: p.title,
    label: p.title,
    parks: p.parks,
    href: `/trails?person=${encodeURIComponent(p.title)}`,
    active: person === p.title,
  }));
  const topicChips: ThemeChipItem[] = themes.topics.map((t) => ({
    key: t.name,
    label: t.name,
    parks: t.parks,
    href: `/trails?topic=${encodeURIComponent(t.name)}`,
    active: topic === t.name,
  }));

  return (
    <Box>
      <PageHeader
        eyebrow="Thematic trails"
        title="Follow a story across the parks"
        subtitle="Cross-park journeys connected by the people who shaped them or a theme they share — each one a single graph traversal."
        contour
      />

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {/* Theme pickers */}
        <Stack gap={6} mb={10}>
          <Box>
            <Heading as="h2" size="md" mb={3}>People &amp; stories</Heading>
            {peopleChips.length === 0 ? (
              <Text color="fg.muted" fontSize="sm">No multi-park figures yet — run the data sync to populate them.</Text>
            ) : (
              <ThemeChips items={peopleChips} activeColor="pine" />
            )}
          </Box>
          <Box>
            <Heading as="h2" size="md" mb={3}>Topics</Heading>
            {topicChips.length === 0 ? (
              <Text color="fg.muted" fontSize="sm">No topics span enough parks yet.</Text>
            ) : (
              <ThemeChips items={topicChips} activeColor="trail" />
            )}
          </Box>
        </Stack>

        {/* Selected trail */}
        {selected ? (
          <Box>
            <SectionHeading
              title={person ? `Parks tied to ${person}` : `${topic} trail`}
              badge={`${trail.length} park${trail.length === 1 ? '' : 's'}`}
              badgeTone="brand"
              action={{ href: graphHref, label: 'See it on the graph' }}
            />
            {trail.length === 0 ? (
              <Text color="fg.muted">No parks found for this theme.</Text>
            ) : (
              <>
                {/* Fly the trail in 3D before the static grid (#11B). */}
                {trail.some((p) => p.lat != null && p.lng != null) ? (
                  <HStack mb={5}>
                    <CLink
                      asChild
                      display="inline-flex"
                      alignItems="center"
                      bg="brand.solid"
                      color="brand.contrast"
                      borderRadius="full"
                      px={4}
                      py={2}
                      fontSize="sm"
                      fontWeight="medium"
                      _hover={{ textDecoration: 'none', opacity: 0.92 }}
                    >
                      <NextLink href={tourHref}><Icon mr={2}><LuMountainSnow /></Icon>Fly the 3D tour</NextLink>
                    </CLink>
                  </HStack>
                ) : null}
                {/* See the trail as a connected graph before the card grid (ADR-039, friction #5). */}
                <Box mb={6}>
                  <TrailMiniGraph
                    themeLabel={selected}
                    parks={trail.map((p) => ({ parkCode: p.parkCode, name: p.name }))}
                  />
                </Box>
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
                  {trail.map((p) => (
                    <ParkCard key={p.parkCode} park={p} />
                  ))}
                </SimpleGrid>
              </>
            )}
          </Box>
        ) : (
          <Text color="fg.muted">Pick a person or topic above to trace its trail across the parks.</Text>
        )}
      </Container>
    </Box>
  );
}

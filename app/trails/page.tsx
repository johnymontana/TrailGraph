import { Box, Heading, SimpleGrid, Stack, Text, Badge, Flex, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { thematicTrail, trailThemes } from '../../lib/queries';
import { ParkCard } from '../../components/ParkCard';

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
    trailThemes(),
    selected ? thematicTrail({ person, topic }) : Promise.resolve([]),
  ]);

  const graphHref = person ? `/graph?person=${encodeURIComponent(person)}` : topic ? `/graph?topic=${encodeURIComponent(topic)}` : '/graph';

  return (
    <Box maxW="6xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      <Heading as="h1" size="lg" mb={2}>
        Thematic trails
      </Heading>
      <Text color="fg.muted" mb={6}>
        Cross-park journeys connected by the people who shaped them or a theme they share — each one a
        single graph traversal across the parks.
      </Text>

      {/* Theme pickers */}
      <Stack gap={5} mb={8}>
        <Box>
          <Heading size="sm" mb={2}>People &amp; stories</Heading>
          {themes.people.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">No multi-park figures yet — run the data sync to populate them.</Text>
          ) : (
            <Flex wrap="wrap" gap={2}>
              {themes.people.map((p) => (
                <CLink key={p.title} asChild>
                  <NextLink href={`/trails?person=${encodeURIComponent(p.title)}`}>
                    <Badge size="lg" colorPalette={person === p.title ? 'purple' : 'gray'} px={3} py={1} cursor="pointer">
                      {p.title} <Text as="span" color="fg.muted">· {p.parks}</Text>
                    </Badge>
                  </NextLink>
                </CLink>
              ))}
            </Flex>
          )}
        </Box>
        <Box>
          <Heading size="sm" mb={2}>Topics</Heading>
          {themes.topics.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">No topics span enough parks yet.</Text>
          ) : (
            <Flex wrap="wrap" gap={2}>
              {themes.topics.map((t) => (
                <CLink key={t.name} asChild>
                  <NextLink href={`/trails?topic=${encodeURIComponent(t.name)}`}>
                    <Badge size="lg" colorPalette={topic === t.name ? 'green' : 'gray'} px={3} py={1} cursor="pointer">
                      {t.name} <Text as="span" color="fg.muted">· {t.parks}</Text>
                    </Badge>
                  </NextLink>
                </CLink>
              ))}
            </Flex>
          )}
        </Box>
      </Stack>

      {/* Selected trail */}
      {selected ? (
        <Box>
          <Flex align="center" gap={3} mb={3} wrap="wrap">
            <Heading size="md">
              {person ? `Parks tied to ${person}` : `${topic} trail`}
            </Heading>
            <Badge colorPalette="blue">{trail.length} park{trail.length === 1 ? '' : 's'}</Badge>
            <CLink asChild color="blue.600" fontSize="sm">
              <NextLink href={graphHref}>See it on the graph →</NextLink>
            </CLink>
          </Flex>
          {trail.length === 0 ? (
            <Text color="fg.muted">No parks found for this theme.</Text>
          ) : (
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
              {trail.map((p) => (
                <ParkCard key={p.parkCode} park={p} />
              ))}
            </SimpleGrid>
          )}
        </Box>
      ) : (
        <Text color="fg.muted">Pick a person or topic above to trace its trail across the parks.</Text>
      )}
    </Box>
  );
}

import { Box, Heading, Text, Button, HStack, SimpleGrid, Stack, Badge, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { searchParks } from '../lib/queries';
import { forYou } from '../lib/recommend';
import { getServerUserId } from '../lib/session';
import { ParkCard } from '../components/ParkCard';
import { FirstRunBanner } from '../components/FirstRunBanner';

/** Marketing landing (§4): value prop + primary CTAs + personalized/featured parks. */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const userId = await getServerUserId();
  const [featured, recs] = await Promise.all([
    searchParks({ designation: 'National Park', limit: 4 }).catch(() => ({ items: [], total: 0 })),
    userId ? forYou(userId, { limit: 4 }).catch(() => null) : Promise.resolve(null),
  ]);
  const personalized = recs && recs.source === 'personalized' && recs.parks.length > 0 ? recs : null;

  return (
    <Box maxW="6xl" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 10, md: 16 }}>
      <Text color="blue.600" fontWeight={600} letterSpacing="0.04em" mb={2}>
        TRAILGRAPH
      </Text>
      <Heading as="h1" size="2xl" lineHeight="1.1" mb={4} maxW="3xl">
        Explore and plan trips to the U.S. National Parks.
      </Heading>
      <Text fontSize="lg" color="fg.muted" maxW="2xl" mb={6}>
        470+ NPS sites as a connected graph, with an AI ranger that remembers what you love — alpine
        lakes, dark skies, fewer crowds — and plans around it.
      </Text>
      <HStack gap={3} mb={12} wrap="wrap">
        <Button asChild colorPalette="blue" size="lg"><NextLink href="/explore">Explore parks</NextLink></Button>
        <Button asChild variant="outline" size="lg"><NextLink href="/plan">Plan a trip with the ranger</NextLink></Button>
        <Button asChild variant="ghost" size="lg"><NextLink href="/map">Open the map</NextLink></Button>
      </HStack>

      {/* Signed in but nothing learned yet → nudge toward seeding preferences (ADR-038). */}
      {userId && !personalized ? <FirstRunBanner /> : null}

      {personalized ? (
        <Stack gap={4} mb={12}>
          <HStack>
            <Heading size="md">For you</Heading>
            <Badge colorPalette="green">based on your preferences</Badge>
          </HStack>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={4}>
            {personalized.parks.map((p) => (
              <Box key={p.parkCode} minW={0}>
                <ParkCard park={p} />
                {p.matched.length > 0 ? (
                  <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1} title="See this in Your memory">
                    Because you liked {p.matched.slice(0, 3).join(', ')}
                  </CLink>
                ) : null}
              </Box>
            ))}
          </SimpleGrid>
        </Stack>
      ) : featured.items.length > 0 ? (
        <Stack gap={4} mb={12}>
          <Heading size="md">Featured parks</Heading>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={4}>
            {featured.items.map((p) => (
              <ParkCard key={p.parkCode} park={p} />
            ))}
          </SimpleGrid>
        </Stack>
      ) : null}

      <Text color="fg.muted" fontSize="sm">
        Not an official NPS safety source — always defer to NPS.gov and rangers.
      </Text>
    </Box>
  );
}

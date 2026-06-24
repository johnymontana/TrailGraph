import {
  Box,
  Container,
  Heading,
  Text,
  Button,
  HStack,
  Icon,
  SimpleGrid,
  Stack,
  Card,
  Link as CLink,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuArrowRight, LuCompass, LuNetwork, LuRoute, LuSparkles } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { searchParks, landingStats } from '../lib/queries';
import { forYou } from '../lib/recommend';
import { StatsBand } from '../components/marketing/StatsBand';
import { getServerUserId } from '../lib/session';
import { ParkCard } from '../components/ParkCard';
import { WhyThisPark } from '../components/parks/WhyThisPark';
import { FirstRunBanner } from '../components/FirstRunBanner';
import { SectionHeading } from '../components/ui/section-heading';
import { heroContourTexture } from '../theme/textures';

/** Marketing landing (§4): value prop + primary CTAs + personalized/featured parks. */
export const dynamic = 'force-dynamic';

const FEATURES: { icon: IconType; title: string; body: string }[] = [
  {
    icon: LuNetwork,
    title: 'A connected graph',
    body: '470+ NPS sites linked by shared topics, people, and trips — explore the web of parks, not a flat list.',
  },
  {
    icon: LuSparkles,
    title: 'A ranger that remembers',
    body: 'Tell the AI ranger what you love — alpine lakes, dark skies, fewer crowds — and it plans around it, every time.',
  },
  {
    icon: LuRoute,
    title: 'Trips that hold together',
    body: 'Build itineraries with drive times, entrance fees, alerts, and timed-entry — then share a clean link.',
  },
];

export default async function Home() {
  const userId = await getServerUserId();
  const [featured, recs, stats] = await Promise.all([
    searchParks({ designation: 'National Park', limit: 4 }).catch(() => ({ items: [], total: 0 })),
    userId ? forYou(userId, { limit: 4 }).catch(() => null) : Promise.resolve(null),
    landingStats().catch(() => ({ parks: 0, darkSky: 0, activities: 0, topics: 0 })),
  ]);
  const personalized = recs && recs.source === 'personalized' && recs.parks.length > 0 ? recs : null;

  return (
    <Box>
      {/* Hero */}
      <Box
        position="relative"
        overflow="hidden"
        borderBottomWidth="1px"
        borderColor="border"
        bg="bg.subtle"
        backgroundImage={heroContourTexture}
      >
        <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 16, md: 24 }}>
          <Stack gap={6} maxW="3xl">
            <HStack gap={2} color="accent.fg">
              <Icon boxSize={4}><LuCompass /></Icon>
              <Text fontSize="xs" fontWeight="bold" letterSpacing="0.14em" textTransform="uppercase">
                AI-native park planning
              </Text>
            </HStack>
            <Heading as="h1" size={{ base: '3xl', md: '5xl' }} lineHeight="1.05" letterSpacing="-0.02em">
              Explore and plan trips to the U.S. National Parks.
            </Heading>
            <Text fontSize={{ base: 'lg', md: 'xl' }} color="fg.muted" maxW="2xl">
              470+ NPS sites as a connected graph, with an AI ranger that remembers what you love — alpine
              lakes, dark skies, fewer crowds — and plans around it.
            </Text>
            <HStack gap={3} wrap="wrap" pt={2}>
              <Button asChild colorPalette="pine" size="lg">
                <NextLink href="/explore">
                  Explore parks <Icon ms={1}><LuArrowRight /></Icon>
                </NextLink>
              </Button>
              <Button asChild colorPalette="trail" variant="subtle" size="lg">
                <NextLink href="/plan">Plan a trip with the ranger</NextLink>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <NextLink href="/map">Open the map</NextLink>
              </Button>
            </HStack>
          </Stack>
        </Container>
      </Box>

      {/* Graph-scale stats band (Chakra UI Pro, ADR-054). */}
      <StatsBand stats={stats} />

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 12, md: 16 }}>
        {/* Signed in but nothing learned yet → nudge toward seeding preferences (ADR-038). */}
        {userId && !personalized ? (
          <Box mb={12}>
            <FirstRunBanner />
          </Box>
        ) : null}

        {/* How it works */}
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={6} mb={16}>
          {FEATURES.map((f) => (
            <Card.Root key={f.title} variant="subtle" size="md">
              <Card.Body gap={3}>
                <Box
                  boxSize={10}
                  borderRadius="l2"
                  bg="brand.muted"
                  color="brand.fg"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Icon boxSize={5}><f.icon /></Icon>
                </Box>
                <Card.Title fontSize="lg">{f.title}</Card.Title>
                <Text color="fg.muted" fontSize="sm">
                  {f.body}
                </Text>
              </Card.Body>
            </Card.Root>
          ))}
        </SimpleGrid>

        {personalized ? (
          <Stack gap={4} mb={4}>
            <SectionHeading title="For you" badge="based on your preferences" badgeTone="brand" action={{ href: '/explore', label: 'Explore all' }} />
            <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={5}>
              {personalized.parks.map((p) => (
                <Box key={p.parkCode} minW={0}>
                  <ParkCard park={p} />
                  {p.matched.length > 0 ? (
                    <>
                      <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1.5} title="See this in Your memory">
                        Because you liked {p.matched.slice(0, 3).join(', ')}
                      </CLink>
                      <WhyThisPark parkCode={p.parkCode} parkName={p.name} />
                    </>
                  ) : null}
                </Box>
              ))}
            </SimpleGrid>
          </Stack>
        ) : featured.items.length > 0 ? (
          <Stack gap={4} mb={4}>
            <SectionHeading title="Featured parks" action={{ href: '/explore', label: 'Browse all' }} />
            <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={5}>
              {featured.items.map((p) => (
                <ParkCard key={p.parkCode} park={p} />
              ))}
            </SimpleGrid>
          </Stack>
        ) : null}
      </Container>
    </Box>
  );
}

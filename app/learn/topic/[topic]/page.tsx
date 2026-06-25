import { Badge, Box, Container, Heading, HStack, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../components/ui/page-header';
import { learningTrailForTopic, type TrailCourse } from '../../../../lib/learn-queries';

export const dynamic = 'force-dynamic';

/**
 * Cross-park learning trail (design §13): every course on a topic, across the parks that teach it, ordered
 * by grade band then park — "learn Volcanoes across Yellowstone, Hawai'i Volcanoes, and Lassen". Public;
 * `notFound()` when no course teaches the topic.
 */
export default async function TopicTrailPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const trail = await learningTrailForTopic(topic);
  if (!trail.length) notFound();

  // Group by park, preserving the grade-band ordering from the query.
  const byPark = new Map<string, { parkCode: string; parkName: string; courses: TrailCourse[] }>();
  for (const c of trail) {
    const key = c.parkCode ?? 'unknown';
    if (!byPark.has(key)) byPark.set(key, { parkCode: c.parkCode ?? '', parkName: c.parkName ?? 'Unknown park', courses: [] });
    byPark.get(key)!.courses.push(c);
  }
  const parks = [...byPark.values()];

  return (
    <Box>
      <PageHeader
        eyebrow="CROSS-PARK TRAIL"
        title={`Learn ${topic} across the parks`}
        subtitle={`${trail.length} course${trail.length === 1 ? '' : 's'} across ${parks.length} park${parks.length === 1 ? '' : 's'} — one topic, many places.`}
        contour
      />
      <Container maxW="3xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        <Stack gap={8}>
          {parks.map((pk) => (
            <Box key={pk.parkCode || pk.parkName}>
              <HStack justify="space-between" mb={2}>
                <Heading size="md">{pk.parkName}</Heading>
                {pk.parkCode ? (
                  <CLink asChild color="brand.fg" fontSize="sm">
                    <NextLink href={`/parks/${pk.parkCode}`}>Park page →</NextLink>
                  </CLink>
                ) : null}
              </HStack>
              <Stack gap={2}>
                {pk.courses.map((c) => (
                  <CLink key={c.id} asChild display="block" w="full" _hover={{ textDecoration: 'none' }}>
                    <NextLink href={`/learn/${encodeURIComponent(c.id)}`}>
                      <HStack justify="space-between" borderWidth="1px" borderColor="border" borderRadius="l2" p={3} _hover={{ bg: 'bg.subtle', borderColor: 'brand.solid' }}>
                        <Box minW={0}>
                          <Text fontWeight="medium" lineClamp={1}>{c.title}</Text>
                          <HStack gap={1} mt={0.5} wrap="wrap">
                            {c.gradeLevel ? <Badge colorPalette="trail" size="sm">{c.gradeLevel}</Badge> : null}
                            {c.decomposed ? <Badge colorPalette="sand" size="sm">{c.lessonCount} lessons</Badge> : null}
                          </HStack>
                        </Box>
                        <Text color="brand.fg" fontSize="sm" flexShrink={0}>Open →</Text>
                      </HStack>
                    </NextLink>
                  </CLink>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}

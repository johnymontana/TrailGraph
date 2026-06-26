import { Box, Container, Heading, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { thematicTrail, lessonPlansForPark } from '../../../lib/queries';
import { StoryTour, type TourStop } from '../../../components/trails/StoryTour';

/**
 * Scrollytelling 3D tour (#11B): fly park-to-park across a thematic trail (person/topic) on a sticky terrain
 * map as the reader scrolls narrative panels. Mirrors `app/trails/page.tsx`'s person|topic params + reuses
 * `thematicTrail` for the ordered parks and `lessonPlansForPark` for a per-park "learn more" tie-in. The map
 * degrades to a flat, gently-pitched fly when no terrain DEM is configured (#11 env-gated).
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function TrailTourPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const person = sp.person?.trim() || undefined;
  const topic = sp.topic?.trim() || undefined;
  const selected = person || topic;

  const trail = selected ? await thematicTrail({ person, topic }) : [];
  const located = trail.filter((p) => p.lat != null && p.lng != null);

  // One "learn more" lesson per park (parallel, ≤12 parks) so each panel can cross-link to Ranger School.
  const lessons = await Promise.all(located.map((p) => lessonPlansForPark(p.parkCode, 1).catch(() => [])));
  const stops: TourStop[] = located.map((p, i) => {
    const lesson = lessons[i]?.[0];
    return {
      parkCode: p.parkCode,
      name: p.name,
      designation: p.designation,
      lat: p.lat as number,
      lng: p.lng as number,
      image: p.image,
      via: p.via,
      lesson: lesson ? { title: lesson.title, href: `/learn/${encodeURIComponent(lesson.id)}` } : null,
    };
  });

  if (!selected || stops.length === 0) {
    return (
      <Container maxW="2xl" py={{ base: 16, md: 24 }} textAlign="center">
        <Heading size="lg" mb={3}>Take a 3D tour of a trail</Heading>
        <Text color="fg.muted" mb={6}>
          {selected ? 'This theme has no mappable parks to fly through yet.' : 'Pick a person or topic to fly its trail across the parks.'}
        </Text>
        <CLink asChild color="brand.fg" fontWeight="medium">
          <NextLink href="/trails">Browse thematic trails →</NextLink>
        </CLink>
      </Container>
    );
  }

  return (
    <Box>
      <StoryTour stops={stops} theme={selected} kind={person ? 'person' : 'topic'} />
    </Box>
  );
}

import { Badge, Box, Button, Container, HStack, Input, SimpleGrid, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuGraduationCap, LuBookOpen, LuCircleCheck, LuAward } from 'react-icons/lu';
import { getServerUserId } from '../../lib/session';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';
import { StatCard } from '../../components/ui/stat-card';
import { EmptyState } from '../../components/ui/empty-state';
import { CourseCard } from '../../components/learn/CourseCard';
import { BadgeShelf } from '../../components/learn/BadgeShelf';
import { learnCatalog, searchCourses, getLearnDashboard, getLearningMemory } from '../../lib/learn-queries';
import { allBadges } from '../../lib/learn-badges';

export const dynamic = 'force-dynamic';

const GRADE_CHIPS: { id: string; label: string }[] = [
  { id: '', label: 'All grades' },
  { id: 'k-2', label: 'K–2' },
  { id: '3-5', label: '3–5' },
  { id: '6-8', label: '6–8' },
  { id: '9-12', label: '9–12' },
];

/**
 * Ranger School catalog + (when signed in) a progress band. Public — anyone can browse courses; the
 * dashboard stats only render for an authenticated learner (no redirect). A GET search form (`?q=`) +
 * grade-band chips (`?grade=`) make the ~1,357-course catalog navigable (progressive-enhancement, no JS).
 */
export default async function LearnPage({ searchParams }: { searchParams: Promise<{ q?: string; grade?: string }> }) {
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const grade = (sp.grade ?? '').trim();
  const userId = await getServerUserId();
  const [courses, dashboard, memory, badges] = await Promise.all([
    query ? searchCourses(query, { limit: 60, gradeBand: grade }) : learnCatalog(60, grade),
    userId ? getLearnDashboard(userId) : Promise.resolve(null),
    userId ? getLearningMemory(userId) : Promise.resolve(null),
    userId ? allBadges() : Promise.resolve([]),
  ]);

  // Build a chip href that preserves the current search query.
  const chipHref = (band: string) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (band) params.set('grade', band);
    const qs = params.toString();
    return qs ? `/learn?${qs}` : '/learn';
  };

  return (
    <Box>
      <PageHeader
        eyebrow="RANGER SCHOOL"
        title="Learn the parks"
        subtitle="Park-grounded courses, taught by the Ranger. Ask the ranger in chat to teach any course."
        contour
      />
      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {userId && dashboard ? (
          <Box mb={10}>
            <SectionHeading title="Your progress" badge="signed in" badgeTone="accent" />
            <SimpleGrid columns={{ base: 2, md: 4 }} gap={4}>
              <StatCard label="Enrolled" value={dashboard.enrolled} icon={LuBookOpen} tone="brand" />
              <StatCard label="Lessons completed" value={dashboard.completedLessons} icon={LuCircleCheck} tone="brand" />
              <StatCard label="Badges earned" value={dashboard.badges} icon={LuAward} tone="accent" />
              <StatCard label="Certificates" value={memory?.certificates.length ?? 0} icon={LuGraduationCap} tone="accent" />
            </SimpleGrid>
            {badges.length ? (
              <Box mt={6}>
                <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={3}>Junior Ranger badges</Text>
                <BadgeShelf badges={badges} earnedIds={(memory?.badges ?? []).map((b) => b.id)} />
              </Box>
            ) : null}
          </Box>
        ) : null}

        <SectionHeading
          title={query ? `Results for “${query}”` : 'All courses'}
          description={query ? `${courses.length} course${courses.length === 1 ? '' : 's'} match your search.` : 'Every NPS lesson plan, grounded in its park.'}
          action={query ? { href: '/learn', label: 'Clear search' } : undefined}
        />

        {/* GET search — submitting navigates to /learn?q=… (no client JS needed) */}
        <Box mb={6} maxW="2xl">
          <form action="/learn">
            <HStack gap={2}>
              <Input
                name="q"
                defaultValue={query}
                placeholder="Search courses — e.g. geology, wildlife, Yellowstone…"
                bg="bg.panel"
                borderRadius="full"
              />
              {grade ? <input type="hidden" name="grade" value={grade} /> : null}
              <Button type="submit" colorPalette="pine" borderRadius="full" px={6}>Search</Button>
            </HStack>
          </form>
        </Box>

        {/* Grade-band filter chips (preserve the search query) */}
        <HStack gap={2} mb={6} wrap="wrap">
          {GRADE_CHIPS.map((b) => (
            <CLink key={b.id || 'all'} asChild _hover={{ textDecoration: 'none' }}>
              <NextLink href={chipHref(b.id)}>
                <Badge
                  colorPalette={grade === b.id ? 'pine' : 'sand'}
                  variant={grade === b.id ? 'solid' : 'subtle'}
                  px={3}
                  py={1.5}
                  cursor="pointer"
                >
                  {b.label}
                </Badge>
              </NextLink>
            </CLink>
          ))}
        </HStack>

        {courses.length ? (
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
            {courses.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </SimpleGrid>
        ) : (
          <EmptyState
            icon={<LuGraduationCap />}
            title={query ? `No courses match “${query}”` : grade ? 'No courses in this grade band' : 'No courses yet'}
            description={
              query
                ? 'Try a different term, like a park name or subject.'
                : grade
                  ? 'Try another grade band, or clear the filter.'
                  : 'Courses appear here once lesson plans sync.'
            }
          >
            {query || grade ? (
              <CLink asChild color="brand.fg">
                <NextLink href="/learn">Clear filters</NextLink>
              </CLink>
            ) : null}
          </EmptyState>
        )}
      </Container>
    </Box>
  );
}

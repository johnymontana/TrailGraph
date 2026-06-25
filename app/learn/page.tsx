import { Badge, Box, Button, Container, Field, HStack, Input, NativeSelect, SimpleGrid, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuGraduationCap, LuBookOpen, LuCircleCheck, LuAward } from 'react-icons/lu';
import { getServerUserId } from '../../lib/session';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';
import { StatCard } from '../../components/ui/stat-card';
import { EmptyState } from '../../components/ui/empty-state';
import { CourseCard } from '../../components/learn/CourseCard';
import { BadgeShelf } from '../../components/learn/BadgeShelf';
import { learnCatalog, searchCourses, subjectFacets, getLearnDashboard, getLearningMemory, crossParkTopics, type CatalogSort } from '../../lib/learn-queries';
import { allBadges } from '../../lib/learn-badges';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

const GRADE_CHIPS: { id: string; label: string }[] = [
  { id: '', label: 'All levels' },
  { id: 'k-2', label: 'K–2' },
  { id: '3-5', label: '3–5' },
  { id: '6-8', label: '6–8' },
  { id: '9-12', label: '9–12' },
];

const SORT_OPTIONS: { id: string; label: string }[] = [
  { id: '', label: 'Best match' },
  { id: 'park', label: 'Park (A–Z)' },
  { id: 'subject', label: 'Subject' },
  { id: 'lessons', label: 'Most lessons' },
  { id: 'grade', label: 'Reading level' },
];
const VALID_SORTS = new Set(['park', 'grade', 'subject', 'lessons']);

/**
 * Ranger School catalog + (when signed in) a progress band. Public — anyone can browse courses; the
 * dashboard stats only render for an authenticated learner (no redirect). A GET form (`?q=`/`?subject=`/
 * `?sort=`) + grade-band chips (`?grade=`) + pagination (`?page=`) make the ~1,357-course catalog navigable
 * (progressive-enhancement, no JS). Framed for adult lifelong-learners; reading level is a filter, not a headline.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string; subject?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const grade = (sp.grade ?? '').trim();
  const subject = (sp.subject ?? '').trim();
  const sort = VALID_SORTS.has((sp.sort ?? '').trim()) ? (sp.sort!.trim() as CatalogSort) : undefined;
  const page = Math.max(0, Number.parseInt(sp.page ?? '0', 10) || 0);
  const opts = { limit: PAGE_SIZE, gradeBand: grade, subject: subject || undefined, sort, page };
  const userId = await getServerUserId();
  const [courses, subjects, dashboard, memory, badges, trails] = await Promise.all([
    query ? searchCourses(query, opts) : learnCatalog(PAGE_SIZE, grade, opts),
    subjectFacets(),
    userId ? getLearnDashboard(userId) : Promise.resolve(null),
    userId ? getLearningMemory(userId) : Promise.resolve(null),
    userId ? allBadges() : Promise.resolve([]),
    crossParkTopics(10),
  ]);
  const hasNextPage = courses.length === PAGE_SIZE; // a full page → there's probably more

  // Build an href preserving the current filters, with overrides (undefined drops a param).
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string> = {};
    const base = { q: query, grade, subject, sort: sort ?? '', page: page > 0 ? String(page) : '' };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v) merged[k] = v;
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/learn?${qs}` : '/learn';
  };
  // Changing a grade chip resets pagination back to the first page.
  const chipHref = (band: string) => buildHref({ grade: band || undefined, page: undefined });

  return (
    <Box>
      <PageHeader
        eyebrow="RANGER SCHOOL"
        title="Learn the parks"
        subtitle="Self-paced, park-grounded courses — taught by the Ranger. Pick a topic and learn the story behind any park."
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
                <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={3}>Your ranger badges</Text>
                <BadgeShelf badges={badges} earnedIds={(memory?.badges ?? []).map((b) => b.id)} />
              </Box>
            ) : null}
          </Box>
        ) : null}

        {/* Cross-park trails — a topic taught across multiple parks (design §13). Hidden during a search. */}
        {!query && trails.length ? (
          <Box mb={10}>
            <SectionHeading title="Cross-park trails" description="One topic, many parks — follow it across the system." />
            <HStack gap={2} wrap="wrap">
              {trails.map((t) => (
                <CLink key={t.topic} asChild _hover={{ textDecoration: 'none' }}>
                  <NextLink href={`/learn/topic/${encodeURIComponent(t.topic)}`}>
                    <Badge colorPalette="trail" variant="subtle" px={3} py={1.5} cursor="pointer">
                      {t.topic} · {t.parkCount} parks
                    </Badge>
                  </NextLink>
                </CLink>
              ))}
            </HStack>
          </Box>
        ) : null}

        <SectionHeading
          title={query ? `Results for “${query}”` : 'All courses'}
          description={query ? 'Most relevant courses first.' : 'Every NPS lesson plan, grounded in its park.'}
          action={query ? { href: '/learn', label: 'Clear search' } : undefined}
        />

        {/* GET search + filters — submitting navigates to /learn?q=…&subject=…&sort=… (no client JS needed). */}
        <Box mb={6} maxW="3xl">
          <form action="/learn">
            <Stack gap={3}>
              <HStack gap={2}>
                <Input
                  name="q"
                  defaultValue={query}
                  placeholder="Search courses — e.g. geology, wildlife, Yellowstone…"
                  bg="bg.panel"
                  borderRadius="full"
                />
                <Button type="submit" colorPalette="pine" borderRadius="full" px={6}>Search</Button>
              </HStack>
              <HStack gap={3} wrap="wrap" align="end">
                <Field.Root w={{ base: 'full', sm: '230px' }}>
                  <Field.Label fontSize="xs" color="fg.muted">Subject</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field name="subject" defaultValue={subject}>
                      <option value="">All subjects</option>
                      {subjects.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                <Field.Root w={{ base: 'full', sm: '190px' }}>
                  <Field.Label fontSize="xs" color="fg.muted">Sort</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field name="sort" defaultValue={sort ?? ''}>
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                {grade ? <input type="hidden" name="grade" value={grade} /> : null}
              </HStack>
            </Stack>
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
          <>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
              {courses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </SimpleGrid>
            {page > 0 || hasNextPage ? (
              <HStack justify="space-between" mt={8}>
                {page > 0 ? (
                  <CLink asChild color="brand.fg">
                    <NextLink href={buildHref({ page: page - 1 > 0 ? String(page - 1) : undefined })}>← Previous</NextLink>
                  </CLink>
                ) : (
                  <Box />
                )}
                <Text fontSize="sm" color="fg.muted">Page {page + 1}</Text>
                {hasNextPage ? (
                  <CLink asChild color="brand.fg">
                    <NextLink href={buildHref({ page: String(page + 1) })}>Next →</NextLink>
                  </CLink>
                ) : (
                  <Box />
                )}
              </HStack>
            ) : null}
          </>
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
            {query || grade || subject || page > 0 ? (
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

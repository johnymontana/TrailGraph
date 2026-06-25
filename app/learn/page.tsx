import { Box, Container, SimpleGrid } from '@chakra-ui/react';
import { LuGraduationCap, LuBookOpen, LuCircleCheck, LuAward } from 'react-icons/lu';
import { getServerUserId } from '../../lib/session';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';
import { StatCard } from '../../components/ui/stat-card';
import { EmptyState } from '../../components/ui/empty-state';
import { CourseCard } from '../../components/learn/CourseCard';
import { learnCatalog, getLearnDashboard, getLearningMemory } from '../../lib/learn-queries';

export const dynamic = 'force-dynamic';

/**
 * Ranger School catalog + (when signed in) a progress band. Public — anyone can browse courses; the
 * dashboard stats only render for an authenticated learner (no redirect).
 */
export default async function LearnPage() {
  const userId = await getServerUserId();
  const [courses, dashboard, memory] = await Promise.all([
    learnCatalog(60),
    userId ? getLearnDashboard(userId) : Promise.resolve(null),
    userId ? getLearningMemory(userId) : Promise.resolve(null),
  ]);

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
          </Box>
        ) : null}

        <SectionHeading title="All courses" description="Every NPS lesson plan, grounded in its park." />
        {courses.length ? (
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
            {courses.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </SimpleGrid>
        ) : (
          <EmptyState icon={<LuGraduationCap />} title="No courses yet" description="Courses appear here once lesson plans sync." />
        )}
      </Container>
    </Box>
  );
}

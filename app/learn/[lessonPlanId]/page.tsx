import { Box, Container, HStack, Stack, Text } from '@chakra-ui/react';
import { notFound } from 'next/navigation';
import { getServerUserId } from '../../../lib/session';
import { PageHeader } from '../../../components/ui/page-header';
import { lessonPlanProgress } from '../../../lib/learn-queries';

export const dynamic = 'force-dynamic';

/**
 * Course syllabus — the module/lesson spine, with per-lesson completion when signed in. Public (browse
 * any course); `notFound()` when the course id doesn't exist. The lesson player + tutor live in the
 * ranger chat (Phase 4); this is the at-a-glance outline.
 */
export default async function CourseSyllabusPage({ params }: { params: Promise<{ lessonPlanId: string }> }) {
  const { lessonPlanId } = await params;
  const userId = await getServerUserId();
  // An empty userId matches no :User, so completion flags are all false for anonymous browsers.
  const progress = await lessonPlanProgress(userId ?? '', lessonPlanId);
  if (!progress) notFound();

  return (
    <Box>
      <PageHeader
        eyebrow="COURSE"
        title={progress.title}
        subtitle={progress.total > 0 ? `${progress.done} of ${progress.total} lessons complete` : 'Course overview'}
        contour
      />
      <Container maxW="3xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {progress.total === 0 ? (
          <Text color="fg.muted">
            This course isn&apos;t broken into lessons yet — ask the Ranger to teach it in chat.
          </Text>
        ) : (
          <Stack gap={6}>
            {progress.modules.map((m) => (
              <Box key={m.id}>
                <Text fontFamily="heading" fontWeight="semibold" mb={2}>
                  {m.ordinal}. {m.title}
                </Text>
                <Stack gap={1.5} pl={3} borderLeftWidth="2px" borderColor="border">
                  {m.lessons.map((l) => (
                    <HStack key={l.id} gap={2} align="start">
                      <Text fontSize="sm" color={l.completed ? 'pine.fg' : 'fg.muted'} flexShrink={0}>
                        {l.completed ? '✅' : '⬜'}
                      </Text>
                      <Text fontSize="sm">{l.title}</Text>
                    </HStack>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Container>
    </Box>
  );
}

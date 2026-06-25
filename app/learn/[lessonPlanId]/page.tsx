import { Box, Button, Container, HStack, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { notFound } from 'next/navigation';
import { getServerUserId } from '../../../lib/session';
import { PageHeader } from '../../../components/ui/page-header';
import { lessonPlanProgress } from '../../../lib/learn-queries';

export const dynamic = 'force-dynamic';

/**
 * Course syllabus — the module/lesson spine with per-lesson completion when signed in. Public (browse any
 * course); `notFound()` when the course id doesn't exist. Each lesson links to the lesson player
 * (/learn/[lessonPlanId]/[lessonId]); the "Start learning" CTA jumps to the first unfinished lesson.
 */
export default async function CourseSyllabusPage({ params }: { params: Promise<{ lessonPlanId: string }> }) {
  const { lessonPlanId } = await params;
  const userId = await getServerUserId();
  // An empty userId matches no :User, so completion flags are all false for anonymous browsers.
  const progress = await lessonPlanProgress(userId ?? '', lessonPlanId);
  if (!progress) notFound();

  const lessonHref = (id: string) => `/learn/${encodeURIComponent(lessonPlanId)}/${encodeURIComponent(id)}`;
  const allLessons = progress.modules.flatMap((m) => m.lessons);
  const startLesson = allLessons.find((l) => !l.completed) ?? allLessons[0];

  return (
    <Box>
      <PageHeader
        eyebrow="COURSE"
        title={progress.title}
        subtitle={progress.total > 0 ? `${progress.done} of ${progress.total} lessons complete` : 'Course overview'}
        contour
        actions={
          startLesson ? (
            <CLink asChild _hover={{ textDecoration: 'none' }}>
              <NextLink href={lessonHref(startLesson.id)}>
                <Button colorPalette="pine" borderRadius="full">
                  {progress.done > 0 ? 'Continue learning' : 'Start learning'}
                </Button>
              </NextLink>
            </CLink>
          ) : undefined
        }
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
                <Stack gap={0.5} pl={3} borderLeftWidth="2px" borderColor="border">
                  {m.lessons.map((l) => (
                    <CLink key={l.id} asChild display="block" _hover={{ textDecoration: 'none' }}>
                      <NextLink href={lessonHref(l.id)}>
                        <HStack gap={2} align="start" px={2} py={1.5} borderRadius="l1" _hover={{ bg: 'bg.subtle' }}>
                          <Text fontSize="sm" color={l.completed ? 'pine.fg' : 'fg.muted'} flexShrink={0}>
                            {l.completed ? '✅' : '⬜'}
                          </Text>
                          <Text fontSize="sm" color="brand.fg">{l.title}</Text>
                        </HStack>
                      </NextLink>
                    </CLink>
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

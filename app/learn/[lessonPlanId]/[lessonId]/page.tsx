import { Badge, Box, Flex, HStack, Heading, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerUserId } from '../../../../lib/session';
import { ChatPanel } from '../../../../components/chat/ChatPanel';
import { lessonContent, lessonPlanProgress } from '../../../../lib/learn-queries';

export const dynamic = 'force-dynamic';

/**
 * Ranger School lesson player — a full-screen 3-pane shell: module/lesson nav (left), the park-grounded
 * lesson content (center), and a lesson-seeded tutor chat (right, the reused ChatPanel). Interactive
 * tutoring needs a session (the tools are userId-scoped), so anonymous visitors are redirected to sign-in
 * (ADR-038 pattern); the public syllabus at /learn/[lessonPlanId] stays browseable. One responsive Flex
 * (no useBreakpointValue branching) + ChatPanel mounted exactly once so the Eve session isn't duplicated.
 */
export default async function LessonPlayerPage({
  params,
}: {
  params: Promise<{ lessonPlanId: string; lessonId: string }>;
}) {
  const { lessonPlanId, lessonId } = await params;
  const userId = await getServerUserId();
  if (!userId) redirect('/signin');

  const [content, progress] = await Promise.all([
    lessonContent(lessonId),
    lessonPlanProgress(userId, lessonPlanId),
  ]);
  if (!content || !progress) notFound();

  const objective = content.context?.lessonPlan.objective ?? null;
  const audio = content.context?.media.audio ?? [];
  const parkName = content.context?.park?.fullName ?? null;
  const lessonHref = (id: string) => `/learn/${encodeURIComponent(lessonPlanId)}/${encodeURIComponent(id)}`;

  // Lesson-seeded tutor prompts: the lessonId is embedded so the model grounds tutor_step/generate_quiz.
  const suggestions = [
    `Teach me "${content.lesson.title}" (lessonId: ${lessonId})`,
    `Quiz me on lessonId ${lessonId}`,
    'How am I doing in this course?',
  ];

  return (
    <Flex position="fixed" top="57px" left={0} right={0} bottom={0} direction={{ base: 'column', md: 'row' }} data-fullscreen>
      <Heading as="h1" srOnly>
        {content.lesson.title} — {progress.title}
      </Heading>

      {/* Left: module/lesson nav (CSS-hidden on mobile; use the syllabus page there) */}
      <Box hideBelow="md" w="260px" h="100%" overflowY="auto" borderRightWidth="1px" borderColor="border" bg="bg.panel" p={4}>
        <Text fontSize="xs" fontWeight="bold" color="accent.fg" textTransform="uppercase" letterSpacing="0.08em" mb={1} lineClamp={2}>
          {progress.title}
        </Text>
        <Text fontSize="xs" color="fg.muted" mb={4}>{progress.done}/{progress.total} lessons</Text>
        <Stack gap={4}>
          {progress.modules.map((m) => (
            <Box key={m.id}>
              <Text fontSize="sm" fontWeight="semibold" mb={1}>{m.ordinal}. {m.title}</Text>
              <Stack gap={0.5} pl={2}>
                {m.lessons.map((l) => {
                  const active = l.id === lessonId;
                  return (
                    <CLink key={l.id} asChild display="block" _hover={{ textDecoration: 'none' }}>
                      <NextLink href={lessonHref(l.id)}>
                        <HStack gap={1.5} px={2} py={1} borderRadius="l1" bg={active ? 'brand.muted' : undefined} color={active ? 'brand.fg' : 'fg'} _hover={{ bg: active ? 'brand.muted' : 'bg.subtle' }}>
                          <Text fontSize="xs" flexShrink={0}>{l.completed ? '✅' : active ? '▶️' : '⬜'}</Text>
                          <Text fontSize="sm" lineClamp={1}>{l.title}</Text>
                        </HStack>
                      </NextLink>
                    </CLink>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* Center: park-grounded lesson content */}
      <Box flex="1" minH={0} h={{ base: '50%', md: '100%' }} overflowY="auto" p={{ base: 4, md: 8 }}>
        <Text fontSize="xs" color="fg.muted" mb={1}>{content.module.title}</Text>
        <Heading as="h2" size="xl" fontFamily="heading" mb={4}>{content.lesson.title}</Heading>
        {objective ? (
          <Box bg="brand.subtle" borderRadius="l2" p={4} mb={6}>
            <Text fontSize="xs" fontWeight="semibold" color="accent.fg" textTransform="uppercase" letterSpacing="0.05em" mb={1}>Objective</Text>
            <Text fontSize="sm">{objective}</Text>
          </Box>
        ) : null}
        {audio.length ? (
          <Box mb={6}>
            <Heading as="h3" size="md" mb={2}>🎧 Audio from {parkName ?? 'the park'}</Heading>
            <Stack gap={2}>
              {audio.map((a) => (
                <Text key={a.id} fontSize="sm">
                  {a.url ? <CLink href={a.url} color="brand.fg">{a.title} ↗</CLink> : a.title}
                  {a.hasTranscript ? <Badge ml={2} colorPalette="pine" size="sm">transcript</Badge> : null}
                </Text>
              ))}
            </Stack>
          </Box>
        ) : null}
        <Text fontSize="sm" color="fg.muted">
          Ask the Ranger on the right to teach this lesson, quiz you, and track your progress — everything is
          grounded in this course. Openness and accessibility are reported by the park; verify before a visit.
        </Text>
      </Box>

      {/* Right: lesson-seeded tutor chat (mounted exactly once) */}
      <Box w={{ base: '100%', md: '400px' }} h={{ base: '50%', md: '100%' }} minH={0} borderLeftWidth={{ md: '1px' }} borderTopWidth={{ base: '1px', md: 0 }} borderColor="border">
        <ChatPanel
          title="Ranger · your tutor"
          subtitle="Grounded in this lesson"
          emptyHint="Tap a prompt to start learning this lesson."
          placeholder="Ask about this lesson…"
          suggestions={suggestions}
        />
      </Box>
    </Flex>
  );
}

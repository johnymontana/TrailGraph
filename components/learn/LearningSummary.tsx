import { Box, Heading, HStack, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { BadgeShelf } from './BadgeShelf';
import type { LearningMemory } from '../../lib/learn-queries';
import type { BadgeInfo } from '../../lib/learn-badges';

/**
 * The user's Ranger School snapshot on /me: enrolled courses, certificates, and the badge shelf. RSC
 * (links via CLink asChild + NextLink). Always renders the heading so learning has a home on /me even
 * before the user starts (a "browse courses" nudge).
 */
export function LearningSummary({ learning, badges }: { learning: LearningMemory; badges: BadgeInfo[] }) {
  const started =
    learning.enrolled.length > 0 ||
    learning.completedLessons.length > 0 ||
    learning.badges.length > 0 ||
    learning.certificates.length > 0;

  return (
    <Box mt={10}>
      <HStack justify="space-between" mb={3}>
        <Heading size="md">Ranger School</Heading>
        <CLink asChild color="brand.fg" fontSize="sm">
          <NextLink href="/learn">{started ? 'All courses →' : 'Browse courses →'}</NextLink>
        </CLink>
      </HStack>

      {!started ? (
        <Text fontSize="sm" color="fg.muted">
          You haven&apos;t started a course yet — ask the Ranger to teach you about a park, or browse the catalog.
        </Text>
      ) : (
        <Stack gap={6}>
          {learning.enrolled.length ? (
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={2}>Enrolled courses</Text>
              <Stack gap={2}>
                {learning.enrolled.map((e) => (
                  <CLink key={e.id} asChild display="block" w="full" _hover={{ textDecoration: 'none' }}>
                    <NextLink href={`/learn/${encodeURIComponent(e.id)}`}>
                      <HStack justify="space-between" borderWidth="1px" borderColor="border" borderRadius="l2" p={3} _hover={{ bg: 'bg.subtle', borderColor: 'brand.solid' }}>
                        <Text fontWeight="medium" lineClamp={1}>{e.title}</Text>
                        <Text color="brand.fg" fontSize="sm" flexShrink={0}>Open →</Text>
                      </HStack>
                    </NextLink>
                  </CLink>
                ))}
              </Stack>
            </Box>
          ) : null}

          {learning.certificates.length ? (
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={2}>Certificates</Text>
              <Stack gap={1}>
                {learning.certificates.map((c) => (
                  <Text key={c.shareSlug} fontSize="sm">
                    📜{' '}
                    <CLink asChild color="brand.fg">
                      <NextLink href={`/learn/cert/${c.shareSlug}`}>
                        {c.courseTitle ?? 'Course certificate'}
                        {typeof c.score === 'number' ? ` · ${Math.round(c.score * 100)}%` : ''} ↗
                      </NextLink>
                    </CLink>
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : null}

          {badges.length ? (
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={2}>Badges</Text>
              <BadgeShelf badges={badges} earnedIds={learning.badges.map((b) => b.id)} />
            </Box>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}

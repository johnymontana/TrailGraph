import { Badge, Box, Card, HStack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import type { LearnCourseCard } from '../../lib/learn-queries';

/**
 * A Ranger School course tile (a `:LessonPlan`). A ParkCard variant without a hero image (NPS lesson plans
 * carry no image): a branded pine band + title + subject/grade/lesson badges + park. The card-in-grid
 * gotcha applies — `display=block w=full` on the link, `minW=0 w=full` on the Card.Root.
 */
export function CourseCard({ course }: { course: LearnCourseCard }) {
  return (
    <CLink asChild _hover={{ textDecoration: 'none' }} display="block" w="full" h="full">
      <NextLink href={`/learn/${encodeURIComponent(course.id)}`}>
        <Card.Root variant="interactive" overflow="hidden" minW={0} w="full" h="full">
          <Box h="6px" bg="pine.solid" />
          <Card.Body p={4} gap={2}>
            <Text fontFamily="heading" fontWeight="semibold" lineClamp={2}>{course.title}</Text>
            <HStack gap={2} wrap="wrap">
              {course.subject ? <Badge colorPalette="pine" size="sm">{course.subject}</Badge> : null}
              {course.gradeLevel ? <Badge colorPalette="trail" size="sm">{course.gradeLevel}</Badge> : null}
              {course.decomposed ? (
                <Badge colorPalette="sand" size="sm">{course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}</Badge>
              ) : null}
            </HStack>
            {course.parkName ? <Text fontSize="sm" color="fg.muted" lineClamp={1}>{course.parkName}</Text> : null}
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
  );
}

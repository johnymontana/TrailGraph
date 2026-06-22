import { Box, SimpleGrid, Skeleton, Stack, Flex } from '@chakra-ui/react';

/** Skeleton shown while the Explore server query runs (R4 §2.9 — the slowest route). */
export default function ExploreLoading() {
  return (
    <Box maxW="6xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      <Skeleton height="28px" width="280px" mb={4} />
      <Flex gap={3} wrap="wrap" mb={6}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="38px" width="160px" borderRadius="md" />
        ))}
      </Flex>
      <Skeleton height="16px" width="180px" mb={3} />
      <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Stack key={i} borderWidth="1px" borderRadius="lg" overflow="hidden" gap={0}>
            <Skeleton height="140px" />
            <Stack p={3} gap={2}>
              <Skeleton height="16px" width="80%" />
              <Skeleton height="12px" width="50%" />
            </Stack>
          </Stack>
        ))}
      </SimpleGrid>
    </Box>
  );
}

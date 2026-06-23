import { Box, Container, SimpleGrid, Skeleton, Stack } from '@chakra-ui/react';

/** Skeleton shown while the Explore server query runs (R4 §2.9 — the slowest route). */
export default function ExploreLoading() {
  return (
    <Box>
      {/* Header band placeholder */}
      <Box bg="bg.subtle" borderBottomWidth="1px" borderColor="border">
        <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
          <Skeleton height="14px" width="80px" mb={3} />
          <Skeleton height="40px" width="300px" mb={3} />
          <Skeleton height="18px" width="440px" maxW="full" />
        </Container>
      </Box>

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        <Skeleton height="84px" borderRadius="l2" mb={6} />
        <Skeleton height="14px" width="180px" mb={4} />
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Stack key={i} borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" gap={0}>
              <Skeleton height="200px" />
              <Stack p={3} gap={2}>
                <Skeleton height="16px" width="80%" />
                <Skeleton height="12px" width="50%" />
              </Stack>
            </Stack>
          ))}
        </SimpleGrid>
      </Container>
    </Box>
  );
}

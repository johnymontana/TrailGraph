import { Box, Skeleton, Stack, HStack, Spinner, Text } from '@chakra-ui/react';

/**
 * Full-screen basemap skeleton (#12) shown while the map RSC awaits consideredBounds(). Mirrors the
 * fixed full-screen container (top: 57px navbar offset, data-fullscreen so the footer stays hidden) and
 * sketches the Layers panel + a centered loading hint so the first paint reads as "loading", not "broken".
 */
export default function MapLoading() {
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0} bg="bg.subtle" data-fullscreen>
      {/* Faux Layers panel (top-left) */}
      <Box position="absolute" top={3} left={3} bg="bg.panel/90" borderWidth="1px" borderColor="border" borderRadius="l2" p={3} shadow="md">
        <Skeleton height="10px" width="48px" mb={3} />
        <Stack gap={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <HStack key={i} gap={2}>
              <Skeleton height="14px" width="14px" borderRadius="sm" />
              <Skeleton height="12px" width={`${90 - i * 8}px`} />
            </HStack>
          ))}
        </Stack>
      </Box>

      {/* Centered loading hint */}
      <HStack
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="full"
        px={4}
        py={2}
        shadow="md"
        gap={2}
        aria-live="polite"
      >
        <Spinner size="sm" color="brand.solid" />
        <Text fontSize="sm" color="fg.muted">Loading map…</Text>
      </HStack>
    </Box>
  );
}

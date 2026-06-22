import { Box, Text } from '@chakra-ui/react';
import { placeholderBackground } from '../lib/placeholder';

/**
 * Branded fill for image-less NPS units (ADR-039, friction #11). Replaces the single repeated green→blue
 * gradient with a subtle topographic-contour motif whose hue is derived **deterministically** from a key
 * (the park/place code or name) — so adjacent cards differ but a given item is stable across renders and
 * SSR === CSR. Renders `position:absolute; inset:0`, so drop it inside any `position:relative` container
 * (card thumb, hero, place tile). Hue/background logic lives in `lib/placeholder.ts` (unit-tested).
 */
export function Placeholder({ name, label }: { name: string; label?: string }) {
  return (
    <Box
      position="absolute"
      inset={0}
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={3}
      style={{ background: placeholderBackground(name) }}
    >
      <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.900" textAlign="center" lineClamp={2}>
        🏞️ {label ?? name}
      </Text>
    </Box>
  );
}

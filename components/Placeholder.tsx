import { Box, Text } from '@chakra-ui/react';
import { placeholderBackground } from '../lib/placeholder';

/**
 * Branded fill for image-less NPS units (ADR-039, friction #11). Replaces the single repeated green→blue
 * gradient with a subtle topographic-contour motif whose hue is derived **deterministically** from a key
 * (the park/place code or name) — so adjacent cards differ but a given item is stable across renders and
 * SSR === CSR. Renders `position:absolute; inset:0`, so drop it inside any `position:relative` container
 * (card thumb, hero, place tile). Hue/background logic lives in `lib/placeholder.ts` (unit-tested).
 *
 * `iconOnly` renders just the 🏞️ glyph (no name) — use it on tiles whose title is shown right beneath
 * them (place/search tiles), so the name isn't duplicated.
 */
export function Placeholder({ name, label, iconOnly }: { name: string; label?: string; iconOnly?: boolean }) {
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
      {iconOnly ? (
        <Text fontSize="2xl" color="whiteAlpha.900" aria-hidden>🏞️</Text>
      ) : (
        <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.900" textAlign="center" lineClamp={2}>
          🏞️ {label ?? name}
        </Text>
      )}
    </Box>
  );
}

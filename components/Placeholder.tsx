import { Box, Text } from '@chakra-ui/react';

/**
 * Branded fill for image-less NPS units (ADR-039, friction #11). Replaces the single repeated green→blue
 * gradient with a subtle topographic-contour motif whose hue is derived **deterministically** from a key
 * (the park/place code or name) — so adjacent cards differ but a given item is stable across renders and
 * SSR === CSR (no `Math.random`/`Date`). Renders `position:absolute; inset:0`, so drop it inside any
 * `position:relative` container (card thumb, hero, place tile).
 */
function hashHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Placeholder({ name, label }: { name: string; label?: string }) {
  const hue = hashHue(name || 'park');
  const h2 = (hue + 40) % 360;
  // repeating-radial-gradient = faint concentric "contour lines"; linear base = the hue wash.
  const background =
    `repeating-radial-gradient(circle at 28% 118%, rgba(255,255,255,0) 0 17px, rgba(255,255,255,0.07) 17px 18px),` +
    `linear-gradient(135deg, hsl(${hue} 46% 34%), hsl(${h2} 52% 22%))`;
  return (
    <Box
      position="absolute"
      inset={0}
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={3}
      style={{ background }}
    >
      <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.900" textAlign="center" lineClamp={2}>
        🏞️ {label ?? name}
      </Text>
    </Box>
  );
}

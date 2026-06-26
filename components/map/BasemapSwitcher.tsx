'use client';
import { Box, HStack, Button, Text } from '@chakra-ui/react';
import { BASEMAPS, type Basemap } from '../../lib/mapStyle';

/**
 * Basemap family switcher for the full-screen map (S1). Presentational only — the map owns the
 * `setStyle` + overlay re-install (MapExplorer). Styled to match the Layers panel (bg.panel/90, blur,
 * l2, shadow). Today the registry is Topo/Dark (both protomaps themes); satellite/terrain slot in later.
 */
export function BasemapSwitcher({ value, onChange }: { value: Basemap; onChange: (b: Basemap) => void }) {
  return (
    <Box
      position="absolute"
      bottom={3}
      right={3}
      bg="bg.panel/90"
      backdropFilter="blur(8px)"
      borderWidth="1px"
      borderColor="border"
      borderRadius="l2"
      p={1.5}
      shadow="md"
      role="group"
      aria-label="Basemap style"
    >
      <Text srOnly>Basemap style</Text>
      <HStack gap={1}>
        {BASEMAPS.map((b) => (
          <Button
            key={b.key}
            size="xs"
            colorPalette="pine"
            variant={value === b.key ? 'solid' : 'ghost'}
            aria-pressed={value === b.key}
            onClick={() => onChange(b.key)}
          >
            {b.label}
          </Button>
        ))}
      </HStack>
    </Box>
  );
}

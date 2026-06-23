/**
 * Semantic tokens — light-first, with `_dark` overrides so dark mode is automatic. Components consume
 * these (`bg.canvas`, `fg.muted`, `brand.fg`, `colorPalette="pine"`) instead of raw scale values.
 *
 * Each brand palette (pine/trail/sand) gets the full Chakra `colorPalette` contract
 * (solid/contrast/fg/muted/subtle/emphasized/focusRing) so `colorPalette="pine"` works on Button, Badge,
 * etc. exactly like the built-in palettes.
 */
import { defineSemanticTokens } from '@chakra-ui/react';
import { ink } from './colors';

/** Build the standard colorPalette slot set for a brand scale (light base + dark override). */
function palette(name: 'pine' | 'trail' | 'sand') {
  const c = (n: number) => `{colors.${name}.${n}}`;
  return {
    solid: { value: { base: c(600), _dark: c(400) } },
    contrast: { value: { base: 'white', _dark: c(950) } },
    fg: { value: { base: c(700), _dark: c(300) } },
    muted: { value: { base: c(100), _dark: c(900) } },
    subtle: { value: { base: c(50), _dark: c(950) } },
    emphasized: { value: { base: c(200), _dark: c(800) } },
    focusRing: { value: { base: c(500), _dark: c(400) } },
  };
}

export const semanticTokens = defineSemanticTokens({
  colors: {
    // Brand palettes — enable colorPalette="pine" | "trail" | "sand".
    pine: palette('pine'),
    trail: palette('trail'),
    sand: palette('sand'),

    // Convenience aliases for direct use (color="brand.fg", bg="accent.subtle").
    brand: {
      solid: { value: { base: '{colors.pine.600}', _dark: '{colors.pine.400}' } },
      fg: { value: { base: '{colors.pine.700}', _dark: '{colors.pine.300}' } },
      muted: { value: { base: '{colors.pine.100}', _dark: '{colors.pine.900}' } },
      subtle: { value: { base: '{colors.pine.50}', _dark: '{colors.pine.950}' } },
      contrast: { value: { base: 'white', _dark: '{colors.pine.950}' } },
    },
    accent: {
      solid: { value: { base: '{colors.trail.500}', _dark: '{colors.trail.400}' } },
      fg: { value: { base: '{colors.trail.600}', _dark: '{colors.trail.300}' } },
      muted: { value: { base: '{colors.trail.100}', _dark: '{colors.trail.900}' } },
      subtle: { value: { base: '{colors.trail.50}', _dark: '{colors.trail.950}' } },
    },

    // Global surfaces — warm parchment in light, warm near-black in dark.
    bg: {
      DEFAULT: { value: { base: 'white', _dark: ink.canvas } },
      canvas: { value: { base: '{colors.sand.50}', _dark: ink.canvas } },
      subtle: { value: { base: '{colors.sand.100}', _dark: ink.subtle } },
      muted: { value: { base: '{colors.sand.200}', _dark: ink.muted } },
      emphasized: { value: { base: '{colors.sand.300}', _dark: ink.emphasized } },
      panel: { value: { base: 'white', _dark: ink.panel } },
    },

    // Text.
    fg: {
      DEFAULT: { value: { base: '{colors.sand.950}', _dark: '{colors.sand.50}' } },
      muted: { value: { base: '{colors.sand.700}', _dark: '{colors.sand.300}' } },
      subtle: { value: { base: '{colors.sand.600}', _dark: '{colors.sand.400}' } },
      inverted: { value: { base: 'white', _dark: '{colors.sand.950}' } },
    },

    // Borders.
    border: {
      DEFAULT: { value: { base: '{colors.sand.200}', _dark: ink.border } },
      muted: { value: { base: '{colors.sand.100}', _dark: ink.borderSubtle } },
      emphasized: { value: { base: '{colors.sand.300}', _dark: '{colors.sand.800}' } },
    },
  },
});

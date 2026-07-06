/**
 * TrailGraph "Topographic Adventure" design system. Assembled from tokens, semantic tokens, recipes, and
 * slot recipes and merged onto Chakra's defaultConfig. Passed to <ChakraProvider value={system}> in
 * app/provider.tsx (replaces the bare `defaultSystem`).
 *
 * After changing tokens/recipes here, run `pnpm theme:typegen` so custom palettes/recipe variants type.
 */
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { tokens } from './tokens';
import { semanticTokens } from './semantic-tokens';
import { recipes } from './recipes';
import { slotRecipes } from './slot-recipes';

const config = defineConfig({
  // Brand the focus ring and let warm parchment be the page canvas.
  globalCss: {
    'html, body': {
      bg: 'bg.canvas',
      color: 'fg',
      fontFamily: 'body',
    },
    '*::selection': {
      bg: 'brand.muted',
    },
    '*:focus-visible': {
      outlineColor: 'brand.solid',
    },
    // Full-screen routes (/map, /graph, /plan) mark their fixed container with `data-fullscreen`; hide
    // the global footer there purely via CSS so it never adds a stray scroll region behind the overlay.
    'body:has([data-fullscreen]) footer': {
      display: 'none',
    },
    // MapLibre popups ship a fixed white background with NO text color, so popup text inherits the
    // `fg` token above — near-white in dark mode → white-on-white. Restyle content + tip (the tip is
    // drawn with CSS borders, one side per anchor) so popups follow color mode. `!important` is
    // LOAD-BEARING: Chakra emits globalCss inside `@layer base`, and layered rules lose to the
    // un-layered maplibre-gl.css no matter the specificity — importance inverts layer order, so these
    // are the only declarations here that can beat it. Values are raw token vars (they flip per mode).
    '.maplibregl-popup-content': {
      background: 'var(--chakra-colors-bg-panel) !important',
      color: 'var(--chakra-colors-fg) !important',
      borderRadius: 'var(--chakra-radii-md) !important',
      boxShadow: 'var(--chakra-shadows-md) !important',
    },
    '.maplibregl-popup-close-button': {
      color: 'var(--chakra-colors-fg-muted) !important',
    },
    '.maplibregl-popup-anchor-top .maplibregl-popup-tip, .maplibregl-popup-anchor-top-left .maplibregl-popup-tip, .maplibregl-popup-anchor-top-right .maplibregl-popup-tip':
      { borderBottomColor: 'var(--chakra-colors-bg-panel) !important' },
    '.maplibregl-popup-anchor-bottom .maplibregl-popup-tip, .maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip, .maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip':
      { borderTopColor: 'var(--chakra-colors-bg-panel) !important' },
    '.maplibregl-popup-anchor-left .maplibregl-popup-tip': { borderRightColor: 'var(--chakra-colors-bg-panel) !important' },
    '.maplibregl-popup-anchor-right .maplibregl-popup-tip': { borderLeftColor: 'var(--chakra-colors-bg-panel) !important' },
  },
  theme: {
    tokens,
    semanticTokens,
    recipes,
    slotRecipes,
    keyframes: {
      tgPulse: {
        '0%, 100%': { opacity: '0.25' },
        '50%': { opacity: '1' },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

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
      color: 'fg.default',
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

/**
 * Recipe overrides — gentle brand tweaks deep-merged into Chakra's default component recipes via
 * createSystem(defaultConfig, config). We only add base style + variants; we never replace the defaults.
 */
import { defineRecipe } from '@chakra-ui/react';

export const buttonRecipe = defineRecipe({
  base: {
    fontWeight: 'semibold',
    borderRadius: 'l2',
    letterSpacing: '0.01em',
  },
});

export const badgeRecipe = defineRecipe({
  base: {
    borderRadius: 'l1',
    fontWeight: 'medium',
    textTransform: 'none',
  },
});

export const inputRecipe = defineRecipe({
  base: {
    borderRadius: 'l2',
  },
});

export const headingRecipe = defineRecipe({
  base: {
    fontFamily: 'heading',
    letterSpacing: '-0.015em',
  },
});

export const recipes = {
  button: buttonRecipe,
  badge: badgeRecipe,
  input: inputRecipe,
  heading: headingRecipe,
};

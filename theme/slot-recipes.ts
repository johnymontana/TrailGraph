/**
 * Slot-recipe overrides — branded surfaces with multiple coordinated parts. We override Chakra's built-in
 * `card` slot recipe (used via <Card.Root>/<Card.Body>/…) so every card across the app shares brand radii,
 * borders, and an `interactive` hover variant for clickable cards (park cards, tool cards).
 */
import { defineSlotRecipe } from '@chakra-ui/react';

export const cardSlotRecipe = defineSlotRecipe({
  slots: ['root', 'header', 'body', 'footer', 'title', 'description'],
  base: {
    root: {
      borderRadius: 'l2',
      borderColor: 'border',
      bg: 'bg.panel',
    },
    title: { fontFamily: 'heading', letterSpacing: '-0.01em' },
  },
  variants: {
    variant: {
      // Clickable card: subtle lift + pine border on hover. Added alongside Chakra's elevated/outline/subtle.
      interactive: {
        root: {
          cursor: 'pointer',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
          _hover: {
            transform: 'translateY(-2px)',
            boxShadow: 'lg',
            borderColor: 'brand.solid',
          },
        },
      },
    },
  },
});

export const slotRecipes = {
  card: cardSlotRecipe,
};

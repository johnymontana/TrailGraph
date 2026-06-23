/**
 * Reusable topographic-contour textures for heroes and section bands. Built from Chakra color CSS vars
 * (e.g. `--chakra-colors-border`) so they adapt to light/dark automatically — drop into `backgroundImage`.
 * The contour motif ties back to the placeholder fill (lib/placeholder.ts) and the brand identity.
 */

/** Faint concentric contour lines anchored bottom-left — subtle behind page headers / section bands. */
export const contourTexture =
  'repeating-radial-gradient(circle at 12% 130%, transparent 0 26px, ' +
  'color-mix(in srgb, var(--chakra-colors-border) 75%, transparent) 26px 27px, transparent 27px 54px)';

/** Stronger contour wash for full hero sections — two offset elevation centers over a brand tint. */
export const heroContourTexture =
  'repeating-radial-gradient(circle at 85% -10%, transparent 0 30px, ' +
  'color-mix(in srgb, var(--chakra-colors-pine-500) 14%, transparent) 30px 31px, transparent 31px 62px),' +
  'repeating-radial-gradient(circle at 8% 120%, transparent 0 34px, ' +
  'color-mix(in srgb, var(--chakra-colors-trail-500) 12%, transparent) 34px 35px, transparent 35px 70px)';

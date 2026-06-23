/**
 * Pure helpers for the branded image-less placeholder (ADR-039). Kept DOM-free so the hue derivation is
 * unit-testable and SSR-safe (no `Math.random`/`Date`): a given key always yields the same hue, so the
 * server and client render identical markup, and adjacent items vary.
 *
 * Hues are constrained to the brand arc (pine green → trail orange, ~95°–35° on the HSL wheel) so every
 * placeholder reads as part of the "Topographic Adventure" palette instead of an arbitrary rainbow, while
 * still varying enough that adjacent cards differ.
 */

/** Deterministic 0–359 raw hash from a key (park/place code or name). */
export function placeholderHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Map the raw hash into the brand hue arc (deep pine ~150° down through olive to trail ~28°). */
function brandHue(key: string): number {
  // 150° (pine) .. 28° (trail), 122° of range — earthy greens through golds to burnt orange.
  return 28 + (placeholderHue(key) / 360) * 122;
}

/** CSS `background` for the placeholder: a faint topographic-contour overlay over a brand-hue wash. */
export function placeholderBackground(key: string): string {
  const hue = brandHue(key || 'park');
  const h2 = hue + 14; // gentle second stop toward the warmer/darker end
  return (
    `repeating-radial-gradient(circle at 24% 120%, rgba(255,255,255,0) 0 16px, rgba(255,255,255,0.08) 16px 17px, rgba(255,255,255,0) 17px 34px),` +
    `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${h2} 48% 20%))`
  );
}

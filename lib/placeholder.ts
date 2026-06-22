/**
 * Pure helpers for the branded image-less placeholder (ADR-039). Kept DOM-free so the hue derivation is
 * unit-testable and SSR-safe (no `Math.random`/`Date`): a given key always yields the same hue, so the
 * server and client render identical markup, and adjacent items vary.
 */

/** Deterministic 0–359 hue from a key (park/place code or name). */
export function placeholderHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** CSS `background` for the placeholder: a faint topographic-contour overlay over a hue wash. */
export function placeholderBackground(key: string): string {
  const hue = placeholderHue(key || 'park');
  const h2 = (hue + 40) % 360;
  return (
    `repeating-radial-gradient(circle at 28% 118%, rgba(255,255,255,0) 0 17px, rgba(255,255,255,0.07) 17px 18px),` +
    `linear-gradient(135deg, hsl(${hue} 46% 34%), hsl(${h2} 52% 22%))`
  );
}

/**
 * Decode the handful of HTML entities that leak into model-generated free text (R5 §2.1). Names the
 * ranger writes routinely contain `&` (e.g. "Utah Dark Skies & Easy Hikes"); somewhere upstream that
 * arrives HTML-escaped, so the value persisted to Neo4j is the literal entity (`&amp;`). React then
 * escapes it again on render and the user sees `&amp;`. We decode ONCE at the write boundary
 * (`lib/trips.ts`) so stored names hold the real character. Inverse of the output-only `esc()`
 * (`lib/trip-brief-html.ts`) / `xmlEsc()` (`lib/gpx.ts`) helpers — do not confuse the two.
 *
 * Idempotent on already-clean text. Numeric (`&#39;` / `&#x27;`) and the common named entities only —
 * we deliberately do NOT pull in a full entity table; trip/stop names never carry exotic entities.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    // Numeric: &#NN; (decimal) or &#xHH; (hex)
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED[body.toLowerCase()];
    return named ?? match;
  });
}

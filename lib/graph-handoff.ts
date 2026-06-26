/**
 * Plan-from-graph handoff (#10): the pure codec for the `?seed=` deep-link that carries a set of park codes
 * from the /graph multi-select to /plan. Kept pure + unit-tested so both the link builder (graph side) and
 * the reader (ChatPanel one-shot) agree exactly. Codes are normalised (trimmed, lowercased), de-duplicated,
 * shape-validated (NPS park codes are short alphanumerics), and CAPPED — a deep link can't blow up an
 * itinerary or smuggle junk into the model context.
 */
export const SEED_CAP = 12;

// NPS park codes are short lowercase alphanumerics (e.g. `yell`, `grca`, `wrst`). Validate the shape so a
// hand-edited / injected `?seed=` can't carry arbitrary strings into the seeded itinerary message.
const CODE_RE = /^[a-z0-9]{2,12}$/;

/** Normalise + dedupe + cap a list of park codes into the `?seed=` value (`yell,grca,zion`). */
export function encodeSeed(codes: Iterable<string>): string {
  return normalize(codes).join(',');
}

/** Parse the `?seed=` value back into a clean, capped park-code list (invalid/blank entries dropped). */
export function decodeSeed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return normalize(raw.split(','));
}

function normalize(codes: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const code = String(c).trim().toLowerCase();
    if (!CODE_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= SEED_CAP) break;
  }
  return out;
}

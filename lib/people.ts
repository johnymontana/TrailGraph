/**
 * Person `tags` come straight from the NPS API and are noisy: case variants, duplicates, and the
 * person's own title/aliases repeated as tags (e.g. for "Muir Woods": "Muir Woods, muir woods national
 * monument, botany"). We clean them at render time (ADR-039, friction #8) — no resync — so the stored
 * data stays faithful to the source while the UI reads cleanly.
 */
export function cleanTags(title: string, tags: string[] | null | undefined): string[] {
  const titleNorm = normalize(title);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = (raw ?? '').trim();
    if (!tag) continue;
    const norm = normalize(tag);
    if (!norm) continue;
    // Drop tags that just echo the person's title — the exact title, or a longer string that contains
    // the whole title (e.g. title "Muir Woods" vs tag "muir woods national monument"). We deliberately
    // do NOT drop tags that are merely substrings of the title, to avoid nuking short legit tags.
    if (titleNorm && (norm === titleNorm || norm.includes(titleNorm))) continue;
    // Case-insensitive duplicates (first wins).
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(titleCase(tag));
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Regional/agency acronyms that should stay uppercase in a label (R5 §2.9). NPS person tags carry these
// run together (e.g. "SWScience"); once we split them out we don't want "Sw"/"Nps".
const ACRONYMS = new Set(['nps', 'sw', 'se', 'ne', 'nw', 'us', 'usa', 'usgs', 'ccc', 'tva', 'wwi', 'wwii']);

/**
 * Split a tag into words on whitespace, common delimiters (-, /, _), AND camelCase boundaries — including
 * the "SWScience" → "SW Science" case (R5 §2.9). Boundaries are detected on the ORIGINAL casing FIRST,
 * before any lowercasing, or the camelCase signal would be lost. Genuinely concatenated all-lowercase
 * source tags ("swscience") have no recoverable boundary and are left as a single word.
 */
function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // SWScience → SW Science, NPSHistory → NPS History
    .split(/[\s\-/_]+/)
    .filter(Boolean);
}

function titleCase(s: string): string {
  // Split on word boundaries, then normalize each word to one casing style — uppercasing known acronyms.
  return splitWords(s)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

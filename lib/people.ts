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

function titleCase(s: string): string {
  // Lowercase, then capitalize each word — collapses ALL-CAPS / inconsistent casing to one style.
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

import { readGraph } from './neo4j';

/**
 * Preference → domain-vocabulary canonicalization (ADR-011, refined).
 *
 * NAMS extracts the user's words ("stargazing"); the domain speaks NPS's controlled vocabulary
 * ("Astronomy"). We map one to the other so cross-graph joins are node traversals, not string
 * compares. The alias map is seeded from the live NPS Activity/Topic names (a closed set) plus a
 * small curated synonym list. Misses return null (no guess laundered into a bridge — same discipline
 * as the alert decision).
 */

export type CanonKind = 'activity' | 'topic' | 'amenity';
export interface CanonTarget {
  kind: CanonKind;
  name: string;
  method: 'exact' | 'synonym';
}

// Curated synonyms: user phrasing → canonical NPS name. Extend as we see real transcripts.
const SYNONYMS: Record<string, { kind: CanonKind; name: string }> = {
  stargazing: { kind: 'activity', name: 'Astronomy' },
  'dark skies': { kind: 'activity', name: 'Astronomy' },
  'dark sky': { kind: 'activity', name: 'Astronomy' },
  'night sky': { kind: 'activity', name: 'Astronomy' },
  backpacking: { kind: 'activity', name: 'Backcountry Hiking' },
  'backcountry skiing': { kind: 'activity', name: 'Skiing' },
  birding: { kind: 'activity', name: 'Birdwatching' },
  'bird watching': { kind: 'activity', name: 'Birdwatching' },
  climbing: { kind: 'activity', name: 'Rock Climbing' },
  paddling: { kind: 'activity', name: 'Kayaking' },
  volcanoes: { kind: 'topic', name: 'Volcanoes' },
  'alpine lakes': { kind: 'topic', name: 'Lakes' },
  // hiking variants
  hiking: { kind: 'activity', name: 'Hiking' },
  hike: { kind: 'activity', name: 'Hiking' },
  hikes: { kind: 'activity', name: 'Hiking' },
  'easy hikes': { kind: 'activity', name: 'Hiking' },
  'day hiking': { kind: 'activity', name: 'Hiking' },
  // wildlife / scenery / water
  wildlife: { kind: 'activity', name: 'Wildlife Watching' },
  'wildlife watching': { kind: 'activity', name: 'Wildlife Watching' },
  scenic: { kind: 'activity', name: 'Scenic Driving' },
  'scenic drives': { kind: 'activity', name: 'Scenic Driving' },
  waterfalls: { kind: 'topic', name: 'Waterfalls' },
  camping: { kind: 'activity', name: 'Camping' },
  fishing: { kind: 'activity', name: 'Fishing' },
  canoeing: { kind: 'activity', name: 'Canoeing' },
  kayaking: { kind: 'activity', name: 'Kayaking' },
  astronomy: { kind: 'activity', name: 'Astronomy' },
};

let cache: Map<string, CanonTarget> | null = null;

/** Build {normalized name → target} from the live domain vocabulary + curated synonyms. */
async function aliasMap(): Promise<Map<string, CanonTarget>> {
  if (cache) return cache;
  const m = new Map<string, CanonTarget>();
  const rows = await readGraph<{ activities: string[]; topics: string[]; amenities: string[] }>(
    `CALL { MATCH (a:Activity) RETURN collect(a.name) AS activities }
     CALL { MATCH (t:Topic) RETURN collect(t.name) AS topics }
     CALL { MATCH (am:Amenity) RETURN collect(am.name) AS amenities }
     RETURN activities, topics, amenities`,
  );
  for (const name of rows[0]?.activities ?? []) {
    if (name) m.set(name.toLowerCase(), { kind: 'activity', name, method: 'exact' });
  }
  for (const name of rows[0]?.topics ?? []) {
    if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), { kind: 'topic', name, method: 'exact' });
  }
  // Amenities are the §accessibility/comfort vocabulary (REQUIRES/PREFERS targets). Activities/topics win ties.
  for (const name of rows[0]?.amenities ?? []) {
    if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), { kind: 'amenity', name, method: 'exact' });
  }
  for (const [phrase, target] of Object.entries(SYNONYMS)) {
    if (!m.has(phrase)) m.set(phrase, { ...target, method: 'synonym' });
  }
  cache = m;
  return m;
}

/** Resolve a free-text preference value to a domain Activity/Topic, or null if no confident match. */
export async function canonicalizeValue(value: string): Promise<CanonTarget | null> {
  const m = await aliasMap();
  return m.get(value.trim().toLowerCase()) ?? null;
}

/**
 * Deterministic recall (R2 §3.2): scan free text (e.g. a chat message) for ANY known
 * activity/topic/synonym phrase and return the matched canonical targets. Longer phrases win over
 * substrings ("alpine lakes" before "lakes"). Independent of NAMS extraction, so a single sentence
 * yields the full set of stated preferences.
 */
export async function extractCanonicalTerms(text: string): Promise<{ value: string; target: CanonTarget }[]> {
  const m = await aliasMap();
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const phrases = [...m.keys()].sort((a, b) => b.length - a.length); // longest-first
  const out: { value: string; target: CanonTarget }[] = [];
  const claimedNames = new Set<string>();
  for (const phrase of phrases) {
    if (phrase.length < 4) continue; // avoid noisy 1–3 char matches
    if (hay.includes(` ${phrase} `) || hay.includes(` ${phrase}s `) || hay.includes(`${phrase} `)) {
      const target = m.get(phrase)!;
      if (claimedNames.has(target.name)) continue; // one bridge per canonical node
      claimedNames.add(target.name);
      out.push({ value: phrase, target });
    }
  }
  return out;
}

/** For tests / refresh after a sync changes the vocabulary. */
export function resetAliasCache() {
  cache = null;
}

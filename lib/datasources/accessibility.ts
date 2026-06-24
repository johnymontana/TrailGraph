import { writeGraph } from '../neo4j';

/**
 * Accessibility taxonomy (plan F5) — REUSES the existing `:Amenity` vocabulary + `REQUIRES` bridge rather
 * than a new label (per the design decision). A curated set of canonical accessibility amenities is tagged
 * `accessibility = true`; per-entity accessibility blobs are mapped to these and linked via the existing
 * `HAS_AMENITY` edge, so `vibeSearch`/`explain`/`recommend` REQUIRES->:Amenity filters work unchanged.
 *
 * DATA-TRUST: NPS accessibility data is self-reported and uneven. Derivation is conservative (explicit
 * matches + a negation guard); always render as "reported, verify with the park", never a guarantee.
 */
export interface AccessAmenity {
  id: string; // deterministic synthetic id ('amen:<slug>') — distinct from NPS amenity GUIDs
  name: string;
  match: RegExp;
}

export const ACCESS_AMENITIES: AccessAmenity[] = [
  { id: 'amen:wheelchair-accessible', name: 'Wheelchair Accessible', match: /wheelchair|wheel chair|\bada\b/i },
  { id: 'amen:audio-description', name: 'Audio Description', match: /audio descri/i },
  { id: 'amen:braille', name: 'Braille', match: /braille/i },
  { id: 'amen:assistive-listening', name: 'Assistive Listening', match: /assistive listen|hearing loop|assistive[- ]listening/i },
  { id: 'amen:accessible-restroom', name: 'Accessible Restroom', match: /accessible restroom|accessible toilet|ada restroom/i },
  { id: 'amen:accessible-parking', name: 'Accessible Parking', match: /accessible parking|handicap parking|ada parking|disabled parking/i },
];

const ACCESS_BY_ID = new Map(ACCESS_AMENITIES.map((a) => [a.id, a.name]));
export const ACCESS_NAME_BY_ID: Record<string, string> = Object.fromEntries(ACCESS_BY_ID);
const NEGATION = /not accessible|no wheelchair|not wheelchair|inaccessible|not ada/i;

/** Map free accessibility text to canonical accessibility amenity ids. Pure (unit-tested). */
export function accessibilityFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const negated = NEGATION.test(text);
  for (const a of ACCESS_AMENITIES) {
    if (!a.match.test(text)) continue;
    // a negation only suppresses the generic wheelchair claim; specific features (braille/audio) still hold.
    if (a.id === 'amen:wheelchair-accessible' && negated) continue;
    out.add(a.id);
  }
  return [...out];
}

/**
 * Resolve an entity's accessibility signals (free text + already-normalized booleans) to canonical
 * accessibility amenity ids. Pure (unit-tested).
 */
export function deriveAccessibilityAmenityIds(input: {
  text?: string | null;
  wheelchair?: boolean;
  audioDescription?: boolean;
}): string[] {
  const ids = new Set<string>(accessibilityFromText(input.text));
  if (input.wheelchair) ids.add('amen:wheelchair-accessible');
  if (input.audioDescription) ids.add('amen:audio-description');
  return [...ids];
}

/**
 * Ensure the canonical accessibility `:Amenity` nodes exist + are tagged, and tag any EXISTING NPS amenity
 * whose name reads as accessibility-related (e.g. a real "Accessible Restrooms" amenity from /amenities).
 * Idempotent; rides `syncDataSources()`. Returns the count of canonical nodes ensured.
 */
export async function applyAccessibilityTaxonomy(): Promise<number> {
  await writeGraph(
    `UNWIND $rows AS row
     MERGE (a:Amenity {id: row.id}) SET a.name = row.name, a.accessibility = true`,
    { rows: ACCESS_AMENITIES.map((a) => ({ id: a.id, name: a.name })) },
  );
  // Tag existing NPS amenities whose NAME signals accessibility (so facets can surface them).
  await writeGraph(
    `MATCH (a:Amenity)
     WHERE a.name IS NOT NULL AND (
       toLower(a.name) CONTAINS 'accessible' OR toLower(a.name) CONTAINS 'wheelchair' OR
       toLower(a.name) CONTAINS 'braille' OR toLower(a.name) CONTAINS 'audio descri' OR
       toLower(a.name) CONTAINS 'assistive listening')
     SET a.accessibility = true`,
  );
  return ACCESS_AMENITIES.length;
}

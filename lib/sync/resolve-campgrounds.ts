import { readGraph, writeGraph } from '../neo4j';

/**
 * Cross-source campground entity resolution (Campgrounds feature, Phase 4; gated `RESOLVE_CAMPGROUNDS=1`).
 * The genuinely hard problem (feature plan §9): the same campground appears in RIDB AND OSM (and later USFS
 * GIS / Overture) under different names/coords. The FEDERAL set never needs this — NPS↔RIDB already unify by
 * ridbId. This step dedups NON-federal candidates (`source='osm'`) against the federal canon by
 * **name + geodistance**: a near coincident pair with a similar name is merged INTO the federal node
 * (sourceIds combined, dataConfidence raised to 'high', amenities relinked), and the OSM node retired.
 * Conservative — only merges on BOTH proximity (<250m) AND a name match, so it never collapses two real
 * neighbours. The name-similarity core is pure + unit-tested. Returns `{skipped:1}` until OSM data exists.
 */

const STOPWORDS = new Set(['campground', 'campsite', 'camp', 'cg', 'recreation', 'area', 'site', 'sites', 'the', 'rv', 'park', 'national', 'forest', 'and', 'of']);

/** Normalize a campground name → significant tokens (lowercase, alnum, stopwords dropped). Pure. */
export function normalizeCampName(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Token-set similarity (Jaccard) over normalized names ≥ threshold. Pure. Empty-after-stopwords → false. */
export function nameSimilar(a: string, b: string, threshold = 0.5): boolean {
  const ta = new Set(normalizeCampName(a));
  const tb = new Set(normalizeCampName(b));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
}

interface Pair {
  osmId: string;
  osmName: string;
  osmSourceIds: string | null;
  fedId: string;
  fedName: string;
  fedSourceIds: string | null;
}

function mergeSourceIds(fed: string | null, osm: string | null): string {
  const parse = (s: string | null): Record<string, unknown> => {
    try {
      return s ? (JSON.parse(s) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const f = parse(fed);
  const o = parse(osm);
  return JSON.stringify({ ...f, osmId: o.osmId ?? f.osmId ?? null });
}

export async function resolveCampgrounds(
  radiusMeters = Number(process.env.RESOLVE_RADIUS_METERS) || 250,
): Promise<{ candidates: number; merged: number; skipped?: number }> {
  // Find each OSM campground's nearest federal campground within the radius (index-backed by campground_location).
  const pairs = await readGraph<Pair>(
    `MATCH (o:Campground) WHERE o.source = 'osm' AND o.location IS NOT NULL
     CALL {
       WITH o
       MATCH (f:Campground) WHERE f.source IN ['nps', 'ridb', 'nps+ridb'] AND f.location IS NOT NULL
         AND point.distance(o.location, f.location) < $meters
       RETURN f ORDER BY point.distance(o.location, f.location) ASC LIMIT 1
     }
     RETURN o.id AS osmId, o.name AS osmName, o.sourceIds AS osmSourceIds,
            f.id AS fedId, f.name AS fedName, f.sourceIds AS fedSourceIds`,
    { meters: radiusMeters },
  ).catch(() => []);

  if (!pairs.length) return { candidates: 0, merged: 0, skipped: 1 }; // nothing non-federal to resolve yet

  const matches = pairs.filter((p) => nameSimilar(p.osmName, p.fedName));
  for (const m of matches) {
    await writeGraph(
      `MATCH (o:Campground {id: $osmId}), (f:Campground {id: $fedId})
       SET f.dataConfidence = 'high', f.sourceIds = $merged
       WITH o, f
       CALL { WITH o, f OPTIONAL MATCH (o)-[:HAS_AMENITY]->(am:Amenity) MERGE (f)-[:HAS_AMENITY]->(am) }
       WITH o DETACH DELETE o`,
      { osmId: m.osmId, fedId: m.fedId, merged: mergeSourceIds(m.fedSourceIds, m.osmSourceIds) },
    );
  }
  return { candidates: pairs.length, merged: matches.length };
}

import '../server-guard';
import { readGraph, writeGraph } from '../neo4j';

/**
 * join-thingstodo-trails (ADR-066). Attach curated NPS `:ThingToDo` hikes to the real `:Trail` geometry via
 * `(:ThingToDo)-[:ALONG]->(:Trail)`, matched WITHIN a park by name similarity (token Jaccard, stop-words
 * removed) with a proximity tie-break (ThingToDo point vs trailhead). One trail per ThingToDo (the best
 * match above a threshold). The name matcher is pure + unit-tested; the graph write is rebuilt each run.
 */

export function tokenize(s: string): Set<string> {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

const STOP = new Set(['the', 'and', 'trail', 'hike', 'loop', 'national', 'park', 'walk', 'path']);

/** Jaccard similarity over content tokens (stop-words removed). Pure. Range 0–1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = [...tokenize(a)].filter((w) => !STOP.has(w));
  const tb = new Set([...tokenize(b)].filter((w) => !STOP.has(w)));
  if (ta.length === 0 || tb.size === 0) return 0;
  const inter = ta.filter((w) => tb.has(w)).length;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export async function joinThingsToDoTrails(minSimilarity = 0.34): Promise<Record<string, number>> {
  await writeGraph(`MATCH (:ThingToDo)-[r:ALONG]->(:Trail) DELETE r`);

  const rows = await readGraph<{
    ttdId: string;
    ttdTitle: string;
    trailId: string;
    trailName: string;
    meters: number | null;
  }>(
    `MATCH (ttd:ThingToDo)-[:AT_PARK]->(p:Park)<-[:IN_PARK]-(t:Trail)
     WITH ttd, t,
          CASE WHEN ttd.location IS NOT NULL AND t.trailheadPoint IS NOT NULL
               THEN point.distance(ttd.location, t.trailheadPoint) ELSE null END AS meters
     RETURN ttd.id AS ttdId, coalesce(ttd.title, '') AS ttdTitle,
            t.id AS trailId, coalesce(t.name, '') AS trailName, meters`,
  );

  const best = new Map<string, { trailId: string; score: number }>();
  for (const r of rows) {
    const sim = nameSimilarity(r.ttdTitle, r.trailName);
    if (sim < minSimilarity) continue;
    const proxBonus = r.meters != null && r.meters < 1609 ? 0.15 : 0;
    const score = sim + proxBonus;
    const cur = best.get(r.ttdId);
    if (!cur || score > cur.score) best.set(r.ttdId, { trailId: r.trailId, score });
  }

  const pairs = [...best.entries()].map(([ttdId, v]) => ({ ttdId, trailId: v.trailId }));
  if (!pairs.length) return { along: 0 };

  const res = await writeGraph<{ c: number }>(
    `UNWIND $pairs AS pr
     MATCH (ttd:ThingToDo {id: pr.ttdId}), (t:Trail {id: pr.trailId})
     MERGE (ttd)-[:ALONG]->(t)
     RETURN count(*) AS c`,
    { pairs },
  );
  return { along: res[0]?.c ?? 0 };
}

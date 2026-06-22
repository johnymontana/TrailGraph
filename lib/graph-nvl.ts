import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';

/**
 * Pure data → Neo4j-NVL mappers (no DOM, unit-tested). Two shapes:
 *  - `neighborhoodToNvl` for the /graph constellation (parks linked by shared topics).
 *  - the per-park graph is built server-side in `lib/queries.ts#parkGraph`; `parkNodeNav` here turns a
 *    clicked park-graph node into a route.
 */

// /graph palette — preserves the semantics of the old GraphView (highlight > hub > plain).
export const HUB_DEGREE = 5;
const COLOR_HIGHLIGHT = '#e8590c';
const COLOR_HUB = '#1864ab';
const COLOR_PARK = '#4dabf7';

interface NeighborhoodNode {
  id: string;
  name: string;
  degree?: number;
}
interface NeighborhoodLink {
  source: string;
  target: string;
  value: number;
  topics?: string[];
}

/** Map a `graphNeighborhood()` result to NVL nodes/rels. Highlighted parks override hub/plain color. */
export function neighborhoodToNvl(
  data: { nodes: NeighborhoodNode[]; links: NeighborhoodLink[] },
  highlight: Iterable<string> = [],
): { nodes: NvlNode[]; rels: NvlRel[] } {
  const hi = new Set(highlight);
  const nodes: NvlNode[] = data.nodes.map((n) => ({
    id: n.id,
    caption: n.name,
    size: 6 + Math.min(8, n.degree ?? 0) * 2,
    color: hi.has(n.id) ? COLOR_HIGHLIGHT : (n.degree ?? 0) >= HUB_DEGREE ? COLOR_HUB : COLOR_PARK,
  }));
  const rels: NvlRel[] = data.links.map((l) => ({
    // park↔park links carry no DB id → synthesize a stable one (graphNeighborhood already dedupes pairs).
    id: `${l.source}--${l.target}`,
    from: l.source,
    to: l.target,
    caption: l.topics?.length ? l.topics.join(', ') : `${l.value} shared`,
  }));
  return { nodes, rels };
}

/** Color for a domain node label in the per-park graph. Pure. */
const LABEL_COLOR: Record<string, string> = {
  Park: '#1864ab',
  Activity: '#2f9e44',
  Topic: '#f08c00',
  State: '#9c36b5',
  Campground: '#e8590c',
  VisitorCenter: '#1098ad',
  ThingToDo: '#e64980',
  Alert: '#e03131',
};
export function labelColor(label: string): string {
  return LABEL_COLOR[label] ?? '#868e96';
}

/** Per-park graph node carries a `nav` descriptor so clicks route deterministically (testable). */
export type ParkNodeNav =
  | { kind: 'park'; parkCode: string }
  | { kind: 'activity'; name: string }
  | { kind: 'topic'; name: string }
  | { kind: 'state'; code: string }
  | { kind: 'none' };

/** Turn a clicked park-graph node's nav descriptor into a route (or null when it isn't navigable). */
export function parkNodeNav(nav: ParkNodeNav | undefined): string | null {
  switch (nav?.kind) {
    case 'park':
      return `/parks/${nav.parkCode}`;
    case 'activity':
      return `/explore?activity=${encodeURIComponent(nav.name)}`;
    case 'topic':
      return `/explore?topic=${encodeURIComponent(nav.name)}`;
    case 'state':
      return `/explore?stateCode=${encodeURIComponent(nav.code)}`;
    default:
      return null;
  }
}

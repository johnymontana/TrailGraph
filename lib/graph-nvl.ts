import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';
import { pine, sand, trail } from '../theme/colors';
import type { UserMemory } from './memory-graph';

/**
 * Pure data → Neo4j-NVL mappers (no DOM, unit-tested). Two shapes:
 *  - `neighborhoodToNvl` for the /graph constellation (parks linked by shared topics).
 *  - the per-park graph is built server-side in `lib/queries.ts#parkGraph`; `parkNodeNav` here turns a
 *    clicked park-graph node into a route.
 *
 * Colors come from the brand palette (theme/colors) — trail orange = highlighted, deep pine = hub,
 * mid pine = plain park — so the constellation matches the themed UI. Kept as resolved hex (not Chakra
 * tokens) because NVL renders to canvas/WebGL.
 */

// /graph palette — highlight > hub > plain, mapped onto pine/trail.
export const HUB_DEGREE = 5;
const COLOR_HIGHLIGHT = trail[500];
const COLOR_HUB = pine[600];
const COLOR_PARK = pine[400];

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

/** Stable id prefix for the (non-navigable) center node of a thematic trail mini-graph. */
export const TRAIL_THEME_PREFIX = 'theme:';

/**
 * Map a thematic trail (a Person/Topic theme + the parks it connects) to a small NVL graph: one center
 * theme node with a spoke to each park (ADR-039). Park node ids are park codes so a click routes to the
 * park page; the theme node id is prefixed so the renderer can treat it as non-navigable.
 */
export function trailToNvl(
  themeLabel: string,
  parks: { parkCode: string; name: string }[],
): { nodes: NvlNode[]; rels: NvlRel[] } {
  const themeId = `${TRAIL_THEME_PREFIX}${themeLabel}`;
  const nodes: NvlNode[] = [
    { id: themeId, caption: themeLabel, size: 16, color: COLOR_HIGHLIGHT },
    ...parks.map((p) => ({ id: p.parkCode, caption: p.name, size: 10, color: COLOR_PARK })),
  ];
  const rels: NvlRel[] = parks.map((p) => ({
    id: `${themeId}--${p.parkCode}`,
    from: themeId,
    to: p.parkCode,
    caption: '',
  }));
  return { nodes, rels };
}

// Context-graph (the user's memory) palette — trail accent, distinct from the pine domain graph
// (ADR-047). The "You" anchor is a deeper accent.
export const CONTEXT_PREFIX = 'ctx:';
export const CONTEXT_YOU_ID = 'ctx:You';
const CONTEXT_COLOR = trail[500];
const CONTEXT_YOU = trail[600];

/**
 * Reshape a user's memory (the context graph) into NVL nodes/rels (ADR-047). Pure + unit-tested.
 * Node-id convention (critical for the two-graph overlay merge): CONSIDERED parks reuse the BARE
 * `parkCode` so they merge with the domain constellation; every other context node gets a `ctx:` prefix
 * so it can't collide with a domain park id. Edge captions are the literal relationship types.
 */
export function contextToNvl(memory: UserMemory): { nodes: NvlNode[]; rels: NvlRel[] } {
  const nodes: NvlNode[] = [{ id: CONTEXT_YOU_ID, caption: 'You', size: 18, color: CONTEXT_YOU }];
  const rels: NvlRel[] = [];
  const seen = new Set<string>([CONTEXT_YOU_ID]);
  const seenEdge = new Set<string>();
  const addNode = (id: string, caption: string, size = 11) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, caption, size, color: CONTEXT_COLOR });
  };
  // Dedupe edges too (not just nodes): duplicate input prefs/amenities must not emit duplicate rels.
  const addEdge = (to: string, type: string) => {
    const id = `${CONTEXT_YOU_ID}--${type}--${to}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    rels.push({ id, from: CONTEXT_YOU_ID, to, caption: type });
  };

  for (const p of memory.preferences) {
    const id = `${CONTEXT_PREFIX}${p.kind === 'activity' ? 'Activity' : 'Topic'}:${p.name}`;
    addNode(id, p.name);
    addEdge(id, 'PREFERS');
  }
  for (const c of memory.considered) {
    addNode(c.parkCode, c.name, 12); // BARE parkCode → merges with the domain graph
    addEdge(c.parkCode, 'CONSIDERED');
  }
  for (const t of memory.planned) {
    const id = `${CONTEXT_PREFIX}Trip:${t.tripId}`;
    addNode(id, t.name, 12);
    addEdge(id, 'PLANNED');
  }
  const { wheelchair, rvMaxLengthFt, requiredAmenities } = memory.travel;
  if (wheelchair || rvMaxLengthFt != null) {
    const parts = [wheelchair ? 'wheelchair' : null, rvMaxLengthFt != null ? `RV ≤ ${rvMaxLengthFt}ft` : null].filter(Boolean);
    addNode(`${CONTEXT_PREFIX}Constraint:travel`, parts.join(' · ') || 'constraints');
    addEdge(`${CONTEXT_PREFIX}Constraint:travel`, 'TRAVELS_WITH');
  }
  for (const a of requiredAmenities) {
    const id = `${CONTEXT_PREFIX}Amenity:${a}`;
    addNode(id, a);
    addEdge(id, 'REQUIRES');
  }
  for (const pass of memory.passes) {
    const id = `${CONTEXT_PREFIX}EntrancePass:${pass.id}`;
    addNode(id, pass.name);
    addEdge(id, 'HOLDS');
  }
  for (const s of memory.stamps) {
    const id = `${CONTEXT_PREFIX}PassportStamp:${s.id}`;
    addNode(id, s.label);
    addEdge(id, 'COLLECTED');
  }
  if (memory.availability.start || memory.availability.end) {
    const id = `${CONTEXT_PREFIX}Season:window`;
    addNode(id, `${memory.availability.start ?? '…'} – ${memory.availability.end ?? '…'}`);
    addEdge(id, 'AVAILABLE');
  }
  return { nodes, rels };
}

/** True when an NVL node id is a domain park code (bare) rather than a prefixed context node. */
export function isContextParkId(id: string): boolean {
  return !id.startsWith(CONTEXT_PREFIX);
}

/** Color for a domain node label in the per-park graph. Pure. */
const LABEL_COLOR: Record<string, string> = {
  Park: pine[600],
  Activity: pine[500],
  Topic: trail[500],
  State: sand[600],
  Campground: pine[400],
  VisitorCenter: trail[600],
  ThingToDo: trail[400],
  Alert: '#E03131',
};
export function labelColor(label: string): string {
  return LABEL_COLOR[label] ?? sand[500];
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

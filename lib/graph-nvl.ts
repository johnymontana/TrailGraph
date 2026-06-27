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
export const HUB_DEGREE = 6;
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
  /** Per-lens edge caption (#4), e.g. "142 mi" / "via John Muir" — used when there are no topic names. */
  caption?: string;
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
    // Keep the `.length` guard: non-topic lenses pass `topics: []` (not undefined), and `[].join('')` would
    // wrongly win a `??`. Topic names → join; else a per-lens caption; else the legacy "N shared".
    caption: l.topics?.length ? l.topics.join(', ') : (l.caption ?? `${l.value} shared`),
  }));
  return { nodes, rels };
}

// ── Multi-entity seed + expand-on-click (#2) ────────────────────────────────────────────────────────
// Shared shape for the explorer dataset: the park-topic backbone (label 'Park') plus on-demand entity
// neighbours (Activity/Topic/Person/Place/Tour/Campground/VisitorCenter/ThingToDo/State/Region/Alert).

export interface SeedNode {
  /** NVL id — BARE parkCode for parks (so a CONSIDERED park merges with the overlay), else `${label}:${key}`. */
  id: string;
  label: string;
  name: string;
  /** The indexed natural key used to expand this node (GRAPH_NODE_KEYS[label]). */
  key: string;
  /** Park-backbone degree (drives hub sizing/colour); absent for entity nodes. */
  degree?: number;
  parkCode?: string;
  lat?: number | null;
  lng?: number | null;
}
export interface SeedLink {
  source: string;
  target: string;
  /** Shared-topic count for park-park backbone edges. */
  value?: number;
  /** Shared topic names (park-park backbone) — drives the topic filter. */
  topics?: string[];
  /** Relationship caption for entity edges (e.g. 'HAS_TOPIC'). */
  caption?: string;
}
export interface SeedGraph {
  nodes: SeedNode[];
  links: SeedLink[];
}

/** NVL node id for a domain node. Parks stay BARE (so a CONSIDERED park merges with the overlay). */
export function nodeIdFor(label: string, key: string): string {
  return label === 'Park' ? key : `${label}:${key}`;
}

/** Map the multi-entity explorer dataset to NVL. Parks colour by highlight/hub/degree; entities by label. */
export function seedToNvl(
  seed: { nodes: SeedNode[]; links: SeedLink[] },
  highlight: Iterable<string> = [],
): { nodes: NvlNode[]; rels: NvlRel[] } {
  const hi = new Set(highlight);
  const nodes: NvlNode[] = seed.nodes.map((n) =>
    n.label === 'Park'
      ? {
          id: n.id,
          caption: n.name,
          size: 6 + Math.min(8, n.degree ?? 0) * 2,
          color: hi.has(n.id) ? COLOR_HIGHLIGHT : (n.degree ?? 0) >= HUB_DEGREE ? COLOR_HUB : COLOR_PARK,
        }
      : { id: n.id, caption: n.name, size: 12, color: labelColor(n.label) },
  );
  const rels: NvlRel[] = seed.links.map((l) => ({
    id: `${l.source}--${l.target}`,
    from: l.source,
    to: l.target,
    caption: l.topics?.length ? l.topics.join(', ') : (l.caption ?? (l.value != null ? `${l.value} shared` : '')),
  }));
  return { nodes, rels };
}

/** Legend entries (label + colour) for the node types currently present, sorted for a stable display. */
export function nodeTypeLegend(labels: Iterable<string>): { label: string; color: string }[] {
  const seen = new Set<string>();
  const out: { label: string; color: string }[] = [];
  for (const l of labels) {
    if (seen.has(l)) continue;
    seen.add(l);
    out.push({ label: l, color: labelColor(l) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
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
  const tp = memory.trailPreferences;
  if (tp.difficulty || tp.maxMiles != null || tp.maxGainFt != null || tp.avoidExposure || tp.dogsRequired) {
    const parts = [
      tp.difficulty,
      tp.maxMiles != null ? `≤ ${tp.maxMiles}mi` : null,
      tp.maxGainFt != null ? `≤ ${tp.maxGainFt}ft` : null,
      tp.avoidExposure ? 'no exposure' : null,
      tp.dogsRequired ? 'dog-friendly' : null,
    ].filter(Boolean);
    const id = `${CONTEXT_PREFIX}TrailPrefs:trail`;
    addNode(id, parts.join(' · ') || 'trail prefs');
    addEdge(id, 'PREFERS_TRAIL');
  }
  for (const [list, rel] of [
    [memory.trailHistory.saved, 'SAVED'],
    [memory.trailHistory.wishlisted, 'WISHLISTED'],
    [memory.trailHistory.done, 'DID'],
  ] as const) {
    for (const t of list) {
      const id = `${CONTEXT_PREFIX}Trail:${t.id}`;
      addNode(id, t.name, 11);
      addEdge(id, rel);
    }
  }
  return { nodes, rels };
}

/** True when an NVL node id is a domain park code (bare) rather than a prefixed context node. */
export function isContextParkId(id: string): boolean {
  return !id.startsWith(CONTEXT_PREFIX);
}

// ── "You in the graph" bridges (#8) ─────────────────────────────────────────────────────────────────
// A bridge connects a user's context node (a preference/trip/stamp) to the DOMAIN park it touches, so the
// overlay shows *why* your tastes reach into the constellation. The `from` id MUST byte-match the context
// node id minted by `contextToNvl`, and `to` is the BARE parkCode (which also merges with the domain node).
export interface ContextBridge {
  fromKind: 'activity' | 'topic' | 'trip' | 'stamp';
  fromKey: string;
  via: string;
  parkCode: string;
}
const BRIDGE_PREFIX: Record<ContextBridge['fromKind'], string> = {
  activity: `${CONTEXT_PREFIX}Activity:`,
  topic: `${CONTEXT_PREFIX}Topic:`,
  trip: `${CONTEXT_PREFIX}Trip:`,
  stamp: `${CONTEXT_PREFIX}PassportStamp:`,
};

/** Map context bridges to NVL rels (deduped). Ids align with `contextToNvl` node ids + the You--PREFERS-- edge convention. */
export function bridgesToRels(bridges: ContextBridge[]): NvlRel[] {
  const seen = new Set<string>();
  const out: NvlRel[] = [];
  for (const b of bridges) {
    const fromId = `${BRIDGE_PREFIX[b.fromKind]}${b.fromKey}`;
    const id = `${fromId}--${b.via}--${b.parkCode}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, from: fromId, to: b.parkCode, caption: b.via });
  }
  return out;
}

// ── Recommendations & provenance on the graph (#9) ──────────────────────────────────────────────────

/**
 * "Recommend from here" (#9) result subgraph: the seed park at the centre, a spoke to each 2-hop
 * recommendation captioned by WHY (the shared dimensions). Shaped as a SeedGraph so it renders through the
 * same result-subgraph override as ask-the-graph / paths / ego. Pure + unit-tested.
 */
export interface RecLike {
  parkCode: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  matched: string[];
}
export function recsToGraph(
  seed: { parkCode: string; name: string | null },
  recs: RecLike[],
): { narration: string; nodes: SeedNode[]; links: SeedLink[] } {
  const seedName = seed.name ?? seed.parkCode;
  const nodes: SeedNode[] = [
    { id: seed.parkCode, label: 'Park', name: seedName, key: seed.parkCode, parkCode: seed.parkCode, degree: recs.length },
    ...recs.map(
      (r): SeedNode => ({ id: r.parkCode, label: 'Park', name: r.name, key: r.parkCode, parkCode: r.parkCode, lat: r.lat ?? null, lng: r.lng ?? null }),
    ),
  ];
  const links: SeedLink[] = recs.map((r) => ({
    source: seed.parkCode,
    target: r.parkCode,
    caption: r.matched.slice(0, 3).join(', ') || 'shares your interests',
  }));
  const narration = recs.length
    ? `Because ${seedName} shares your interests, you might like ${recs.length} more park${recs.length === 1 ? '' : 's'}: ${recs.map((r) => r.name).join(', ')}.`
    : `No fresh recommendations from ${seedName} right now — you may have considered or planned its closest matches already.`;
  return { narration, nodes, links };
}

/**
 * The id set for the "why is this park in my world?" provenance highlight (#9): the You anchor, the clicked
 * park, and every preference that bridges them. Rel ids BYTE-MATCH `contextToNvl` (You-[:PREFERS]->pref,
 * You-[:CONSIDERED]->park) and `bridgesToRels` (pref-[:OFFERS|HAS_TOPIC]->park), so the constellation can dim
 * everything outside this subgraph. Pure + unit-tested against those id conventions.
 */
export function provenanceSubgraphIds(
  parkCode: string,
  prefPaths: { name: string; kind: 'activity' | 'topic'; via: 'OFFERS' | 'HAS_TOPIC' }[],
): { nodeIds: Set<string>; relIds: Set<string> } {
  const nodeIds = new Set<string>([CONTEXT_YOU_ID, parkCode]);
  const relIds = new Set<string>([`${CONTEXT_YOU_ID}--CONSIDERED--${parkCode}`]);
  for (const p of prefPaths) {
    const prefId = `${CONTEXT_PREFIX}${p.kind === 'activity' ? 'Activity' : 'Topic'}:${p.name}`;
    nodeIds.add(prefId);
    relIds.add(`${CONTEXT_YOU_ID}--PREFERS--${prefId}`);
    relIds.add(`${prefId}--${p.via}--${parkCode}`);
  }
  return { nodeIds, relIds };
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
  // Multi-entity explorer (#2) + analytics (#7) node types — distinct hues from the pine/trail/sand scales.
  Person: trail[700],
  Place: pine[300],
  Tour: trail[300],
  Region: sand[500],
  Community: pine[700],
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

'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, Text, HStack, Stack } from '@chakra-ui/react';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';
import { NvlGraph } from './NvlGraph';
import { useGraphExplorer } from './useGraphExplorer';
import { GraphQueryBar, type GraphQueryAnswer } from './GraphQueryBar';
import { GraphSearchBox, type NodeHit } from './GraphSearchBox';
import { InsightsPanel } from './InsightsPanel';
import { ProvenanceEdges } from '../parks/ProvenanceEdges';
import {
  seedToNvl,
  neighborhoodToNvl,
  nodeTypeLegend,
  isContextParkId,
  provenanceSubgraphIds,
  HUB_DEGREE,
  type SeedGraph,
} from '../../lib/graph-nvl';
import type { ExplanationGraph } from '../../lib/explain';
import { computeCaptions, zoomBandFor } from '../../lib/graph-explorer';
import { radialPositions, geographicPositions } from '../../lib/graph-layout';
import { encodeSeed } from '../../lib/graph-handoff';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';

interface ContextGraphData { nodes: NvlNode[]; rels: NvlRel[] }

// Visible layout choices. 'radial'/'geographic' map to NVL's `'free'` layout + computed positions
// (NVL has no native radial/geographic).
type LayoutChoice = 'forceDirected' | 'hierarchical' | 'radial' | 'geographic';
const FADED_EDGE = 'rgba(171,155,119,0.18)';

// Relationship lenses (#4). 'shares_topic' is the default explorer view (graphSeed backbone); the others
// fetch /api/graph/lens and re-draw the same parks around a different meaning. `param`/min/max/def drive
// the threshold slider; `near` uses ≤ miles (FLOAT), the rest use ≥ a count.
interface LensGraphData {
  nodes: { id: string; name: string; degree: number }[];
  links: { source: string; target: string; value: number; caption: string }[];
}
const LENS_CONFIG: Record<string, { label: string; param: string; min: number; max: number; def: number; step: number; unit: string }> = {
  shares_topic: { label: 'Shared topic', param: 'minWeight', min: 1, max: 10, def: 3, step: 1, unit: 'topics' },
  shares_activity: { label: 'Shared activity', param: 'minWeight', min: 1, max: 10, def: 3, step: 1, unit: 'activities' },
  near: { label: 'Nearby', param: 'maxMiles', min: 50, max: 500, def: 200, step: 50, unit: 'mi' },
  person_connected: { label: 'Same person', param: 'minWeight', min: 1, max: 5, def: 1, step: 1, unit: 'people' },
  shared_tour: { label: 'Shared tour', param: 'minWeight', min: 1, max: 5, def: 1, step: 1, unit: 'tours' },
  co_considered: { label: 'Co-considered', param: 'minUsers', min: 5, max: 25, def: 5, step: 1, unit: 'people' },
};

/**
 * The /graph constellation, rendered with Neo4j NVL. The seed is the National-Park topic backbone;
 * clicking a node expands its one-hop neighbours (people/places/activities/topics/tours/…) — Bloom-style
 * multi-entity exploration (#2) — and double-click collapses. Keeps the topic filter, "your parks"
 * highlight, the two-graph overlay (ADR-047), and the feature-#1 legibility controls (auto-fit, Fit
 * button, layout switcher incl. geographic, zoom-aware labels, edge-focus).
 */
type OverlayView = 'world' | 'both' | 'me';

export function GraphConstellation({
  data,
  highlight = [],
  context,
  bridges = [],
  authed = false,
}: {
  data: SeedGraph;
  highlight?: string[];
  context?: ContextGraphData;
  bridges?: NvlRel[];
  /** Signed-in: enables the per-park "Why this?" provenance + "Recommend from here" actions (#9). */
  authed?: boolean;
}) {
  const router = useRouter();
  const { colorMode } = useColorMode();
  const explorer = useGraphExplorer(data);
  const [topic, setTopic] = useState('');
  const [view, setView] = useState<OverlayView>('world');
  const [revealCount, setRevealCount] = useState(0);
  const [layout, setLayout] = useState<LayoutChoice>('forceDirected');
  const [edgeMode, setEdgeMode] = useState<'all' | 'focus'>('all');
  const [fitNonce, setFitNonce] = useState(0);
  const [scale, setScale] = useState(0.7);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<GraphQueryAnswer | null>(null);
  const [communityFilter, setCommunityFilter] = useState<{ id: number; codes: Set<string> } | null>(null);
  const [pathMode, setPathMode] = useState(false);
  const [pathFrom, setPathFrom] = useState<{ id: string; name: string } | null>(null);
  const [pathWeighting, setPathWeighting] = useState<'topical' | 'driving'>('topical');
  // Trip mode (#10): multi-select parks → plan a trip or draw the route between them.
  const [tripMode, setTripMode] = useState(false);
  const [tripSel, setTripSel] = useState<{ id: string; name: string }[]>([]);
  const [lens, setLens] = useState('shares_topic');
  const [lensWeight, setLensWeight] = useState(LENS_CONFIG.shares_topic.def);
  const [lensData, setLensData] = useState<LensGraphData | null>(null);
  // Provenance highlight (#9): the You→pref→park subgraph for a clicked considered park.
  const [provenance, setProvenance] = useState<ExplanationGraph | null>(null);
  const [recommendingId, setRecommendingId] = useState<string | null>(null);
  const fadeColor = brandColors(colorMode).faded;
  const accentColor = brandColors(colorMode).trail;
  // An "ask the graph" result subgraph overrides the constellation until dismissed.
  const queryActive = (queryResult?.nodes.length ?? 0) > 0;
  const hasContext = (context?.nodes.length ?? 0) > 1; // more than just the "You" node

  // The user's considered parks (bare park ids in the context graph) — only these get a "Why this?" action.
  const consideredCodes = useMemo(
    () => new Set((context?.nodes ?? []).filter((n) => isContextParkId(n.id)).map((n) => n.id)),
    [context],
  );

  // Swap the whole graph for a result subgraph (recommend / ask / path / ego) — clears any provenance dim.
  const showResult = (a: GraphQueryAnswer) => {
    setProvenance(null);
    setQueryResult(a);
    setSelectedId(null);
    if (a.nodes.length) setFitNonce((n) => n + 1);
  };

  // Animated bridge reveal (#8): when entering "me + the world", the bridges draw in from You outward over
  // ~1s; honour prefers-reduced-motion (all at once). Reset whenever we leave the overlay.
  useEffect(() => {
    if (view !== 'both' || bridges.length === 0) {
      setRevealCount(0);
      return;
    }
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setRevealCount(bridges.length);
      return;
    }
    setRevealCount(0);
    const batch = Math.max(1, Math.ceil(bridges.length / 8));
    const iv = setInterval(() => {
      setRevealCount((c) => {
        const n = c + batch;
        if (n >= bridges.length) {
          clearInterval(iv);
          return bridges.length;
        }
        return n;
      });
    }, 120);
    return () => clearInterval(iv);
  }, [view, bridges]);

  // Relationship lens (#4): the default 'shares_topic' lens IS the explorer view; any other lens fetches
  // its edge set (debounced on the threshold slider) and re-draws the same parks via neighborhoodToNvl.
  useEffect(() => {
    if (lens === 'shares_topic') {
      setLensData(null);
      setFitNonce((n) => n + 1);
      return;
    }
    const cfg = LENS_CONFIG[lens];
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/graph/lens?lens=${encodeURIComponent(lens)}&${cfg.param}=${lensWeight}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) {
            setLensData(d as LensGraphData);
            setFitNonce((n) => n + 1);
          }
        })
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [lens, lensWeight]);

  const allTopics = useMemo(() => {
    const s = new Set<string>();
    for (const l of data.links) for (const t of l.topics ?? []) s.add(t);
    return [...s].sort();
  }, [data]);

  const selectedNode = useMemo(
    () => (selectedId ? explorer.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, explorer.nodes],
  );

  // Base NVL graph from the live explorer dataset (seed + expansions). Topic filter (R4 §2.8): keep the
  // whole graph and DIM nodes that don't share the selected topic, plus report a match count.
  const { nodes, rels, matchCount } = useMemo(() => {
    // Non-default lens: re-draw the same parks from the fetched lens edges. Default: the explorer dataset.
    const base = lensData
      ? neighborhoodToNvl(lensData, highlight)
      : seedToNvl({ nodes: explorer.nodes, links: explorer.links }, highlight);
    if (!topic || lensData) return { ...base, matchCount: 0 }; // topic filter is shares_topic-only
    const matchIds = new Set<string>();
    for (const l of data.links) {
      if (l.topics?.includes(topic)) {
        matchIds.add(l.source);
        matchIds.add(l.target);
      }
    }
    const dimNodes = base.nodes.map((n) =>
      matchIds.has(n.id) ? n : { ...n, color: fadeColor, size: Math.max(4, (n.size ?? 8) * 0.55) },
    );
    const dimRels = base.rels.map((r) => {
      const carries = data.links.find((l) => `${l.source}--${l.target}` === r.id)?.topics?.includes(topic);
      return carries ? r : { ...r, color: FADED_EDGE };
    });
    return { nodes: dimNodes, rels: dimRels, matchCount: matchIds.size };
  }, [explorer.nodes, explorer.links, lensData, data.links, highlight, topic, fadeColor]);

  // Zoom-aware labels (#1): blank captions of nodes that shouldn't be labelled at the current zoom.
  const labeled = useMemo(
    () =>
      computeCaptions(lensData ? lensData.nodes : explorer.nodes, {
        band: zoomBandFor(scale),
        hoveredId,
        selectedIds: selectedId ? [selectedId] : [],
        hubDegree: HUB_DEGREE,
      }),
    [lensData, explorer.nodes, scale, hoveredId, selectedId],
  );

  // Tri-state overlay (#8) + label gating + edge-focus styling.
  //  · world: domain only · both: domain + your memory + animated bridges · me: your memory only.
  const { nodes: viewNodes, rels: viewRels } = useMemo(() => {
    // An ask-the-graph result (#5a) replaces the whole graph until "← Back".
    if (queryActive && queryResult) {
      return seedToNvl({ nodes: queryResult.nodes, links: queryResult.links });
    }
    if (view === 'me' && context) {
      return { nodes: context.nodes, rels: context.rels };
    }
    const gated = nodes.map((n) => (labeled.has(n.id) ? n : { ...n, caption: '' }));
    let mergedNodes = gated;
    let mergedRels = rels;
    if (view === 'both' && context) {
      const byId = new Map(mergedNodes.map((n) => [n.id, n]));
      for (const cn of context.nodes) if (!byId.has(cn.id)) byId.set(cn.id, cn);
      mergedNodes = [...byId.values()];
      // Provenance (#9) needs the specific bridge edges present immediately, not the staggered reveal.
      mergedRels = [...mergedRels, ...context.rels, ...(provenance ? bridges : bridges.slice(0, revealCount))];
    }
    // Provenance highlight (#9): dim everything outside the You→pref→park subgraph for the clicked park.
    if (provenance && view === 'both') {
      const { nodeIds, relIds } = provenanceSubgraphIds(provenance.parkCode, provenance.prefPaths);
      mergedNodes = mergedNodes.map((n) =>
        nodeIds.has(n.id) ? n : { ...n, color: fadeColor, size: Math.max(4, (n.size ?? 8) * 0.55) },
      );
      mergedRels = mergedRels.map((r) => (relIds.has(r.id) ? r : { ...r, color: FADED_EDGE }));
      return { nodes: mergedNodes, rels: mergedRels };
    }
    // "Show this cluster" (#7): dim everything outside the selected community.
    if (communityFilter) {
      mergedNodes = mergedNodes.map((n) =>
        communityFilter.codes.has(n.id) ? n : { ...n, color: fadeColor, size: Math.max(4, (n.size ?? 8) * 0.55) },
      );
    }
    // Trip mode (#10): ring the selected parks so the route the user is building is visible on the canvas.
    if (tripMode && tripSel.length) {
      const sel = new Set(tripSel.map((s) => s.id));
      mergedNodes = mergedNodes.map((n) => (sel.has(n.id) ? { ...n, color: accentColor, size: Math.max(10, (n.size ?? 8) * 1.4) } : n));
    }
    if (edgeMode === 'focus') {
      mergedRels = mergedRels.map((r) =>
        hoveredId && (r.from === hoveredId || r.to === hoveredId) ? r : { ...r, color: FADED_EDGE },
      );
    }
    return { nodes: mergedNodes, rels: mergedRels };
  }, [nodes, rels, labeled, view, context, bridges, revealCount, edgeMode, hoveredId, queryActive, queryResult, communityFilter, provenance, tripMode, tripSel, fadeColor, accentColor]);

  // Radial / geographic layouts push fixed positions under NVL's `'free'` layout.
  const nodeIdsKey = useMemo(() => viewNodes.map((n) => n.id).join(','), [viewNodes]);
  const positions = useMemo(() => {
    if (layout === 'radial') return radialPositions(nodeIdsKey ? nodeIdsKey.split(',') : []);
    if (layout === 'geographic')
      return geographicPositions(explorer.nodes.map((n) => ({ id: n.id, lat: n.lat, lng: n.lng })));
    return undefined;
  }, [layout, nodeIdsKey, explorer.nodes]);
  const nvlLayout = layout === 'radial' || layout === 'geographic' ? 'free' : layout;

  const typeLegend = useMemo(
    () => nodeTypeLegend(explorer.nodes.map((n) => n.label)),
    [explorer.nodes],
  );

  const controlSelectStyle = {
    fontSize: '14px',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--chakra-colors-fg)',
  } as const;

  const legend = (
    <>
      <GraphQueryBar
        active={queryActive}
        answer={queryResult}
        onResult={showResult}
        onClear={() => {
          setQueryResult(null);
          setFitNonce((n) => n + 1);
        }}
      />
      {/* Hide the cluster-insights panel while a provenance highlight is open — both live on the left edge,
          and "why is THIS park in my world" is a focused view that doesn't need the cluster controls (#9). */}
      {!provenance ? (
        <InsightsPanel
          activeClusterId={communityFilter?.id ?? null}
          onShowCluster={(id, codes) => setCommunityFilter({ id, codes: new Set(codes) })}
          onClearCluster={() => setCommunityFilter(null)}
          onSelectPark={(code) => router.push(`/parks/${code}`)}
        />
      ) : null}
      {hasContext ? (
        <Box position="absolute" bottom={3} left={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md">
          <HStack gap={1} role="group" aria-label="You in the graph">
            {(
              [
                ['world', 'Just the world'],
                ['both', 'Me + the world'],
                ['me', 'Just me'],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                size="xs"
                variant={view === v ? 'solid' : 'outline'}
                colorPalette="trail"
                onClick={() => {
                  setView(v);
                  setProvenance(null);
                  setFitNonce((n) => n + 1);
                }}
                aria-pressed={view === v}
              >
                {label}
              </Button>
            ))}
          </HStack>
        </Box>
      ) : null}
      <Stack position="absolute" top={3} right={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={2} align="stretch" minW="60">
        <GraphSearchBox
          onSelect={(hit: NodeHit) => {
            fetch(`/api/graph/ego?key=${encodeURIComponent(hit.key)}&label=${encodeURIComponent(hit.label)}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((ego) => {
                if (ego && ego.nodes?.length) showResult(ego);
              })
              .catch(() => {});
          }}
        />
        <HStack gap={2}>
          <Button size="xs" variant="outline" onClick={() => setFitNonce((n) => n + 1)} aria-label="Fit the graph to view">
            Fit
          </Button>
          <select
            value={layout}
            onChange={(e) => {
              setLayout(e.target.value as LayoutChoice);
              setFitNonce((n) => n + 1);
            }}
            aria-label="Graph layout"
            style={controlSelectStyle}
          >
            <option value="forceDirected">Force</option>
            <option value="hierarchical">Tree</option>
            <option value="radial">Radial</option>
            <option value="geographic">Map</option>
          </select>
          <Button
            size="xs"
            variant={edgeMode === 'focus' ? 'solid' : 'outline'}
            colorPalette="pine"
            onClick={() => setEdgeMode((m) => (m === 'all' ? 'focus' : 'all'))}
            aria-label="Toggle edge focus"
          >
            Edges: {edgeMode}
          </Button>
          <Button
            size="xs"
            variant={pathMode ? 'solid' : 'outline'}
            colorPalette="trail"
            onClick={() => {
              setPathMode((v) => !v);
              setPathFrom(null);
              setTripMode(false);
            }}
            aria-pressed={pathMode}
            aria-label="Toggle path mode"
          >
            Path
          </Button>
          <Button
            size="xs"
            variant={tripMode ? 'solid' : 'outline'}
            colorPalette="pine"
            onClick={() => {
              setTripMode((v) => {
                if (v) setTripSel([]);
                return !v;
              });
              setPathMode(false);
              setPathFrom(null);
              setSelectedId(null);
            }}
            aria-pressed={tripMode}
            aria-label="Toggle trip-select mode"
          >
            Trip
          </Button>
        </HStack>
        {pathMode ? (
          <HStack gap={2}>
            <select value={pathWeighting} onChange={(e) => setPathWeighting(e.target.value as 'topical' | 'driving')} aria-label="Path weighting" style={controlSelectStyle}>
              <option value="topical">By topic</option>
              <option value="driving">By distance</option>
            </select>
            <Text fontSize="xs" color="fg.muted">
              {pathFrom ? `From ${pathFrom.name} — pick a destination` : 'Click two parks'}
            </Text>
          </HStack>
        ) : null}
        <HStack gap={2}>
          <Text fontSize="2xs" color="fg.muted">Lens</Text>
          <select
            value={lens}
            onChange={(e) => {
              const l = e.target.value;
              setLens(l);
              setLensWeight(LENS_CONFIG[l]?.def ?? 3);
            }}
            aria-label="Relationship lens"
            style={controlSelectStyle}
          >
            {Object.entries(LENS_CONFIG).map(([k, c]) => (
              <option key={k} value={k}>{c.label}</option>
            ))}
          </select>
        </HStack>
        {lens !== 'shares_topic' ? (
          <HStack gap={2}>
            <input
              type="range"
              min={LENS_CONFIG[lens].min}
              max={LENS_CONFIG[lens].max}
              step={LENS_CONFIG[lens].step}
              value={lensWeight}
              onChange={(e) => setLensWeight(Number(e.target.value))}
              aria-label="Lens threshold"
              style={{ width: '96px' }}
            />
            <Text fontSize="xs" color="fg.muted">
              {lens === 'near' ? '≤' : '≥'} {lensWeight} {LENS_CONFIG[lens].unit}
            </Text>
          </HStack>
        ) : null}
        {lens === 'shares_topic' && allTopics.length > 0 ? (
          <Box>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Filter the graph by topic" style={controlSelectStyle}>
              <option value="">All topics</option>
              {allTopics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {topic ? (
              <Text fontSize="xs" color="fg.muted" mt={1}>
                {matchCount} park{matchCount === 1 ? '' : 's'} share {topic}
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Stack>

      {selectedNode ? (
        <Stack position="absolute" bottom={3} left="50%" transform="translateX(-50%)" bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={1} data-testid="graph-selection" maxW="xs">
          <HStack gap={2} justify="space-between">
            <Text fontSize="sm" fontWeight="medium" lineClamp={1}>{selectedNode.name}</Text>
            <Text fontSize="2xs" color="fg.muted" textTransform="uppercase" letterSpacing="wide">{selectedNode.label}</Text>
          </HStack>
          <HStack gap={2}>
            {explorer.expanded.has(selectedNode.id) ? (
              <Button size="xs" variant="outline" onClick={() => explorer.collapse(selectedNode.id)}>Collapse</Button>
            ) : (
              <Button size="xs" variant="outline" loading={explorer.loadingId === selectedNode.id} onClick={() => explorer.expand(selectedNode)}>Expand</Button>
            )}
            {selectedNode.label === 'Park' ? (
              <Button size="xs" colorPalette="pine" onClick={() => router.push(`/parks/${selectedNode.parkCode ?? selectedNode.id}`)}>
                Open ↗
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)} aria-label="Dismiss selection">✕</Button>
          </HStack>
          {authed && selectedNode.label === 'Park' ? (
            <HStack gap={2}>
              {consideredCodes.has(selectedNode.id) ? (
                <Button
                  size="xs"
                  variant="outline"
                  colorPalette="trail"
                  onClick={() => {
                    const code = selectedNode.parkCode ?? selectedNode.id;
                    fetch(`/api/explain?parkCode=${encodeURIComponent(code)}`)
                      .then((r) => (r.ok ? r.json() : null))
                      .then((d: ExplanationGraph | null) => {
                        if (d) {
                          setQueryResult(null);
                          setProvenance(d);
                          setView('both');
                          setFitNonce((n) => n + 1);
                        }
                      })
                      .catch(() => {});
                  }}
                >
                  Why this?
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                colorPalette="pine"
                loading={recommendingId === selectedNode.id}
                onClick={() => {
                  const code = selectedNode.parkCode ?? selectedNode.id;
                  setRecommendingId(selectedNode.id);
                  fetch(`/api/graph/recommend?from=${encodeURIComponent(code)}`)
                    .then((r) => (r.ok ? r.json() : null))
                    .then((res: GraphQueryAnswer | null) => {
                      if (res) showResult(res);
                    })
                    .catch(() => {})
                    .finally(() => setRecommendingId(null));
                }}
              >
                More like this
              </Button>
            </HStack>
          ) : null}
        </Stack>
      ) : null}

      {tripMode ? (
        <Stack position="absolute" bottom={3} left="50%" transform="translateX(-50%)" bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={2} data-testid="graph-trip" maxW="md">
          <Text fontSize="xs" color="fg.muted">
            {tripSel.length === 0
              ? 'Trip mode: click parks to add them to a trip.'
              : `${tripSel.length} park${tripSel.length === 1 ? '' : 's'} selected — click to add/remove.`}
          </Text>
          {tripSel.length > 0 ? (
            <HStack gap={1} wrap="wrap">
              {tripSel.map((s) => (
                <Button key={s.id} size="2xs" variant="subtle" colorPalette="pine" onClick={() => setTripSel((sel) => sel.filter((x) => x.id !== s.id))} title="Remove from trip">
                  {s.name} ✕
                </Button>
              ))}
            </HStack>
          ) : null}
          <HStack gap={2}>
            <Button
              size="xs"
              colorPalette="pine"
              disabled={tripSel.length === 0}
              onClick={() => router.push(`/plan?seed=${encodeURIComponent(encodeSeed(tripSel.map((s) => s.id)))}&from=graph`)}
            >
              Plan trip ↗
            </Button>
            <Button
              size="xs"
              variant="outline"
              colorPalette="trail"
              disabled={tripSel.length < 2}
              onClick={() => {
                fetch(`/api/graph/trip-path?codes=${encodeURIComponent(encodeSeed(tripSel.map((s) => s.id)))}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((res: GraphQueryAnswer | null) => {
                    if (res) showResult(res);
                  })
                  .catch(() => {});
              }}
            >
              Show route
            </Button>
            <Button size="xs" variant="ghost" disabled={tripSel.length === 0} onClick={() => setTripSel([])}>
              Clear
            </Button>
          </HStack>
        </Stack>
      ) : null}

      {provenance ? (
        <Stack
          position="absolute"
          top="124px"
          left={3}
          bottom="72px"
          bg="bg.panel/95"
          backdropFilter="blur(8px)"
          borderWidth="1px"
          borderColor="border"
          borderRadius="l2"
          px={4}
          py={3}
          shadow="lg"
          gap={2}
          maxW="xs"
          overflowY="auto"
          data-testid="graph-provenance"
        >
          <HStack justify="space-between" gap={2}>
            <Text fontSize="sm" fontWeight="semibold" lineClamp={2}>
              Why {provenance.park ?? 'this park'} is in your world
            </Text>
            <Button size="xs" variant="ghost" onClick={() => setProvenance(null)} aria-label="Clear provenance">
              ✕
            </Button>
          </HStack>
          <ProvenanceEdges data={provenance} />
        </Stack>
      ) : null}

      <Stack position="absolute" bottom={3} right={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={1}>
        {typeLegend.length > 1 ? (
          typeLegend.map((t) => (
            <HStack key={t.label} gap={2}>
              <Box w="10px" h="10px" borderRadius="full" style={{ background: t.color }} />
              <Text fontSize="xs">{t.label}</Text>
            </HStack>
          ))
        ) : (
          <HStack gap={2}>
            <Box w="10px" h="10px" borderRadius="full" bg="pine.solid" />
            <Text fontSize="xs">Hub park (shares many topics)</Text>
          </HStack>
        )}
        {highlight.length > 0 || (view !== 'world' && hasContext) ? (
          <HStack gap={2}>
            <Box w="10px" h="10px" borderRadius="full" bg="accent.solid" />
            <Text fontSize="xs">{view !== 'world' && hasContext ? 'You + your memory' : 'Your saved / considered parks'}</Text>
          </HStack>
        ) : null}
        {view === 'both' && hasContext ? (
          <Text fontSize="xs" color="fg.muted">Bridges = why your tastes touch these parks</Text>
        ) : null}
        <Text fontSize="xs" color="fg.muted">Click to expand · double-click to collapse · open from the selection</Text>
      </Stack>
    </>
  );

  return (
    <Box position="absolute" inset={0}>
      <NvlGraph
        nodes={viewNodes}
        rels={viewRels}
        height="100%"
        layout={queryActive ? 'forceDirected' : nvlLayout}
        layoutOptions={!queryActive && layout === 'hierarchical' ? { direction: 'down' } : undefined}
        positions={queryActive ? undefined : positions}
        fitNonce={fitNonce}
        onScaleChange={setScale}
        onNodeHover={setHoveredId}
        onNodeClick={(id) => {
          if (queryActive) {
            const n = queryResult?.nodes.find((x) => x.id === id);
            if (n?.label === 'Park') router.push(`/parks/${n.parkCode ?? n.id}`);
            return;
          }
          if (pathMode) {
            // Path mode (#6): pick two parks → fetch + render the shortest path as a result subgraph.
            const park = explorer.nodes.find((n) => n.id === id);
            if (!park || park.label !== 'Park') return;
            if (!pathFrom) {
              setPathFrom({ id, name: park.name });
              return;
            }
            if (pathFrom.id === id) {
              setPathFrom(null);
              return;
            }
            const from = pathFrom.id;
            fetch(`/api/graph/path?a=${encodeURIComponent(from)}&b=${encodeURIComponent(id)}&mode=${pathWeighting}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((p) => {
                if (p) showResult({ narration: p.narration, nodes: p.nodes, links: p.links });
              })
              .catch(() => {})
              .finally(() => setPathFrom(null));
            return;
          }
          if (tripMode) {
            // Trip mode (#10): toggle a park in/out of the selection (parks only — never ctx/entity nodes).
            const park = explorer.nodes.find((n) => n.id === id);
            if (!park || park.label !== 'Park') return;
            setTripSel((sel) => (sel.some((s) => s.id === id) ? sel.filter((s) => s.id !== id) : [...sel, { id, name: park.name }]));
            return;
          }
          if (lensData) {
            // Lens view nodes aren't explorer entries — clicking a park just opens it.
            if (isContextParkId(id)) router.push(`/parks/${id}`);
            return;
          }
          setProvenance(null);
          const node = explorer.nodes.find((n) => n.id === id);
          if (node) {
            setSelectedId(id);
            explorer.expand(node);
          } else if (isContextParkId(id)) {
            // A context-only park node not in the explorer dataset — open it directly.
            router.push(`/parks/${id}`);
          }
        }}
        onNodeDoubleClick={(id) => {
          if (!queryActive) explorer.collapse(id);
        }}
        legend={legend}
      />
    </Box>
  );
}

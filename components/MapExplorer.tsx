'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Feature, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Stack, Checkbox, Text, Spinner, HStack, NativeSelect, Field, Input, Button } from '@chakra-ui/react';
import {
  basemapStyle,
  US_CENTER,
  US_BOUNDS,
  registerMapProtocols,
  attachBasemapFallback,
  type Basemap,
} from '../lib/mapStyle';
import {
  designationKey,
  designationIcon,
  designationMatchStops,
  designationDefaultColor,
  designationLegend,
  poiColor,
  poiIcon,
  poiLabel,
  POI_ORDER,
  type PoiKey,
} from '../lib/mapLegend';
import { markerImageId, attachMarkerImages, MARKER_SVGS } from '../lib/mapMarkers';
import { MAP_LENSES, lensColorExpr, lensLegend, type LensKey } from '../lib/mapLenses';
import { conditionMatchStops, conditionDefaultColor, conditionLegend } from '../lib/conditions-map';
import { BasemapSwitcher } from './map/BasemapSwitcher';
import { useColorMode } from './ui/color-mode';
import { brandColors, type BrandColors } from '../lib/brandColors';
import { pine } from '../theme/colors';
import type { ParkPoint } from '../lib/queries';
import { encodeMapView, type MapView } from '../lib/map-deeplink';
import { toast } from '../lib/toast';

/**
 * Global park map (B1-B2) + layer toggles (B3): campgrounds, visitor centers, things-to-do, and
 * active-alert parks. Parks load ONCE (op=parks-all, cached) and cluster client-side; POI layers stay
 * lazy per-viewport (point.withinBBox, §12.4) but debounced + viewport-cached (#12). Unclustered parks are
 * colored by designation (#2, lib/mapLegend) and each POI layer has a distinct color; a legend lives in the
 * panel. Marker/cluster colors come from the brand palette (lib/brandColors) so they match the themed UI.
 *
 * The map is **fully re-created on every color-mode change** (map.remove() in cleanup, effect keyed on
 * colorMode) and a basemap switch calls map.setStyle() (which wipes all custom sources/layers). So the
 * overlay set is defined ONCE in `installLayers()` and re-run on both first load and every style swap,
 * while event handlers (which survive setStyle by matching layer id) are attached once in `attachHandlers()`.
 * Any new state must live in a ref so it survives these re-mounts.
 */
type LayerKey = PoiKey;

/** A located pin for the "your map" overlay (#6). */
interface MinePin {
  parkCode: string;
  lat: number | null;
  lng: number | null;
}
interface MineData {
  considered: MinePin[];
  forYou: MinePin[];
  stamps: MinePin[];
  collective: (MinePin & { travelers: number })[];
}

/** The feature.properties the parks source carries (baked in loadAllParks) — for applyParkFilter casts. */
interface ParkFeatureProps {
  parkCode: string;
  feeFree: boolean;
  accessible: boolean;
  darkSky: boolean;
  condCategory?: string;
}

// Below this zoom the viewport spans too much to usefully auto-load per-bbox POIs (and they'd hit the
// server LIMIT anyway); a fresh toggle still force-loads so enabling a layer always shows something.
const POI_ZOOM_MIN = 5;
const MOVE_DEBOUNCE_MS = 250;
// "Your map" mode (#6) hides the base parks and shows the personal overlay (and vice versa).
const BASE_PARK_LAYERS = ['clusters', 'cluster-count', 'park-point', 'park-point-icon'];
const MINE_LAYERS = ['mine-collective', 'mine-considered', 'mine-foryou', 'mine-stamps'];
// Park boundary polygons fade in past this zoom; fetched lazily, capped per pan to bound NPS fan-out (#2c).
const BOUNDARY_ZOOM_MIN = 7;
const BOUNDARY_FETCH_CAP = 8;

export function MapExplorer({
  initialBounds,
  facetOptions,
  connectionOptions,
  signedIn,
  initialView,
}: {
  initialBounds?: [[number, number], [number, number]] | null;
  facetOptions?: { states: { code: string; name: string }[]; activities: string[]; topics: string[] };
  connectionOptions?: { topics: string[]; people: string[] };
  signedIn?: boolean;
  /** Decoded "share this view" deep-link (#10): seeds the camera + instrument settings on first load. */
  initialView?: MapView;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const { colorMode } = useColorMode();
  const c: BrandColors = brandColors(colorMode);
  // Seed layer/basemap/lens/conditions/mode from a deep-link when present (#10), else the defaults. Default
  // the Campgrounds layer on (§2.11) so the map isn't empty on first load.
  const initEnabled: Record<string, boolean> = initialView?.layers?.length
    ? Object.fromEntries(initialView.layers.map((k) => [k, true]))
    : { campgrounds: true };
  const enabledRef = useRef<Record<string, boolean>>(initEnabled);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(initEnabled);
  // Chosen basemap family, in a ref so it survives the colorMode re-mount (S1) + a state mirror for the UI.
  const basemapRef = useRef<Basemap>(initialView?.basemap ?? 'topo');
  const [basemap, setBasemap] = useState<Basemap>(initialView?.basemap ?? 'topo');
  // Re-install hook: set inside the effect, called after a setStyle() wipes the overlays.
  const installRef = useRef<((map: MlMap) => void) | null>(null);
  // Active data lens (#3): recolors parks by a variable. Ref survives the colorMode re-mount; applyLensRef
  // is set inside the effect so the panel picker can recolor the live map.
  const lensRef = useRef<LensKey>(initialView?.lens ?? 'none');
  const [lens, setLens] = useState<LensKey>(initialView?.lens ?? 'none');
  const applyLensRef = useRef<((map: MlMap) => void) | null>(null);
  // The full parks FeatureCollection, fetched once and reused across style swaps (no per-pan refetch).
  const parksFcRef = useRef<FeatureCollection | null>(null);
  // The viewport each POI layer was last fetched for → skip refetch when panning within loaded bounds.
  const poiBboxRef = useRef<Record<string, [number, number, number, number]>>({});
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Aborts in-flight map fetches on cleanup (colorMode remount / unmount) so a late response never calls
  // setData on a removed map or flips loading state after teardown.
  const abortRef = useRef<AbortController | null>(null);
  // Park boundary polygons (#2c): which parkCodes we've already fetched + the accumulated FeatureCollection.
  const fetchedBoundariesRef = useRef<Set<string>>(new Set());
  const boundariesFcRef = useRef<FeatureCollection | null>(null);
  // Vibe search + quick facet filters (#8): filter the already-loaded parks source to matches (re-clusters
  // the subset). vibeMatchRef = the op=vibe result parkCodes (null = no text search); facets = baked-prop
  // chips. Both held in refs so the filter survives the colorMode re-mount, mirrored in state for the UI.
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const vibeMatchRef = useRef<Set<string> | null>(null);
  const [vibeCount, setVibeCount] = useState<number | null>(null);
  const facetsRef = useRef({ free: false, accessible: false, darkSky: false });
  const [facets, setFacets] = useState({ free: false, accessible: false, darkSky: false });
  // Server-backed facets (#8b): state/activity/topic → op=facetcodes parkCodes intersected into the filter.
  const [serverFacets, setServerFacets] = useState({ stateCode: '', activity: '', topic: '' });
  const serverFacetRef = useRef<Set<string> | null>(null);
  const serverFacetsSelRef = useRef({ stateCode: '', activity: '', topic: '' }); // latest selection, to drop stale fetches
  const vibeSeqRef = useRef(0); // monotonic id so a newer vibe search supersedes an in-flight older one
  // Condition-aware mode (#4): a chosen date (null = off) recolors parks by a live "good to visit?" score.
  // conditionScoresRef = parkCode→category from op=conditions; stamped onto features as condCategory.
  const conditionsDateRef = useRef<string | null>(initialView?.conditions ?? null);
  const [conditionsDate, setConditionsDate] = useState<string | null>(initialView?.conditions ?? null);
  const conditionScoresRef = useRef<Map<string, string>>(new Map());
  const conditionsSeqRef = useRef(0); // supersede an in-flight conditions fetch when the viewport pans (bbox race)
  // Graph connections (#5): viewport NEAR/SHARES edges, or a thematic-trail path (trailSel = '' | 'topic:X' | 'person:Y').
  const [connKind, setConnKind] = useState<'off' | 'near' | 'topic' | 'activity'>('off');
  const connKindRef = useRef<'off' | 'near' | 'topic' | 'activity'>('off');
  const [trailSel, setTrailSel] = useState('');
  const trailSelRef = useRef('');
  const connSeqRef = useRef(0);
  // "Your map" overlay (#6): 'all' base parks vs 'mine' personal overlay; data cached in a ref for remount.
  const [mode, setMode] = useState<'all' | 'mine'>(initialView?.mode ?? 'all');
  const modeRef = useRef<'all' | 'mine'>(initialView?.mode ?? 'all');
  const mineDataRef = useRef<MineData | null>(null);
  // Ranger command-bar highlight (#7/S5): the parks the ranger most-recently surfaced, ringed on the map.
  // Kept in a ref so the highlight survives the colorMode remount + basemap setStyle (re-applied in install).
  const rangerHighlightRef = useRef<FeatureCollection | null>(null);
  // In-flight fetch count → a loading indicator while clusters/POIs load (R3 §4.4): without this the
  // map looks empty for several seconds after the basemap paints.
  const pendingRef = useRef(0);
  const [loading, setLoading] = useState(false);

  function begin() {
    pendingRef.current += 1;
    setLoading(true);
  }
  function end() {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0) setLoading(false);
  }

  function bboxParams(map: MlMap, extra: Record<string, string> = {}) {
    const b = map.getBounds();
    return new URLSearchParams({
      op: 'bbox',
      minLat: String(b.getSouth()),
      minLng: String(b.getWest()),
      maxLat: String(b.getNorth()),
      maxLng: String(b.getEast()),
      ...extra,
    });
  }

  // Field & offline (#10): the viewport bbox + enabled POI layers, for the /api/map/{offline,field} routes.
  function areaParams(map: MlMap) {
    const b = map.getBounds();
    return new URLSearchParams({
      minLat: String(b.getSouth()),
      minLng: String(b.getWest()),
      maxLat: String(b.getNorth()),
      maxLng: String(b.getEast()),
      layers: POI_ORDER.filter((k) => enabledRef.current[k]).join(','),
    });
  }
  // "Share this view": encode the live camera + instrument settings into a deep-link and copy it (#10).
  async function shareView() {
    const map = mapRef.current;
    if (!map) return;
    const ctr = map.getCenter();
    const qs = encodeMapView({
      lat: ctr.lat,
      lng: ctr.lng,
      zoom: map.getZoom(),
      basemap: basemapRef.current === 'dark' ? 'dark' : 'topo',
      layers: POI_ORDER.filter((k) => enabledRef.current[k]),
      lens: lensRef.current,
      conditions: conditionsDateRef.current,
      mode: modeRef.current,
    });
    const url = `${window.location.origin}/map${qs ? `?${qs}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', 'Anyone with it opens this exact map view.');
    } catch {
      toast.info('Copy this link', url);
    }
  }
  function openFieldSheet() {
    const map = mapRef.current;
    if (map) window.open(`/api/map/field?${areaParams(map)}`, '_blank', 'noopener');
  }
  function downloadOffline() {
    const map = mapRef.current;
    if (!map) return;
    // Anchor download — the route's Content-Disposition triggers the save without navigating away.
    const a = document.createElement('a');
    a.href = `/api/map/offline?${areaParams(map)}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Parks: fetch the whole (server-cached) set ONCE, memoize the FeatureCollection, and let MapLibre
  // cluster it client-side. Re-applies instantly from the ref after a basemap/style swap (#12).
  async function loadAllParks(map: MlMap) {
    if (parksFcRef.current) {
      applyParkFilter(); // re-apply (with any active vibe/facet filter) from cache
      return;
    }
    begin();
    try {
      const res = await fetch('/api/graph?op=parks-all', { signal: abortRef.current?.signal });
      const { parks } = (await res.json()) as { parks: ParkPoint[] };
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: (parks ?? [])
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => {
            const dk = designationKey(p.designation);
            return {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
              // desigKey → color (#2)/lens (#3); icon → shape (#2d); darkSky → boundary glow; the rest feed
              // the data lenses (#3) + facet filters (#8). bortleScale baked as -1 = "no data" sentinel.
              properties: {
                parkCode: p.parkCode, name: p.name, designation: p.designation,
                desigKey: dk, icon: markerImageId(designationIcon(dk)), darkSky: !!p.darkSky,
                bortleScale: p.bortleScale ?? -1, crowdLevel: p.crowdLevel ?? '', feeFree: !!p.feeFree, accessible: !!p.accessible,
              },
            };
          }),
      };
      parksFcRef.current = fc;
      applyParkFilter();
    } catch {
      /* keep existing data */
    } finally {
      end();
    }
  }

  // Apply the active vibe-match ∩ facet filter to the loaded parks source (re-clusters the subset) (#8).
  // No filter active → the full set. Reads parksFcRef so it works on cache, install, and remount.
  function applyParkFilter() {
    const map = mapRef.current;
    const full = parksFcRef.current;
    if (!map || !full) return;
    const vibe = vibeMatchRef.current;
    const f = facetsRef.current;
    const features = full.features.filter((ft) => {
      const p = ft.properties as ParkFeatureProps | null;
      if (!p) return true;
      if (vibe && !vibe.has(p.parkCode)) return false;
      if (serverFacetRef.current && !serverFacetRef.current.has(p.parkCode)) return false; // #8b state/activity/topic
      if (f.free && !p.feeFree) return false;
      if (f.accessible && !p.accessible) return false;
      if (f.darkSky && !p.darkSky) return false;
      return true;
    });
    // In conditions mode, stamp each feature's condCategory from the latest scores (default 'unknown') so
    // the park-point match expression can recolor by it (#4).
    if (conditionsDateRef.current) {
      const scores = conditionScoresRef.current;
      for (const ft of features) {
        const p = ft.properties as ParkFeatureProps | null;
        if (p) p.condCategory = (p.parkCode && scores.get(p.parkCode)) || 'unknown';
      }
    }
    (map.getSource('parks') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  // Condition-aware recolor (#4): fetch op=conditions for the viewport + chosen date, map parkCode→category,
  // then re-stamp + recolor. Debounced via the moveend handler; capped/rate-limited server-side.
  async function loadConditions(map: MlMap) {
    const date = conditionsDateRef.current;
    if (!date) return;
    const seq = ++conditionsSeqRef.current;
    begin();
    try {
      const res = await fetch(`/api/graph?${bboxParams(map, { op: 'conditions', date })}`, { signal: abortRef.current?.signal });
      if (!res.ok) return; // rate-limited / error → keep prior scores
      const { parks } = (await res.json()) as { parks: { parkCode: string; category: string }[] };
      // Drop stale scores if the user changed the date OR panned to a new viewport mid-fetch (bbox race).
      if (date !== conditionsDateRef.current || seq !== conditionsSeqRef.current) return;
      conditionScoresRef.current = new Map((parks ?? []).map((p) => [p.parkCode, p.category]));
      applyParkFilter();
      applyLensRef.current?.(map);
    } catch {
      /* aborted / network */
    } finally {
      end();
    }
  }

  // Graph connections (#5): draw viewport NEAR/SHARES edges, or a thematic-trail path, into the line source.
  async function loadConnections(map: MlMap) {
    const trail = trailSelRef.current;
    const kind = connKindRef.current;
    const src = map.getSource('connections') as GeoJSONSource | undefined;
    if (!src) return;
    if (!trail && kind === 'off') {
      src.setData(emptyFC());
      return;
    }
    const seq = ++connSeqRef.current;
    // The human-readable theme name (the part after `topic:`/`person:`) so the edge popup can name the trail.
    const via = trail ? trail.slice(trail.indexOf(':') + 1) : '';
    begin();
    try {
      let url: string;
      if (trail) {
        const idx = trail.indexOf(':');
        const param = trail.slice(0, idx) === 'person' ? 'person' : 'topic';
        url = `/api/graph?op=connections&${param}=${encodeURIComponent(trail.slice(idx + 1))}`;
      } else {
        url = `/api/graph?${bboxParams(map, { op: 'connections', kind })}`;
      }
      const res = await fetch(url, { signal: abortRef.current?.signal });
      if (!res.ok) return;
      const { edges } = (await res.json()) as { edges: { aLat: number; aLng: number; bLat: number; bLng: number; weight: number }[] };
      if (seq !== connSeqRef.current) return; // superseded by a newer connection request
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: (edges ?? []).map((e) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [[e.aLng, e.aLat], [e.bLng, e.bLat]] },
          properties: { kind: trail ? 'trail' : kind, weight: e.weight, via },
        })),
      };
      src.setData(fc);
    } catch {
      /* aborted / network */
    } finally {
      end();
    }
  }
  function changeConnKind(v: 'off' | 'near' | 'topic' | 'activity') {
    connKindRef.current = v;
    setConnKind(v);
    if (v !== 'off') {
      trailSelRef.current = '';
      setTrailSel(''); // viewport edges and a thematic trail are mutually exclusive
    }
    const map = mapRef.current;
    if (map) loadConnections(map);
  }
  function changeTrail(v: string) {
    trailSelRef.current = v;
    setTrailSel(v);
    if (v) {
      connKindRef.current = 'off';
      setConnKind('off');
    }
    const map = mapRef.current;
    if (map) loadConnections(map);
  }

  // "Your map" overlay (#6): fetch the user's considered/for-you/stamps/collective once and render them as
  // non-clustered overlay layers above the base parks.
  async function loadMine(map: MlMap) {
    if (!signedIn) return;
    if (mineDataRef.current) {
      applyMineData(map, mineDataRef.current);
      return;
    }
    begin();
    try {
      const res = await fetch('/api/map/mine', { signal: abortRef.current?.signal });
      if (!res.ok) return;
      const data = (await res.json()) as MineData;
      mineDataRef.current = data;
      applyMineData(map, data);
    } catch {
      /* aborted / network */
    } finally {
      end();
    }
  }
  function applyMineData(map: MlMap, data: MineData) {
    const fc = (pins: { parkCode: string; lat: number | null; lng: number | null; travelers?: number }[]): FeatureCollection => ({
      type: 'FeatureCollection',
      features: pins
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
          properties: { parkCode: p.parkCode, travelers: p.travelers ?? 1 },
        })),
    });
    (map.getSource('mine-considered') as GeoJSONSource | undefined)?.setData(fc(data.considered));
    (map.getSource('mine-foryou') as GeoJSONSource | undefined)?.setData(fc(data.forYou));
    (map.getSource('mine-stamps') as GeoJSONSource | undefined)?.setData(fc(data.stamps));
    (map.getSource('mine-collective') as GeoJSONSource | undefined)?.setData(fc(data.collective));
  }
  // Apply the current mode's visibility (base parks vs personal overlay); in 'mine' also (lazy-)load the data.
  function applyMode(map: MlMap) {
    const mine = modeRef.current === 'mine';
    for (const id of BASE_PARK_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mine ? 'none' : 'visible');
    for (const id of MINE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mine ? 'visible' : 'none');
    // In 'mine' the personal overlay stands alone: hide the base-park chrome (connection edges would otherwise
    // float between now-hidden parks; boundaries/POIs just clutter). Restore it in 'all', honoring POI toggles.
    for (const id of ['connections-line', 'park-boundaries-glow', 'park-boundaries-fill', 'park-boundaries-line'])
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mine ? 'none' : 'visible');
    for (const key of POI_ORDER)
      for (const id of [`poi-${key}`, `poi-${key}-icon`, `poi-${key}-clusters`, `poi-${key}-count`])
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', !mine && enabledRef.current[key] ? 'visible' : 'none');
    if (mine) loadMine(map);
  }
  function changeMode(m: 'all' | 'mine') {
    modeRef.current = m;
    setMode(m);
    const map = mapRef.current;
    if (map) applyMode(map);
  }

  // Toggle conditions mode for a date (null = off → restore the lens/designation coloring).
  function changeConditions(date: string | null) {
    conditionsDateRef.current = date;
    setConditionsDate(date);
    const map = mapRef.current;
    if (!map) return;
    if (date) {
      loadConditions(map);
    } else {
      conditionScoresRef.current = new Map();
      applyParkFilter();
      applyLensRef.current?.(map);
    }
  }

  // Vibe search (#8): semantic op=vibe (existing, rate-limited 20/60s) → keep only matching parks + fly to
  // them. Gated behind explicit submit (Enter/Go), never per keystroke. min 3 chars.
  async function runVibeSearch() {
    const q = query.trim();
    const map = mapRef.current;
    if (q.length < 3 || !map) return;
    const seq = ++vibeSeqRef.current;
    setSearching(true);
    begin();
    try {
      const res = await fetch(`/api/graph?op=vibe&q=${encodeURIComponent(q)}`, { signal: abortRef.current?.signal });
      const matches = res.ok ? ((await res.json()).parks as { parkCode: string; lat: number | null; lng: number | null }[]) : [];
      if (seq !== vibeSeqRef.current) return; // a newer search superseded this one
      const located = (matches ?? []).filter((p) => p.parkCode);
      vibeMatchRef.current = new Set(located.map((p) => p.parkCode));
      setVibeCount(located.length);
      applyParkFilter();
      const withCoords = located.filter((p) => p.lat != null && p.lng != null);
      if (withCoords.length) {
        const b = new maplibregl.LngLatBounds();
        withCoords.forEach((p) => b.extend([p.lng as number, p.lat as number]));
        if (!b.isEmpty()) map.fitBounds(b, { padding: 80, maxZoom: 9, duration: 600 });
      }
    } catch {
      /* aborted / network — leave prior results */
    } finally {
      setSearching(false);
      end();
    }
  }

  function clearSearch() {
    vibeMatchRef.current = null;
    setVibeCount(null);
    setQuery('');
    applyParkFilter();
  }

  function toggleFacet(key: 'free' | 'accessible' | 'darkSky') {
    const next = { ...facetsRef.current, [key]: !facetsRef.current[key] };
    facetsRef.current = next;
    setFacets(next);
    applyParkFilter();
  }

  // Server-backed facets (#8b): fetch the matching parkCodes for the chosen state/activity/topic and
  // intersect them into the parks filter. No facet set → no constraint.
  async function loadServerFacets(f: { stateCode: string; activity: string; topic: string }) {
    if (!f.stateCode && !f.activity && !f.topic) {
      serverFacetRef.current = null;
      applyParkFilter();
      return;
    }
    begin();
    try {
      const qs = new URLSearchParams({ op: 'facetcodes' });
      if (f.stateCode) qs.set('stateCode', f.stateCode);
      if (f.activity) qs.set('activity', f.activity);
      if (f.topic) qs.set('topic', f.topic);
      const res = await fetch(`/api/graph?${qs.toString()}`, { signal: abortRef.current?.signal });
      const data = res.ok ? ((await res.json()) as { parkCodes: string[] }) : { parkCodes: [] };
      const sel = serverFacetsSelRef.current;
      if (sel.stateCode !== f.stateCode || sel.activity !== f.activity || sel.topic !== f.topic) return; // superseded
      serverFacetRef.current = new Set(data.parkCodes ?? []);
      applyParkFilter();
    } catch {
      /* aborted / network */
    } finally {
      end();
    }
  }
  function changeServerFacet(key: 'stateCode' | 'activity' | 'topic', value: string) {
    const next = { ...serverFacets, [key]: value };
    serverFacetsSelRef.current = next;
    setServerFacets(next);
    loadServerFacets(next);
  }

  async function loadPoiLayer(map: MlMap, key: LayerKey, force = false) {
    const b = map.getBounds();
    const cur: [number, number, number, number] = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    // Skip refetch when the viewport is within the bounds we last loaded this layer for (e.g. zooming in).
    const last = poiBboxRef.current[key];
    if (!force && last && cur[0] >= last[0] && cur[1] >= last[1] && cur[2] <= last[2] && cur[3] <= last[3]) return;
    begin();
    try {
      const res = await fetch(`/api/graph?${bboxParams(map, { layer: key })}`, { signal: abortRef.current?.signal });
      const { items } = (await res.json()) as { items: { id?: string; parkCode?: string; name: string; lat: number; lng: number }[] };
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: (items ?? [])
          .filter((i) => i.lat != null && i.lng != null)
          .map((i) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [i.lng, i.lat] },
            properties: { id: i.id ?? i.parkCode ?? '', name: i.name, parkCode: i.parkCode ?? '', icon: markerImageId(poiIcon(key)) },
          })),
      };
      (map.getSource(`poi-${key}`) as GeoJSONSource | undefined)?.setData(fc);
      poiBboxRef.current[key] = cur;
    } catch {
      /* keep existing */
    } finally {
      end();
    }
  }

  // Enabled POI layers for the current view. Auto-refresh (moveend) is zoom-gated; `force` (initial load,
  // style re-install, fresh toggle) loads regardless and bypasses the viewport-cache skip.
  function loadPoisForView(map: MlMap, force = false) {
    if (!force && map.getZoom() < POI_ZOOM_MIN) return;
    for (const key of POI_ORDER) if (enabledRef.current[key]) loadPoiLayer(map, key, force);
  }

  // Park boundary polygons (#2c): past BOUNDARY_ZOOM_MIN, fetch boundaries for visible parks not yet loaded
  // (capped per pan), tag each feature with the park's designation + darkSky (for the fill/glow paint), and
  // accumulate into one source. NPS boundary coverage is uneven → empty responses no-op gracefully. Reuses
  // the cached /api/parkboundary/[parkCode] route (fetchParkBoundary), mirroring MiniMap's boundary overlay.
  async function loadBoundariesForView(map: MlMap) {
    if (map.getZoom() < BOUNDARY_ZOOM_MIN || !parksFcRef.current) return;
    const b = map.getBounds();
    const targets = parksFcRef.current.features
      .map((f) => ({ p: f.properties as { parkCode: string; desigKey: string; darkSky: boolean }, c: (f.geometry as Point).coordinates }))
      .filter(({ p, c }) => p.parkCode && !fetchedBoundariesRef.current.has(p.parkCode)
        && c[0] >= b.getWest() && c[0] <= b.getEast() && c[1] >= b.getSouth() && c[1] <= b.getNorth())
      .slice(0, BOUNDARY_FETCH_CAP);
    if (!targets.length) return;
    targets.forEach(({ p }) => fetchedBoundariesRef.current.add(p.parkCode)); // mark up front so a pan mid-fetch doesn't re-request
    begin();
    try {
      const fetched = await Promise.all(targets.map(async ({ p }) => {
        try {
          const r = await fetch(`/api/parkboundary/${encodeURIComponent(p.parkCode)}`, { signal: abortRef.current?.signal });
          if (!r.ok) return [] as Feature[];
          const geo = (await r.json()) as { features?: Feature[] };
          if (!geo.features?.length) return [] as Feature[];
          return geo.features.map((ft) => ({ ...ft, properties: { ...(ft.properties ?? {}), desigKey: p.desigKey, darkSky: p.darkSky } }));
        } catch {
          return [] as Feature[];
        }
      }));
      const newFeatures = fetched.flat();
      if (newFeatures.length) {
        const fc: FeatureCollection = { type: 'FeatureCollection', features: [...(boundariesFcRef.current?.features ?? []), ...newFeatures] };
        boundariesFcRef.current = fc;
        (map.getSource('park-boundaries') as GeoJSONSource | undefined)?.setData(fc);
      }
    } finally {
      end();
    }
  }

  // Toggle a layer's visibility + (force) load when enabled.
  function toggleLayer(key: LayerKey, on: boolean) {
    const next = { ...enabledRef.current, [key]: on };
    enabledRef.current = next;
    setEnabled(next);
    const map = mapRef.current;
    if (!map) return;
    // Toggle the whole clustered group (point + icon + cluster bubble + count) (#11/#2d). POIs only show in
    // 'all' mode (the personal overlay hides them); we still update the ref + load so they're ready on return.
    const show = on && modeRef.current === 'all';
    for (const id of [`poi-${key}`, `poi-${key}-icon`, `poi-${key}-clusters`, `poi-${key}-count`]) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    if (on) loadPoiLayer(map, key, true);
  }

  // Switch basemap family: setStyle wipes custom sources/layers, so re-install overlays on the next idle.
  // The choice is held in a ref so it also survives the colorMode re-mount (the new map starts in it).
  function changeBasemap(next: Basemap) {
    basemapRef.current = next;
    setBasemap(next);
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(basemapStyle(next, colorMode === 'dark' ? 'dark' : 'light'));
    map.once('idle', () => installRef.current?.(map));
  }

  // Switch the active data lens (#3): recolor the live park-point layer + persist for re-installs/remounts.
  function changeLens(next: LensKey) {
    lensRef.current = next;
    setLens(next);
    const map = mapRef.current;
    if (map) applyLensRef.current?.(map);
  }

  useEffect(() => {
    if (!ref.current) return;
    registerMapProtocols();
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        // Start in the persisted basemap family so a colorMode toggle doesn't reset the user's choice.
        style: basemapStyle(basemapRef.current, colorMode === 'dark' ? 'dark' : 'light'),
        center: US_CENTER,
        zoom: 3.2,
      });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[MapExplorer] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;
    const ac = new AbortController();
    abortRef.current = ac;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

    // Designation color ramp for unclustered parks (#2). Clusters stay pine; individual park points (zoom > 8)
    // shade by designation so National Parks / Monuments / Historic sites / Seashores read apart at a glance.
    const parkColorExpr = ['match', ['get', 'desigKey'], ...designationMatchStops(colorMode), designationDefaultColor(colorMode)] as unknown as ExpressionSpecification;

    // Recolor the unclustered park-point layer for the active data lens (#3); 'none' restores designation
    // colors. Set via paint property so switching lenses is instant (no source reload). Re-applied on every
    // (re)install so it survives basemap swaps + the colorMode re-mount.
    function applyLens(map: MlMap) {
      if (!map.getLayer('park-point')) return;
      // Precedence: conditions mode (#4) > data lens (#3) > designation (#2).
      let expr: ExpressionSpecification;
      if (conditionsDateRef.current) {
        expr = ['match', ['get', 'condCategory'], ...conditionMatchStops(colorMode), conditionDefaultColor(colorMode)] as unknown as ExpressionSpecification;
      } else if (lensRef.current !== 'none') {
        expr = lensColorExpr(lensRef.current, colorMode) as unknown as ExpressionSpecification;
      } else {
        expr = parkColorExpr;
      }
      map.setPaintProperty('park-point', 'circle-color', expr);
    }
    applyLensRef.current = applyLens;

    // One POI layer "group" (#11): clustered like parks (so dense areas collapse instead of a dot field),
    // in the layer's distinct color (#2). Three layers per key — the unclustered points keep the bare
    // `poi-${key}` id so the existing toggle + popup handler still target them. cluster-count needs a
    // vendored text-font (Noto Sans) or it 404s the default Open Sans stack (same gotcha as the parks count).
    function addPoiLayerGroup(map: MlMap, key: PoiKey) {
      const col = poiColor(key, colorMode);
      const vis = enabledRef.current[key] ? 'visible' : 'none';
      map.addSource(`poi-${key}`, { type: 'geojson', data: emptyFC(), cluster: true, clusterMaxZoom: 8, clusterRadius: 50 });
      map.addLayer({ id: `poi-${key}-clusters`, type: 'circle', source: `poi-${key}`, filter: ['has', 'point_count'], layout: { visibility: vis },
        paint: { 'circle-color': col, 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 13, 10, 18, 30, 24] } });
      map.addLayer({ id: `poi-${key}-count`, type: 'symbol', source: `poi-${key}`, filter: ['has', 'point_count'],
        layout: { visibility: vis, 'text-field': '{point_count_abbreviated}', 'text-size': 11, 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#fff' } });
      map.addLayer({ id: `poi-${key}`, type: 'circle', source: `poi-${key}`, filter: ['!', ['has', 'point_count']], layout: { visibility: vis },
        paint: { 'circle-color': col, 'circle-radius': 5, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      map.addLayer({ id: `poi-${key}-icon`, type: 'symbol', source: `poi-${key}`, filter: ['!', ['has', 'point_count']],
        layout: { visibility: vis, 'icon-image': ['get', 'icon'], 'icon-size': 0.45, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    }

    // Sources + layers + visibility. Idempotent + re-runnable: called on first load AND after a setStyle()
    // (basemap swap). MapLibre's setStyle diff PRESERVES our imperatively-added sources/layers between two
    // protomaps themes, so we only (re)add them when missing (a fresh map / a full style wipe) — otherwise
    // `addSource` throws "Source already exists". Either way we refresh data + framing. `fit` frames the
    // initial view only — a basemap swap must not yank the camera back.
    function installLayers(map: MlMap, { fit }: { fit: boolean }) {
      const desigColorExpr = () => ['match', ['get', 'desigKey'], ...designationMatchStops(colorMode), designationDefaultColor(colorMode)] as unknown as ExpressionSpecification;
      // Opacity ramp: invisible until ~BOUNDARY_ZOOM_MIN, then fade in as you zoom into a park.
      const fade = (max: number) => ['interpolate', ['linear'], ['zoom'], BOUNDARY_ZOOM_MIN, 0, BOUNDARY_ZOOM_MIN + 1.5, max] as unknown as ExpressionSpecification;

      if (!map.getSource('parks')) {
        // Boundary polygons FIRST so they sit under the markers (#2c): a soft gold glow under dark-sky parks,
        // a designation-colored translucent fill, and a designation-colored outline — all zoom-faded.
        map.addSource('park-boundaries', { type: 'geojson', data: boundariesFcRef.current ?? emptyFC() });
        map.addLayer({ id: 'park-boundaries-glow', type: 'line', source: 'park-boundaries', filter: ['==', ['get', 'darkSky'], true],
          paint: { 'line-color': c.stamps, 'line-width': 6, 'line-blur': 4, 'line-opacity': fade(0.5) } });
        map.addLayer({ id: 'park-boundaries-fill', type: 'fill', source: 'park-boundaries',
          paint: { 'fill-color': desigColorExpr(), 'fill-opacity': fade(0.16) } });
        map.addLayer({ id: 'park-boundaries-line', type: 'line', source: 'park-boundaries',
          paint: { 'line-color': desigColorExpr(), 'line-width': 1.5, 'line-opacity': fade(0.9) } });

        // Park-to-park connection lines (#5), under the markers. Colored by kind.
        map.addSource('connections', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'connections-line', type: 'line', source: 'connections', layout: { 'line-cap': 'round' },
          paint: {
            'line-color': ['match', ['get', 'kind'], 'near', c.faded, 'topic', c.pine, 'activity', c.trail, 'trail', c.trail, c.faded] as unknown as ExpressionSpecification,
            'line-width': ['match', ['get', 'kind'], 'trail', 2.5, 1.4] as unknown as ExpressionSpecification,
            'line-opacity': ['match', ['get', 'kind'], 'trail', 0.85, 0.45] as unknown as ExpressionSpecification,
          } });

        map.addSource('parks', { type: 'geojson', data: emptyFC(), cluster: true, clusterMaxZoom: 8, clusterRadius: 50 });
        map.addLayer({ id: 'clusters', type: 'circle', source: 'parks', filter: ['has', 'point_count'],
          paint: { 'circle-color': c.pine, 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 30] } });
        // text-font must be a vendored stack (lib/mapStyle glyphs) — without it MapLibre requests its default
        // "Open Sans Regular,Arial Unicode MS Regular" which 404s against our self-hosted Noto Sans glyphs.
        map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'parks', filter: ['has', 'point_count'],
          layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#fff' } });
        map.addLayer({ id: 'park-point', type: 'circle', source: 'parks', filter: ['!', ['has', 'point_count']],
          paint: { 'circle-color': parkColorExpr, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });
        // A white designation glyph on top of the colored dot (#2d). The image is rendered on demand via the
        // styleimagemissing handler (lib/mapMarkers); missing → no icon, never an error.
        map.addLayer({ id: 'park-point-icon', type: 'symbol', source: 'parks', filter: ['!', ['has', 'point_count']],
          layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.55, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });

        // One clustered, distinctly-colored layer group per POI layer (#2/#11), hidden until toggled.
        for (const key of POI_ORDER) addPoiLayerGroup(map, key);

        // "Your map" memory overlays (#6), non-clustered, above the parks; hidden until "mine" mode.
        map.addSource('mine-collective', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'mine-collective', type: 'heatmap', source: 'mine-collective', layout: { visibility: 'none' },
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'travelers'], 1, 0.3, 8, 1] as unknown as ExpressionSpecification,
            'heatmap-radius': 26,
            'heatmap-opacity': 0.7,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.4, c.trailLight, 1, c.trail] as unknown as ExpressionSpecification,
          } });
        map.addSource('mine-considered', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'mine-considered', type: 'circle', source: 'mine-considered', layout: { visibility: 'none' },
          paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': c.trail } });
        map.addSource('mine-foryou', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'mine-foryou', type: 'circle', source: 'mine-foryou', layout: { visibility: 'none' },
          paint: { 'circle-radius': 6, 'circle-color': c.pine, 'circle-opacity': 0.85, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
        map.addSource('mine-stamps', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'mine-stamps', type: 'circle', source: 'mine-stamps', layout: { visibility: 'none' },
          paint: { 'circle-radius': 6, 'circle-color': c.stamps, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });

        // Ranger command-bar highlight (#7), topmost: a soft halo + a bold ring around the parks the ranger
        // surfaced, in the AI/accent tone. Non-clustered so highlights survive at any zoom (like the overlays).
        map.addSource('ranger-highlight', { type: 'geojson', data: rangerHighlightRef.current ?? emptyFC() });
        map.addLayer({ id: 'ranger-highlight-halo', type: 'circle', source: 'ranger-highlight',
          paint: { 'circle-radius': 18, 'circle-color': c.trail, 'circle-opacity': 0.18 } });
        map.addLayer({ id: 'ranger-highlight-ring', type: 'circle', source: 'ranger-highlight',
          paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': c.trail } });
      }

      // A style swap recreates the source empty — re-apply whatever boundaries we've already fetched.
      if (boundariesFcRef.current) (map.getSource('park-boundaries') as GeoJSONSource | undefined)?.setData(boundariesFcRef.current);
      // …same for the ranger highlight, so a basemap/colorMode swap keeps the rings (#7).
      if (rangerHighlightRef.current) (map.getSource('ranger-highlight') as GeoJSONSource | undefined)?.setData(rangerHighlightRef.current);

      if (fit) {
        // A "share this view" deep-link camera (#10) wins; else center on the user's considered parks
        // (R4 §4) when we have them, else the continental US.
        if (initialView && initialView.lat != null && initialView.lng != null) {
          map.jumpTo({ center: [initialView.lng, initialView.lat], zoom: initialView.zoom ?? 6 });
        } else {
          map.fitBounds(initialBounds ?? US_BOUNDS, { padding: initialBounds ? 64 : 20, maxZoom: 9, duration: 0 });
        }
      }
      loadAllParks(map);
      // Force-load enabled POIs so the layers aren't empty after a (re)install regardless of zoom.
      loadPoisForView(map, true);
      loadBoundariesForView(map);
      // Re-fetch conditions for the new viewport if conditions mode is on (#4).
      loadConditions(map);
      // Re-draw connections for the persisted selection / new viewport (#5).
      loadConnections(map);
      // Apply the active recolor (conditions > lens > designation) so a basemap swap / remount keeps it.
      applyLens(map);
      // Re-apply "your map" mode visibility + data after a (re)install (#6).
      applyMode(map);
    }
    installRef.current = (m) => installLayers(m, { fit: false });

    // Event handlers: attached once. Layer-scoped handlers (map.on('click', layerId, …)) survive setStyle by
    // re-binding to the re-created layer of the same id, so they must NOT be re-added in installLayers.
    function attachHandlers(map: MlMap) {
      attachMarkerImages(map); // render mk-* glyphs on demand (#2d), incl. after a setStyle image wipe

      // Connection edge → "why connected" popup (#5).
      map.on('mouseenter', 'connections-line', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'connections-line', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'connections-line', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { kind: string; weight: number; via?: string };
        const label = p.kind === 'near' ? `~${Math.round(p.weight)} mi apart`
          : p.kind === 'topic' ? `${p.weight} shared topic${p.weight === 1 ? '' : 's'}`
          : p.kind === 'activity' ? `${p.weight} shared activit${p.weight === 1 ? 'y' : 'ies'}`
          : p.via ? `On the “${p.via}” thematic trail`
          : 'On this thematic trail';
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>Why connected</strong><br/><span style="color:#777">${escapeHtml(label)}</span>`).addTo(map);
      });
      for (const key of POI_ORDER) {
        // Unclustered POI point → popup.
        map.on('click', `poi-${key}`, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as { name: string; parkCode: string };
          const [lng, lat] = (f.geometry as Point).coordinates;
          const link = props.parkCode ? `<br/><a href="/parks/${encodeURIComponent(props.parkCode)}" style="color:${pine[700]}">View park →</a>` : '';
          new maplibregl.Popup().setLngLat([lng, lat]).setHTML(`<strong>${escapeHtml(props.name)}</strong>${link}`).addTo(map);
        });
        // POI cluster → zoom to expand (#11).
        map.on('click', `poi-${key}-clusters`, (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: [`poi-${key}-clusters`] })[0];
          if (!f) return;
          (map.getSource(`poi-${key}`) as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id).then((zoom) =>
            map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom }),
          );
        });
      }

      map.on('click', 'clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        if (!f) return; // queryRenderedFeatures can return [] → guard before reading properties
        (map.getSource('parks') as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id).then((zoom) =>
          map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom }),
        );
      });
      map.on('click', 'park-point', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { parkCode: string; name: string; designation: string };
        const [lng, lat] = (f.geometry as Point).coordinates;
        new maplibregl.Popup().setLngLat([lng, lat]).setHTML(
          `<strong>${escapeHtml(p.name)}</strong><br/><span style="color:#777">${escapeHtml(p.designation ?? '')}</span><br/><a href="/parks/${encodeURIComponent(p.parkCode)}" style="color:${pine[700]}">View park →</a>`,
        ).addTo(map);
      });

      // Parks are loaded once (cached); POI layers + boundaries refresh per viewport, debounced + zoom-gated (#12/#2c).
      map.on('moveend', () => {
        // In 'mine' mode the base-park layers are hidden, so the viewport loaders would only fetch data for
        // invisible layers — skip them entirely (they re-run on the next pan once back in 'all').
        if (modeRef.current !== 'all') return;
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(() => {
          loadPoisForView(map);
          loadBoundariesForView(map);
          loadConditions(map);
          if (connKindRef.current !== 'off') loadConnections(map); // viewport edges depend on bbox; a trail doesn't
        }, MOVE_DEBOUNCE_MS);
      });
    }

    map.on('load', () => {
      installLayers(map, { fit: true });
      attachHandlers(map);
    });

    return () => {
      installRef.current = null;
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      ac.abort(); // cancel in-flight map fetches before tearing the map down
      map.remove();
    };
    // Re-init on color-mode change so the basemap matches light/dark (R4 §2.5); installLayers re-adds the
    // cluster + POI layers and the persisted basemapRef keeps the user's basemap choice. initialBounds is
    // set once by the RSC (consideredBounds) and is immutable for the page's life, so it's intentionally
    // omitted from deps — re-running this effect would needlessly tear down + rebuild the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Ranger command-bar → map bridge (#7/S5). Attached ONCE for the page's life (not keyed on colorMode) so a
  // map remount doesn't drop the listener; the highlight FC lives in a ref that installLayers re-applies. The
  // RangerCommandBar (a sibling in /map) fires `trailgraph:map-focus` with the located parks it surfaced; we
  // ring + frame them, leaving "mine" mode if needed so the rings sit over visible base dots.
  useEffect(() => {
    function onFocus(e: Event) {
      const detail = (e as CustomEvent<{ parks?: { parkCode: string; name?: string; lat: number; lng: number }[] }>).detail;
      const parks = (detail?.parks ?? []).filter((p) => p && p.lat != null && p.lng != null);
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: parks.map((p) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
          properties: { parkCode: p.parkCode, name: p.name ?? '' },
        })),
      };
      rangerHighlightRef.current = fc;
      const map = mapRef.current;
      if (!map) return;
      if (modeRef.current !== 'all') changeMode('all'); // rings ride over the base dots — keep them visible
      (map.getSource('ranger-highlight') as GeoJSONSource | undefined)?.setData(fc);
      if (parks.length) {
        const b = new maplibregl.LngLatBounds();
        parks.forEach((p) => b.extend([p.lng, p.lat]));
        if (!b.isEmpty()) map.fitBounds(b, { padding: 96, maxZoom: 9, duration: 800 });
      }
    }
    window.addEventListener('trailgraph:map-focus', onFocus as EventListener);
    return () => window.removeEventListener('trailgraph:map-focus', onFocus as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const designations = designationLegend(colorMode);
  const activeLensLegend = lens === 'none' ? null : lensLegend(lens, colorMode);
  const activeConditionLegend = conditionsDate ? conditionLegend(colorMode) : null;
  const tonight = tonightISO();
  const thisWeekend = weekendISO();

  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} aria-label="Map of National Park Service sites" role="application" />
      {loading ? (
        <HStack
          position="absolute"
          // Bottom-center so it never collides with the top-center ranger command bar (#7) or its results.
          bottom={3}
          left="50%"
          transform="translateX(-50%)"
          zIndex={6}
          bg="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="full"
          px={3}
          py={1.5}
          shadow="md"
          gap={2}
          aria-live="polite"
        >
          <Spinner size="sm" color="brand.solid" />
          <Text fontSize="xs" color="fg.muted">Loading map data…</Text>
        </HStack>
      ) : null}
      <Box position="absolute" top={3} left={3} maxH="calc(100vh - 80px)" overflowY="auto" bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" p={3} shadow="md">
        {/* "Your map" overlay toggle (#6) — only when signed in. */}
        {signedIn ? (
          <Box mb={3} pb={3} borderBottomWidth="1px" borderColor="border">
            <HStack gap={1.5}>
              <Button size="xs" flex={1} variant={mode === 'all' ? 'solid' : 'outline'} colorPalette="pine" onClick={() => changeMode('all')} aria-pressed={mode === 'all'}>All parks</Button>
              <Button size="xs" flex={1} variant={mode === 'mine' ? 'solid' : 'outline'} colorPalette="pine" onClick={() => changeMode('mine')} aria-pressed={mode === 'mine'}>Your map</Button>
            </HStack>
            {mode === 'mine' ? (
              <Stack gap={1} mt={2}>
                {([['Considered', c.trail], ['For you', c.pine], ['Passport stamps', c.stamps], ['Travelers like you', c.trailLight]] as const).map(([label, color]) => (
                  <HStack key={label} gap={2}>
                    <Box as="span" display="inline-block" w="8px" h="8px" borderRadius="full" bg={color} />
                    <Text fontSize="xs" color="fg.muted">{label}</Text>
                  </HStack>
                ))}
              </Stack>
            ) : null}
          </Box>
        ) : null}
        {/* Vibe search + quick facet filters (#8): filter the parks to a semantic search + baked-prop chips. */}
        <Box mb={3} pb={3} borderBottomWidth="1px" borderColor="border">
          <HStack gap={1.5}>
            <Input
              size="sm"
              placeholder="Search a vibe…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runVibeSearch(); }}
              aria-label="Search parks by vibe"
            />
            <Button size="sm" colorPalette="pine" onClick={runVibeSearch} loading={searching}>Go</Button>
          </HStack>
          {vibeCount !== null ? (
            <HStack mt={1.5} justify="space-between">
              <Text fontSize="xs" color="fg.muted">{vibeCount} match{vibeCount === 1 ? '' : 'es'}</Text>
              <Button size="2xs" variant="ghost" colorPalette="pine" onClick={clearSearch}>Clear</Button>
            </HStack>
          ) : null}
          <HStack mt={2} gap={1.5} wrap="wrap">
            {([['free', 'Free'], ['accessible', 'Accessible'], ['darkSky', 'Dark sky']] as const).map(([k, label]) => (
              <Button key={k} size="2xs" variant={facets[k] ? 'solid' : 'outline'} colorPalette="pine" onClick={() => toggleFacet(k)} aria-pressed={facets[k]}>
                {label}
              </Button>
            ))}
          </HStack>
          {facetOptions ? (
            <Stack gap={2} mt={3}>
              {([
                ['stateCode', 'State', 'All states', facetOptions.states.map((s) => ({ value: s.code, label: s.name }))],
                ['activity', 'Activity', 'All activities', facetOptions.activities.map((a) => ({ value: a, label: a }))],
                ['topic', 'Topic', 'All topics', facetOptions.topics.map((t) => ({ value: t, label: t }))],
              ] as const).map(([key, label, allLabel, options]) => (
                <Field.Root key={key}>
                  <Field.Label fontSize="2xs" color="fg.subtle" mb={0.5} textTransform="uppercase" letterSpacing="0.05em">{label}</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field value={serverFacets[key]} onChange={(e) => changeServerFacet(key, e.currentTarget.value)}>
                      <option value="">{allLabel}</option>
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
              ))}
            </Stack>
          ) : null}
        </Box>
        <Text fontSize="xs" fontWeight="semibold" mb={2} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">Layers</Text>
        <Stack gap={1.5}>
          {POI_ORDER.map((key) => (
            <Checkbox.Root key={key} size="sm" colorPalette="pine" checked={!!enabled[key]} onCheckedChange={(d) => toggleLayer(key, !!d.checked)}>
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>
                <Box as="span" display="inline-block" w="8px" h="8px" borderRadius="full" bg={poiColor(key, colorMode)} mr={2} />
                {poiLabel(key)}
              </Checkbox.Label>
            </Checkbox.Root>
          ))}
        </Stack>
        {/* Data lens picker (#3): recolor the whole parks layer by a variable. Field.Root associates the
            label with the select (screen-reader linkage), matching the /explore facet pattern. */}
        <Box borderTopWidth="1px" borderColor="border" mt={3} pt={2}>
          <Field.Root>
            <Field.Label fontSize="xs" fontWeight="semibold" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
              Color parks by
            </Field.Label>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field value={lens} onChange={(e) => changeLens(e.currentTarget.value as LensKey)}>
                {MAP_LENSES.map((l) => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>
        </Box>

        {/* Condition-aware mode (#4): recolor parks by "good to visit?" for tonight / this weekend. */}
        <Box borderTopWidth="1px" borderColor="border" mt={3} pt={2}>
          <Text fontSize="xs" fontWeight="semibold" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
            Good to visit
          </Text>
          <HStack gap={1.5} wrap="wrap">
            <Button size="2xs" variant={!conditionsDate ? 'solid' : 'outline'} colorPalette="pine" onClick={() => changeConditions(null)} aria-pressed={!conditionsDate}>Off</Button>
            <Button size="2xs" variant={conditionsDate === tonight ? 'solid' : 'outline'} colorPalette="pine" onClick={() => changeConditions(tonight)} aria-pressed={conditionsDate === tonight}>Tonight</Button>
            <Button size="2xs" variant={conditionsDate === thisWeekend ? 'solid' : 'outline'} colorPalette="pine" onClick={() => changeConditions(thisWeekend)} aria-pressed={conditionsDate === thisWeekend}>This weekend</Button>
          </HStack>
        </Box>

        {/* Graph connections (#5): draw edges between parks — proximity / shared topics-activities / a thematic trail. */}
        <Box borderTopWidth="1px" borderColor="border" mt={3} pt={2}>
          <Field.Root>
            <Field.Label fontSize="xs" fontWeight="semibold" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">Connections</Field.Label>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field value={connKind} onChange={(e) => changeConnKind(e.currentTarget.value as 'off' | 'near' | 'topic' | 'activity')}>
                <option value="off">None</option>
                <option value="near">Nearby parks</option>
                <option value="topic">Shared topics</option>
                <option value="activity">Shared activities</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>
          {connectionOptions ? (
            <Field.Root mt={2}>
              <Field.Label fontSize="2xs" color="fg.subtle" mb={0.5} textTransform="uppercase" letterSpacing="0.05em">Thematic trail</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field value={trailSel} onChange={(e) => changeTrail(e.currentTarget.value)}>
                  <option value="">—</option>
                  <optgroup label="Topics">
                    {connectionOptions.topics.map((t) => <option key={`topic:${t}`} value={`topic:${t}`}>{t}</option>)}
                  </optgroup>
                  <optgroup label="People">
                    {connectionOptions.people.map((pp) => <option key={`person:${pp}`} value={`person:${pp}`}>{pp}</option>)}
                  </optgroup>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
          ) : null}
        </Box>

        {/* Legend: conditions scale > active lens scale > designation key (matches the recolor precedence). */}
        <Box borderTopWidth="1px" borderColor="border" mt={3} pt={2}>
          <Text fontSize="xs" fontWeight="semibold" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
            {activeConditionLegend ? 'Good to visit?' : activeLensLegend ? 'Legend' : 'Parks by type'}
          </Text>
          <Stack gap={1}>
            {(activeConditionLegend ?? activeLensLegend ?? designations).map((e) => {
              const icon = (e as { icon?: string }).icon;
              return (
                <HStack key={e.key} gap={2}>
                  {icon && MARKER_SVGS[icon] ? (
                    // Designation legend shows the marker SHAPE (matching the map icons, #2d).
                    <svg viewBox="0 0 24 24" width="11" height="11" style={{ flexShrink: 0 }} aria-hidden="true">
                      <path d={MARKER_SVGS[icon]} fill={e.color} fillRule="evenodd" />
                    </svg>
                  ) : (
                    <Box as="span" display="inline-block" w="8px" h="8px" borderRadius="full" bg={e.color} />
                  )}
                  <Text fontSize="xs" color="fg.muted">{e.label}</Text>
                </HStack>
              );
            })}
          </Stack>
          <Text fontSize="2xs" color="fg.subtle" mt={1.5}>Zoom in to shade individual parks.</Text>
        </Box>

        {/* Field & offline (#10): share the exact view, or take the visible area offline. */}
        <Box borderTopWidth="1px" borderColor="border" mt={3} pt={2}>
          <Text fontSize="xs" fontWeight="semibold" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
            Field &amp; offline
          </Text>
          <HStack wrap="wrap" gap={1.5}>
            <Button size="xs" variant="outline" onClick={shareView}>Share this view</Button>
            <Button size="xs" variant="outline" onClick={openFieldSheet}>Field sheet</Button>
            <Button size="xs" variant="outline" onClick={downloadOffline}>Offline pack</Button>
          </HStack>
        </Box>
      </Box>
      <BasemapSwitcher value={basemap} onChange={changeBasemap} />
    </>
  );
}

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** Local-time YYYY-MM-DD (avoids the UTC shift toISOString() would introduce for "tonight"). */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const tonightISO = (): string => localISO(new Date());
/** Saturday of this/next weekend for the "this weekend" preset — today if Sat/Sun, else the upcoming Saturday. */
function weekendISO(): string {
  const d = new Date();
  const dow = d.getDay(); // 0 Sun … 6 Sat
  const add = dow === 0 ? 0 : 6 - dow;
  const sat = new Date(d);
  sat.setDate(d.getDate() + add);
  return localISO(sat);
}

/** Escape API text before interpolating into a Popup.setHTML string (defense-in-depth: NPS data is trusted
 * but may contain & < > etc., and setHTML interprets markup). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

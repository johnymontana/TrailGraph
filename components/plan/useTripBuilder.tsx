'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from '../../lib/toast';
import { sameIdSet, tripDayLoads, type DayLoad } from '../../lib/itinerary';
import type { TripDashboard } from '../../lib/conditions';
import type { TripMetrics } from '../../lib/trip-lab';
import type { TripMapStop, TripMapOrigin } from '../../lib/trip-map-render';

/**
 * The single trip-state store for /plan (ADR-076). `TripBuilderProvider` mounts ONCE inside PlanShell,
 * wrapping all three panes (itinerary / map / chat cells) so the itinerary composition, the map canvas,
 * and the tab bar read one `trips`/`trip`/`metrics` truth — the pre-shell TripBuilder owned all of this
 * as one 900-line component. ChatPanel deliberately does NOT consume this context (it's reused standalone
 * by the Ranger School lesson player); chat ↔ builder coupling stays on the `trailgraph:*` window events.
 *
 * Design rules carried from the monolith:
 *  • Canvas props (`canvasStops`/`canvasOrigin`/`addedParkCodes`) are memoized keyed on `trip` — fresh
 *    array identities each render would restart MapTripCanvas's route-draw animation (#9 MEDIUM-1).
 *  • `trailgraph:active-trip` dispatches from HERE, exactly once app-wide (multiple consumers of the
 *    context must not each broadcast it).
 *  • Every op goes through `postOp` for uniform 401/429 handling (ADR-076): a 429 always surfaces as the
 *    `rateLimited` toast — the monolith let rename/suggest-days fail silently and `checkAlerts` render a
 *    false "no alerts" empty state on a 429.
 *  • A ranger-driven `refreshTrip` PRESERVES ephemeral client state: the unsaved `dayMap` survives while
 *    the stop-id set is unchanged, and a refresh landing mid-drag is stashed + applied on drop (never
 *    yank the list out from under a finger).
 */
export interface TripHike {
  id: string;
  name: string;
  lengthMiles?: number | null;
  estTimeHrs?: number | null;
  difficulty?: string | null;
  permitRequired?: boolean;
}

export interface Stop {
  id: string;
  order: number;
  day?: number | null;
  parkCode?: string | null;
  parkName?: string;
  campgroundName?: string;
  poiTitle?: string;
  placeTitle?: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
  hikes?: TripHike[];
  lodging?: { id: string; name: string; feeUSD?: number | null; reservationUrl?: string | null } | null;
  driveTo?: { miles: number; minutes: number; source: string } | null;
}

export interface Trip {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  // Trip origin (defaults from the user's home; editable per trip) + its computed drive legs.
  origin?: { lat: number; lng: number; label: string | null } | null;
  returnToOrigin?: boolean;
  originLeg?: { miles: number; minutes: number; source: string } | null;
  returnLeg?: { miles: number; minutes: number; source: string } | null;
  stops: (Stop | null)[];
}

export interface TripSummary {
  id: string;
  name: string;
  stops: number;
}

export interface TripAlerts {
  park: string;
  alerts: { category: string; title: string }[];
}

export interface TripCost {
  perPark: { parkCode: string; parkName: string; fee: number }[];
  total: number;
  atbPrice: number;
  holdsAtb: boolean;
  atbSaves: boolean;
}

/** Display label for any stop kind (park / campground / POI / place / custom). */
export const stopLabel = (s: Stop): string =>
  s.parkName ?? s.placeTitle ?? s.campgroundName ?? s.poiTitle ?? s.name ?? 'Stop';

/** Touch-friendly sizing: ≥40px targets on mobile (Chakra token 10), compact on md+ where a pointer is precise. */
export const touchTarget = { minW: { base: '10', md: '6' }, minH: { base: '10', md: '6' } } as const;

const liveStops = (trip: Trip | null): Stop[] => ((trip?.stops ?? []).filter(Boolean) as Stop[]);

type OpResult<T> = { ok: true; data: T } | { ok: false; status: number };

export interface TripBuilderValue {
  trips: TripSummary[];
  trip: Trip | null;
  stops: Stop[];
  metrics: TripMetrics | null;
  alerts: TripAlerts[] | null;
  cost: TripCost | null;
  costErr: string | null;
  dashboard: TripDashboard | null;
  dayMap: Record<string, number>;
  shareUrl: string | null;
  err: string | null;
  busyOps: Set<string>;
  openingId: string | null;
  overPackedDays: DayLoad[];
  // Memoized map-canvas inputs (identity-stable per trip — see the header comment).
  canvasStops: TripMapStop[];
  canvasOrigin: TripMapOrigin | null;
  addedParkCodes: string[];
  // Result-card reveal targets (TripInsights attaches them; the check ops scroll to them).
  alertsRef: RefObject<HTMLDivElement | null>;
  costRef: RefObject<HTMLDivElement | null>;
  condRef: RefObject<HTMLDivElement | null>;
  // Ops.
  loadTrips: () => Promise<void>;
  openTrip: (id: string) => Promise<void>;
  create: (name: string) => Promise<void>;
  rename: (name: string) => Promise<boolean>;
  addPark: (code: string) => Promise<void>;
  removeStop: (stopId: string) => Promise<void>;
  removeHike: (stopId: string, trailId: string) => Promise<void>;
  removeLodging: (stopId: string, campgroundId: string) => Promise<void>;
  persistReorder: (orderedStopIds: string[]) => Promise<'ok' | 'unchanged' | 'limited'>;
  checkAlerts: () => Promise<void>;
  checkCost: () => Promise<void>;
  checkConditions: () => Promise<void>;
  share: () => Promise<void>;
  optimizeRoute: () => Promise<void>;
  fork: () => Promise<void>;
  setOrigin: (body: { place?: string; clearOrigin?: boolean; returnToOrigin?: boolean }) => Promise<boolean>;
  suggestDayPlan: () => Promise<void>;
  applyMutation: (data: { trip?: Trip | null; metrics?: TripMetrics | null }) => void;
  // Drag choreography (StopList): a refresh landing mid-drag is stashed; endDrag applies it and reports
  // whether it did (true → the drag order is stale, skip persisting it).
  beginDrag: () => void;
  endDrag: () => boolean;
}

const TripBuilderContext = createContext<TripBuilderValue | null>(null);

export function useTripBuilder(): TripBuilderValue {
  const ctx = useContext(TripBuilderContext);
  if (!ctx) throw new Error('useTripBuilder must be used inside <TripBuilderProvider>');
  return ctx;
}

export function TripBuilderProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [alerts, setAlerts] = useState<TripAlerts[] | null>(null);
  const [cost, setCost] = useState<TripCost | null>(null);
  const [costErr, setCostErr] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<TripDashboard | null>(null);
  // Live running-total badge for the build-on-map canvas (#9): updated from every mutation response.
  const [metrics, setMetrics] = useState<TripMetrics | null>(null);
  const [dayMap, setDayMap] = useState<Record<string, number>>({});
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Per-op busy flags (a Set: ops can overlap) drive `loading` on the action buttons. openingId does the
  // same for trip chips.
  const [busyOps, setBusyOps] = useState<Set<string>>(new Set());
  const [openingId, setOpeningId] = useState<string | null>(null);
  // Result cards render below the action row — scroll each into view when its button produced it (never
  // on the auto-loaded open-trip alerts).
  const alertsRef = useRef<HTMLDivElement>(null);
  const costRef = useRef<HTMLDivElement>(null);
  const condRef = useRef<HTMLDivElement>(null);

  // Stable-callback plumbing: ops are useCallback([]) and read the CURRENT trip through this ref (the
  // old monolith's [] listeners closed over first-render state — the openTrip idempotence check always
  // compared against null).
  const tripRef = useRef<Trip | null>(null);
  tripRef.current = trip;
  // Mid-drag refresh stash (ADR-076): see beginDrag/endDrag.
  const draggingRef = useRef(false);
  const pendingRefreshRef = useRef<{ trip: Trip; metrics: TripMetrics | null } | null>(null);
  // Trips the ranger already auto-opened once (the once-per-trip auto-open UX survives the retuned
  // per-message event — later edits refresh without yanking the user back to that trip).
  const autoOpenedRef = useRef<Set<string>>(new Set());

  function opStart(k: string) {
    setBusyOps((prev) => new Set(prev).add(k));
  }
  function opEnd(k: string) {
    setBusyOps((prev) => {
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  }
  const reveal = useCallback((ref: RefObject<HTMLDivElement | null>) => {
    // Next frame: the card must be in the DOM before it can be scrolled to.
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, []);

  /** Shared op runner (ADR-076): one place surfaces 401/429 for EVERY trip op — the monolith let some ops
   * fail silently and checkAlerts render a false "no alerts" on a 429. `silent` skips the 429 toast for
   * non-user-initiated calls (the auto-alerts on open). Other failures return {ok:false} for the caller's
   * own error UX. */
  const postOp = useCallback(async function postOp<T>(
    tripId: string,
    body: Record<string, unknown>,
    opts: { silent?: boolean } = {},
  ): Promise<OpResult<T>> {
    let res: Response;
    try {
      res = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if (res.status === 429) {
      if (!opts.silent) toast.info('Slow down — too many trip edits. Try again in a moment.');
      return { ok: false, status: 429 };
    }
    if (res.status === 401) {
      setErr('Sign in to plan trips.');
      return { ok: false, status: 401 };
    }
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  }, []);

  const loadTrips = useCallback(async () => {
    const res = await fetch('/api/trips');
    if (res.status === 401) {
      setErr('Sign in to plan trips.');
      return;
    }
    const { trips: list } = await res.json();
    setTrips(list ?? []);
  }, []);

  // Every stop mutation returns the fresh trip + live metrics (#9) — apply both, invalidate the now-stale
  // cost card, and refresh the sidebar stop counts. Shared by the canvas, search-add, remove, and reorder.
  const applyMutation = useCallback(
    (data: { trip?: Trip | null; metrics?: TripMetrics | null }) => {
      if (data.trip) setTrip(data.trip);
      // Keep the prior badge if metrics recompute transiently failed (null) — don't blink it off (#9 LOW-4).
      setMetrics((prev) => data.metrics ?? prev);
      setCost(null);
      setCostErr(null);
      void loadTrips();
    },
    [loadTrips],
  );

  const openTrip = useCallback(
    async (id: string) => {
      if (tripRef.current?.id === id) return; // idempotent: re-clicking the open trip is a no-op, never deselects (§4.6)
      setOpeningId(id);
      try {
        const res = await fetch(`/api/trips/${encodeURIComponent(id)}?include=metrics`);
        const { trip: opened, metrics: m } = await res.json();
        setTrip(opened);
        setMetrics(m ?? null);
        setAlerts(null);
        setCost(null);
        setCostErr(null);
        setDashboard(null);
        setDayMap({});
        pendingRefreshRef.current = null;
      } finally {
        setOpeningId(null);
      }
      // Auto-load Closure/Danger alerts on open so safety items pin to the trip artifact without an extra
      // click (P1.2). openTrip is idempotent (early-returns on the same id), so this never loops. Silent:
      // a 429 here isn't user-initiated (and no longer competes with edits — the reads budget, ADR-076).
      const r = await postOp<{ alerts?: TripAlerts[] }>(id, { op: 'alerts' }, { silent: true });
      if (r.ok && Array.isArray(r.data.alerts)) setAlerts(r.data.alerts);
    },
    [postOp],
  );

  /** Force-refetch the OPEN trip after a ranger edit (ADR-076) — bypasses openTrip's idempotence guard,
   * preserves the unsaved day plan while the stop-id set is unchanged, and defers mid-drag. */
  const refreshTrip = useCallback(async (id: string) => {
    if (tripRef.current?.id !== id) return;
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}?include=metrics`);
    if (!res.ok) return;
    const { trip: fresh, metrics: m } = (await res.json()) as { trip: Trip | null; metrics: TripMetrics | null };
    if (!fresh || tripRef.current?.id !== fresh.id) return; // the user switched trips mid-fetch
    if (draggingRef.current) {
      pendingRefreshRef.current = { trip: fresh, metrics: m ?? null };
      return;
    }
    const prevIds = liveStops(tripRef.current).map((s) => s.id);
    const nextIds = liveStops(fresh).map((s) => s.id);
    setTrip(fresh);
    setMetrics((prev) => m ?? prev);
    setCost(null);
    setCostErr(null);
    if (!sameIdSet(prevIds, nextIds)) setDayMap({});
  }, []);

  const create = useCallback(
    async (name: string) => {
      if (!name.trim()) return;
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 401) {
        setErr('Sign in to plan trips.');
        return;
      }
      const { id } = await res.json();
      await loadTrips();
      await openTrip(id);
    },
    [loadTrips, openTrip],
  );

  const rename = useCallback(
    async (name: string): Promise<boolean> => {
      const t = tripRef.current;
      if (!t || !name.trim()) return false;
      const r = await postOp<{ trip?: Trip | null }>(t.id, { op: 'rename', name: name.trim() });
      if (r.ok && r.data.trip) {
        setTrip(r.data.trip);
        void loadTrips();
        return true;
      }
      return false; // 401/429/500 → caller keeps the rename editor open so the draft isn't lost
    },
    [postOp, loadTrips],
  );

  const addPark = useCallback(
    async (code: string) => {
      const t = tripRef.current;
      if (!t || !code) return;
      const r = await postOp<{ trip?: Trip | null; metrics?: TripMetrics | null }>(t.id, {
        op: 'addStop',
        stop: { kind: 'park', refId: code },
      });
      if (r.ok) applyMutation(r.data);
    },
    [postOp, applyMutation],
  );

  const removeStop = useCallback(
    async (stopId: string) => {
      const t = tripRef.current;
      if (!t) return;
      const r = await postOp<{ trip?: Trip | null; metrics?: TripMetrics | null }>(t.id, { op: 'removeStop', stopId });
      if (r.ok) applyMutation(r.data);
    },
    [postOp, applyMutation],
  );

  // Detach a hike from a stop (ADR-071) — `(:Stop)-[:INCLUDES_TRAIL]->(:Trail)`.
  const removeHike = useCallback(
    async (stopId: string, trailId: string) => {
      const t = tripRef.current;
      if (!t) return;
      const r = await postOp<{ trip?: Trip | null }>(t.id, { op: 'excludeTrail', stopId, trailId });
      if (r.ok) applyMutation(r.data);
    },
    [postOp, applyMutation],
  );

  // Detach lodging from a stop (Campgrounds feature) — `(:Stop)-[:STAYS_AT]->(:Campground)`.
  const removeLodging = useCallback(
    async (stopId: string, campgroundId: string) => {
      const t = tripRef.current;
      if (!t) return;
      const r = await postOp<{ trip?: Trip | null }>(t.id, { op: 'excludeCampground', stopId, campgroundId });
      if (r.ok) applyMutation(r.data);
    },
    [postOp, applyMutation],
  );

  // Persist a drag-reorder on drop (#9). Skip the round-trip if the order didn't actually change; a 429
  // reports 'limited' so StopList reverts its optimistic order.
  const persistReorder = useCallback(
    async (orderedStopIds: string[]): Promise<'ok' | 'unchanged' | 'limited'> => {
      const t = tripRef.current;
      if (!t) return 'unchanged';
      const current = liveStops(t).map((s) => s.id);
      if (orderedStopIds.length !== current.length || orderedStopIds.every((id, i) => id === current[i])) return 'unchanged';
      const r = await postOp<{ trip?: Trip | null; metrics?: TripMetrics | null }>(t.id, { op: 'reorder', orderedStopIds });
      if (!r.ok) return r.status === 429 ? 'limited' : 'unchanged';
      setDayMap({}); // the route order changed → the prior day grouping no longer maps cleanly (#9 LOW-2)
      applyMutation(r.data);
      return 'ok';
    },
    [postOp, applyMutation],
  );

  const checkAlerts = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('alerts');
    try {
      const r = await postOp<{ alerts?: TripAlerts[] }>(t.id, { op: 'alerts' });
      // Only apply on success (ADR-076): the monolith set [] from an undefined 429 body — a rate limit
      // rendered as a reassuring "no alerts".
      if (r.ok) {
        setAlerts(r.data.alerts ?? []);
        reveal(alertsRef);
      }
    } finally {
      opEnd('alerts');
    }
  }, [postOp, reveal]);

  const checkCost = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('cost');
    try {
      setCost(null);
      setCostErr(null);
      const r = await postOp<{ cost?: TripCost | null }>(t.id, { op: 'cost' });
      if (!r.ok) {
        if (r.status !== 429) setCostErr(r.status === 0 ? 'Network error. Please try again.' : 'Failed to estimate trip cost. Please try again.');
        return;
      }
      setCost(r.data.cost ?? null);
      reveal(costRef);
    } finally {
      opEnd('cost');
    }
  }, [postOp, reveal]);

  const checkConditions = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('conditions');
    setDashboard(null);
    try {
      const r = await postOp<{ dashboard: TripDashboard | null }>(t.id, { op: 'conditions' });
      if (!r.ok) {
        if (r.status !== 429) toast.error('Could not load trip conditions.');
        return;
      }
      setDashboard(r.data.dashboard);
      reveal(condRef);
    } finally {
      opEnd('conditions');
    }
  }, [postOp, reveal]);

  const share = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('share');
    const res = await fetch(`/api/trips/${encodeURIComponent(t.id)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'read' }),
    }).finally(() => opEnd('share'));
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      const full = `${window.location.origin}${url}`;
      setShareUrl(full);
      let copied = false;
      if (navigator.clipboard?.writeText) {
        copied = await navigator.clipboard.writeText(full).then(() => true).catch(() => false);
      }
      if (copied) {
        toast.success('Share link copied', 'A read-only link to this trip is on your clipboard.');
      } else {
        toast.success('Share link ready', 'Copy the read-only link shown below.');
      }
    } else {
      toast.error("Couldn't create share link", 'Please try again in a moment.');
    }
  }, []);

  const optimizeRoute = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('optimize');
    try {
      const r = await postOp<{ trip?: Trip | null; metrics?: TripMetrics | null }>(t.id, { op: 'optimize' });
      if (r.ok) {
        if (r.data.trip) setDayMap({}); // route changed → the prior day grouping no longer maps cleanly
        applyMutation(r.data);
      }
    } finally {
      opEnd('optimize');
    }
  }, [postOp, applyMutation]);

  // Trip Lab (ADR-056): fork the open trip into a copy and switch to it, leaving the original untouched.
  const fork = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('fork');
    try {
      const r = await postOp<{ tripId?: string; trip?: Trip | null }>(t.id, { op: 'fork' });
      if (!r.ok) {
        if (r.status !== 429) toast.error("Couldn't fork this trip", 'Please try again in a moment.');
        return;
      }
      await loadTrips();
      if (r.data.trip) {
        setTrip(r.data.trip);
        setAlerts(null);
        setCost(null);
        setCostErr(null);
        setDashboard(null);
        setDayMap({});
      } else if (r.data.tripId) {
        await openTrip(r.data.tripId);
      }
      toast.success('Trip forked', 'Editing the copy — your original is untouched.');
    } finally {
      opEnd('fork');
    }
  }, [postOp, loadTrips, openTrip]);

  // Trip origin (defaults from home): set from free text (geocoded server-side), toggle the round trip,
  // or clear back to "starts at the first stop". Returns whether the edit applied (TripHeader closes its
  // editor only on success).
  const setOrigin = useCallback(
    async (body: { place?: string; clearOrigin?: boolean; returnToOrigin?: boolean }): Promise<boolean> => {
      const t = tripRef.current;
      if (!t) return false;
      const r = await postOp<{ trip?: Trip | null; metrics?: TripMetrics | null }>(t.id, { op: 'setOrigin', ...body });
      if (!r.ok) {
        if (r.status === 404 && body.place) {
          toast.info(`Couldn't find "${body.place}" — try a nearby city or town.`);
        }
        return false;
      }
      applyMutation(r.data);
      return true;
    },
    [postOp, applyMutation],
  );

  const suggestDayPlan = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    opStart('days');
    try {
      const r = await postOp<{ days?: { id: string; day: number }[] }>(t.id, { op: 'suggestDays' });
      if (r.ok) setDayMap(Object.fromEntries((r.data.days ?? []).map((d) => [d.id, d.day])));
    } finally {
      opEnd('days');
    }
  }, [postOp]);

  // Drag choreography (ADR-076): while a stop row is mid-drag, an incoming ranger refresh is stashed
  // instead of replacing the list under the user's finger. endDrag applies the stash — the fresh server
  // trip wins over the (now stale) drag order — and returns true so StopList skips persisting the drag.
  const beginDrag = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const endDrag = useCallback((): boolean => {
    draggingRef.current = false;
    const pending = pendingRefreshRef.current;
    if (!pending) return false;
    pendingRefreshRef.current = null;
    const prevIds = liveStops(tripRef.current).map((s) => s.id);
    const nextIds = liveStops(pending.trip).map((s) => s.id);
    setTrip(pending.trip);
    setMetrics((prev) => pending.metrics ?? prev);
    setCost(null);
    setCostErr(null);
    if (!sameIdSet(prevIds, nextIds)) setDayMap({});
    toast.info('The ranger updated this trip — list refreshed.');
    return true;
  }, []);

  // Mount: load the sidebar + honor the /plan?trip=<id> deep link (used by "Start a trip from this tour").
  useEffect(() => {
    void loadTrips();
    const id = new URLSearchParams(window.location.search).get('trip');
    if (id) void openTrip(id);
  }, [loadTrips, openTrip]);

  // Live-refresh when a ranger turn changes a trip (F8, retuned by ADR-076). ChatPanel dispatches per
  // (assistant message, trip). Behavior: always refresh the sidebar; a NEVER-seen trip auto-opens once
  // (the original save-and-open UX); an edit to the OPEN trip force-refetches it (the monolith's openTrip
  // idempotence guard silently dropped these — the builder went stale on every ranger edit after the
  // first save); an edit to some OTHER already-seen trip only refreshes the sidebar (never yank the user).
  useEffect(() => {
    function onChanged(e: Event) {
      void loadTrips();
      const id = (e as CustomEvent<{ tripId?: string }>).detail?.tripId;
      if (!id) return;
      if (tripRef.current?.id === id) {
        void refreshTrip(id);
      } else if (!autoOpenedRef.current.has(id)) {
        autoOpenedRef.current.add(id);
        void openTrip(id);
      }
    }
    window.addEventListener('trailgraph:trips-changed', onChanged);
    return () => window.removeEventListener('trailgraph:trips-changed', onChanged);
  }, [loadTrips, openTrip, refreshTrip]);

  // Broadcast the open trip's id + dates to the ranger chat (P2.1). ChatPanel attaches them as ephemeral
  // Eve client context on every send, so dated dark-sky/astro/best-time answers reflect the trip window
  // (the best night in it) instead of "tonight". Fires on open/create/rename/deselect (all call setTrip).
  // Lives in the PROVIDER so it dispatches exactly once app-wide no matter how many panes consume the
  // context (ADR-076).
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('trailgraph:active-trip', {
        detail: trip
          ? { id: trip.id, name: trip.name, startDate: trip.startDate ?? null, endDate: trip.endDate ?? null }
          : null,
      }),
    );
  }, [trip?.id, trip?.name, trip?.startDate, trip?.endDate]);

  const stops = useMemo(() => liveStops(trip), [trip]);
  // Memoize the canvas props keyed on `trip` (not on every render) — otherwise a rename keystroke would
  // hand MapTripCanvas fresh array identities and restart its route-draw animation (#9 MEDIUM-1).
  const canvasStops = useMemo(
    () => liveStops(trip).map((s) => ({ lat: s.lat ?? null, lng: s.lng ?? null, label: stopLabel(s), order: s.order })),
    [trip],
  );
  const addedParkCodes = useMemo(
    () => liveStops(trip).map((s) => s.parkCode).filter((code): code is string => !!code),
    [trip],
  );
  const canvasOrigin = useMemo(
    () =>
      trip?.origin
        ? { lat: trip.origin.lat, lng: trip.origin.lng, label: trip.origin.label, roundTrip: trip.returnToOrigin ?? false }
        : null,
    [trip],
  );
  // Schedule-aware "over-packed day" warning (ADR-071): aggregate each day's hike hours + drive hours and
  // flag the days over ~8 h. Uses dayMap (Suggest day plan) or the stop's persisted day; empty until days exist.
  const overPackedDays = useMemo(() => {
    const loadStops = liveStops(trip).map((s) => ({
      day: dayMap[s.id] ?? s.day ?? null,
      driveMinutesToHere: s.driveTo?.minutes ?? 0,
      hikeMiles: (s.hikes ?? []).reduce((m, h) => m + (h.lengthMiles ?? 0), 0),
      hikeHours: (s.hikes ?? []).reduce((m, h) => m + (h.estTimeHrs ?? 0), 0),
    }));
    return tripDayLoads(loadStops).filter((d) => d.overPacked);
  }, [trip, dayMap]);

  const value = useMemo<TripBuilderValue>(
    () => ({
      trips,
      trip,
      stops,
      metrics,
      alerts,
      cost,
      costErr,
      dashboard,
      dayMap,
      shareUrl,
      err,
      busyOps,
      openingId,
      overPackedDays,
      canvasStops,
      canvasOrigin,
      addedParkCodes,
      alertsRef,
      costRef,
      condRef,
      loadTrips,
      openTrip,
      create,
      rename,
      addPark,
      removeStop,
      removeHike,
      removeLodging,
      persistReorder,
      checkAlerts,
      checkCost,
      checkConditions,
      share,
      optimizeRoute,
      fork,
      setOrigin,
      suggestDayPlan,
      applyMutation,
      beginDrag,
      endDrag,
    }),
    [
      trips, trip, stops, metrics, alerts, cost, costErr, dashboard, dayMap, shareUrl, err, busyOps, openingId,
      overPackedDays, canvasStops, canvasOrigin, addedParkCodes,
      loadTrips, openTrip, create, rename, addPark, removeStop, removeHike, removeLodging, persistReorder,
      checkAlerts, checkCost, checkConditions, share, optimizeRoute, fork, setOrigin, suggestDayPlan,
      applyMutation, beginDrag, endDrag,
    ],
  );

  return <TripBuilderContext.Provider value={value}>{children}</TripBuilderContext.Provider>;
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Grid, HStack, Icon, IconButton, Text } from '@chakra-ui/react';
import { LuSparkles, LuX } from 'react-icons/lu';
import { TripBuilderProvider, useTripBuilder, type Trip } from './useTripBuilder';
import { TripBuilder } from './TripBuilder';
import { MapTripCanvas } from './MapTripCanvas';
import { PlanTabBar } from './PlanTabBar';
import { PlanSheet } from './PlanSheet';
import { onPlanPaneRequest } from './plan-events';
import { ChatPanel } from '../chat/ChatPanel';

export type PlanPane = 'map' | 'itinerary' | 'ranger';

/** Phase 2 (ADR-076): the AllTrails-style full-bleed map + draggable itinerary sheet, behind
 * NEXT_PUBLIC_PLAN_SHEET. A build-time NEXT_PUBLIC_ flag → the same value on server and client, so
 * branching layout on it introduces no hydration mismatch. Off by default: the Phase-1 tabs ship. */
const SHEET = process.env.NEXT_PUBLIC_PLAN_SHEET === '1';

/**
 * The /plan responsive frame (ADR-076): ONE client component owns a CSS grid whose children are the
 * itinerary rail, the map cell, and the ranger chat. md+ shows all three ("itinerary map chat",
 * ~380px · fill · 400px — the map finally leaves the scrolling builder column on desktop too); base
 * shows one full-viewport pane at a time behind a bottom tab bar. EVERYTHING mounts once — visibility
 * is pure CSS (`display`), never an unmount: the Eve chat store is in-memory per component (unmount
 * loses the thread + session cursor) and the maplibre canvas must not churn on tab switches. The pane
 * is client STATE, not a breakpoint hook — SSR and first CSR both render the Itinerary default, so no
 * breakpoint-branched markup (ADR-017).
 *
 * URL contract (ADR-076): the initial pane resolves post-mount as from=graph → Ranger (the graph
 * handoff auto-sends a chat message; it must stream where the user can see it) › explicit ?pane= ›
 * ?trip= → Itinerary › Itinerary. Tab switches write ?pane= via replaceState (no history spam — Back
 * still leaves /plan; a reload restores the pane). Desktop never reads or writes ?pane (the tab bar
 * and map pill are base-only, the only setPane callers).
 */
export function PlanShell({ initialChatEvents }: { initialChatEvents?: unknown[] }) {
  return (
    <TripBuilderProvider>
      <PlanShellInner initialChatEvents={initialChatEvents} />
    </TripBuilderProvider>
  );
}

function PlanShellInner({ initialChatEvents }: { initialChatEvents?: unknown[] }) {
  const [pane, setPaneState] = useState<PlanPane>('itinerary');
  const [flashItinerary, setFlashItinerary] = useState(false);
  const [rangerUnread, setRangerUnread] = useState(false);
  // Sheet mode (Phase 2): the map is full-bleed + a draggable itinerary sheet; the ranger opens as an
  // overlay from a FAB instead of a tab. `rangerOpen` toggles that overlay (base only).
  const [rangerOpen, setRangerOpen] = useState(false);
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const rangerOpenRef = useRef(rangerOpen);
  rangerOpenRef.current = rangerOpen;

  // Capture the landing query string during the FIRST client render — before any child effect can touch
  // it. ChatPanel's graph-handoff cleanup replaceStates seed/from away in ITS mount effect, and child
  // effects run before this (parent) component's effects — a post-mount read here would lose from=graph.
  // Render output never depends on this ref, so SSR/CSR stay identical.
  const initialSearchRef = useRef<string | null>(null);
  if (typeof window !== 'undefined' && initialSearchRef.current === null) {
    initialSearchRef.current = window.location.search;
  }

  // Resolve the initial pane from the captured query string (mobile only in effect — on md+ every pane
  // is visible so the value is inert until the viewport shrinks).
  useEffect(() => {
    const sp = new URLSearchParams(initialSearchRef.current ?? '');
    let target: PlanPane = 'itinerary';
    if (sp.get('from') === 'graph') target = 'ranger';
    else {
      const p = sp.get('pane');
      if (p === 'map' || p === 'ranger' || p === 'itinerary') target = p;
      // ?trip= implies Itinerary — already the default.
    }
    if (target !== 'itinerary') setPaneState(target);
  }, []);

  function setPane(next: PlanPane) {
    setPaneState(next);
    if (next === 'itinerary') setFlashItinerary(false);
    if (next === 'ranger') setRangerUnread(false);
    // In sheet mode the ranger is a FAB overlay, not a tab — a 'ranger' request opens it; map/itinerary close it.
    if (SHEET) setRangerOpen(next === 'ranger');
    // Write-back so a mid-session reload restores the pane; replaceState (never push) keeps Back = leave /plan.
    const url = new URL(window.location.href);
    url.searchParams.set('pane', next);
    window.history.replaceState({}, '', url.toString());
  }

  // Cross-pane affordances (F8): PlanShell ALONE owns unread/flash state — ChatPanel dispatches its
  // events pane-agnostically (it can't know about tabs; it's also mounted on /learn and on desktop where
  // a dot would be wrong). Ignore events for the pane the user is already looking at.
  useEffect(() => {
    function onTripsChanged() {
      if (paneRef.current !== 'itinerary') setFlashItinerary(true);
    }
    function onRangerActivity() {
      // "Ranger visible" is the open overlay in sheet mode, else the active tab.
      const visible = SHEET ? rangerOpenRef.current : paneRef.current === 'ranger';
      if (!visible) setRangerUnread(true);
    }
    window.addEventListener('trailgraph:trips-changed', onTripsChanged);
    window.addEventListener('trailgraph:ranger-activity', onRangerActivity);
    // In-pane handoffs (e.g. the no-trips hero's "Ask the ranger", P3.5) request a pane switch.
    const offPane = onPlanPaneRequest((p) => setPane(p));
    return () => {
      window.removeEventListener('trailgraph:trips-changed', onTripsChanged);
      window.removeEventListener('trailgraph:ranger-activity', onRangerActivity);
      offPane();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paneDisplay = (key: PlanPane) => ({ base: pane === key ? 'flex' : 'none', md: 'flex' });
  // Sheet mode reshapes the BASE layout only (md+ is always the three-region grid): the itinerary rail
  // hides (the sheet hosts it), the map is full-bleed, and the chat is a FAB-toggled overlay.
  const itinDisplay = SHEET ? { base: 'none', md: 'flex' } : paneDisplay('itinerary');
  const mapDisplay = SHEET ? { base: 'flex', md: 'flex' } : paneDisplay('map');
  const chatDisplay = SHEET ? { base: rangerOpen ? 'flex' : 'none', md: 'flex' } : paneDisplay('ranger');

  return (
    <Grid
      h="100%"
      templateAreas={{ base: `"content" "tabs"`, md: `"itinerary map chat"` }}
      // Compressible rails via minmax: fixed 380+400 rails would total 780px > the 768px md breakpoint,
      // collapsing the 1fr map track to 0 on 768–780px portrait tablets (and the map is unreachable —
      // the tab bar is md-hidden). Mins sum to 760 < 768, so the map always keeps real width (ADR-076).
      templateColumns={{ base: '1fr', md: 'minmax(260px, 380px) minmax(220px, 1fr) minmax(280px, 400px)' }}
      templateRows={{ base: '1fr auto', md: '1fr' }}
    >
      {/* Itinerary rail — the ONE TripBuilder composition, both breakpoints (ADR-076). */}
      <Box
        gridArea={{ base: 'content', md: 'itinerary' }}
        display={itinDisplay}
        flexDirection="column"
        minH={0}
        minW={0}
        overflow="hidden"
        borderRightWidth={{ md: '1px' }}
        borderColor="border"
      >
        <TripBuilder />
      </Box>

      {/* Map cell — the permanent build-on-map canvas. Construction is init-gated inside MapTripCanvas,
          so mounting it display:none here (mobile default pane = Itinerary) is safe. */}
      <Box gridArea={{ base: 'content', md: 'map' }} display={mapDisplay} minH={0} minW={0} position="relative">
        <MapCell onViewItinerary={() => setPane('itinerary')} showPill={!SHEET} />
      </Box>

      {/* Ranger chat — mounts exactly once per /plan visit (the Eve session). The chat input's safe-area
          inset is zeroed on base (the tab bar below owns the home-indicator inset there); md+ keeps env()
          because the input reaches the viewport bottom again. */}
      <Box
        gridArea={{ base: 'content', md: 'chat' }}
        display={chatDisplay}
        flexDirection="column"
        minH={0}
        minW={0}
        overflow="hidden"
        position="relative"
        borderLeftWidth={{ md: '1px' }}
        borderColor="border"
        css={{
          '--chat-safe-bottom': '0px',
          '@media (min-width: 48em)': { '--chat-safe-bottom': 'env(safe-area-inset-bottom, 0px)' },
        }}
      >
        {/* Reload persistence (P3.9): seed the thread from the saved transcript (cards included) and persist
            each turn. initialEvents replays for DISPLAY only — no initialSession, so the next send starts a
            fresh Eve session (mirrors /learn; a stale server session can't wedge the next turn). */}
        <ChatPanel initialEvents={initialChatEvents} persistUrl="/api/plan/transcript" />
        {/* Sheet mode: a close affordance since there's no tab bar to switch away from the ranger overlay. */}
        {SHEET ? (
          <IconButton
            display={{ base: 'inline-flex', md: 'none' }}
            aria-label="Back to map"
            position="absolute"
            top={2}
            right={2}
            size="sm"
            variant="solid"
            colorPalette="gray"
            onClick={() => setRangerOpen(false)}
          >
            <LuX />
          </IconButton>
        ) : null}
      </Box>

      {/* Phase 2 sheet overlay + Ranger FAB (base only; same grid cell as the map, layered above it). The
          sheet's own container is pointer-transparent except the sheet itself, so the map stays interactive
          above the peek strip. */}
      {SHEET ? (
        <Box gridArea="content" display={{ base: 'block', md: 'none' }} position="relative" pointerEvents="none" zIndex={1}>
          <PlanSheet peek={<SheetPeek />}>
            <TripBuilder />
          </PlanSheet>
          {!rangerOpen ? (
            <IconButton
              aria-label={rangerUnread ? 'Ranger, new activity' : 'Open the ranger'}
              position="absolute"
              top={3}
              right={3}
              size="lg"
              borderRadius="full"
              colorPalette="pine"
              shadow="lg"
              pointerEvents="auto"
              onClick={() => setPane('ranger')}
            >
              <Icon><LuSparkles /></Icon>
              {rangerUnread ? <Box position="absolute" top={1} right={1} boxSize={2.5} borderRadius="full" bg="orange.solid" /> : null}
            </IconButton>
          ) : null}
        </Box>
      ) : null}

      {!SHEET ? (
        <PlanTabBar pane={pane} onSelect={setPane} flashItinerary={flashItinerary} rangerUnread={rangerUnread} />
      ) : null}
    </Grid>
  );
}

/** The always-visible peek header inside the sheet (Phase 2): trip name + a compact running total. */
function SheetPeek() {
  const { trip, stops, metrics } = useTripBuilder();
  const hrs = (min: number | null | undefined) => (min == null ? null : Math.round((min / 60) * 10) / 10);
  return (
    <HStack gap={2} minW={0}>
      <Text fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">
        {trip ? trip.name : 'Your trips'}
      </Text>
      {trip && metrics && metrics.stops > 0 ? (
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          {stops.length} stop{stops.length === 1 ? '' : 's'}
          {metrics.driveMiles > 0 ? ` · ${Math.round(metrics.driveMiles)} mi · ${hrs(metrics.driveMinutes)} h` : ''}
        </Text>
      ) : null}
    </HStack>
  );
}

/** The map region: canvas props from the shared provider + the base-only "View itinerary" pill. Pane
 * switching rides the shell's `setPane` callback (context/props, not a window event — trailgraph:* stays
 * reserved for genuinely cross-tree producers like ChatPanel). */
function MapCell({ onViewItinerary, showPill }: { onViewItinerary: () => void; showPill: boolean }) {
  const { trip, canvasStops, canvasOrigin, addedParkCodes, metrics, applyMutation } = useTripBuilder();
  return (
    <>
      <MapTripCanvas
        tripId={trip?.id ?? null}
        stops={canvasStops}
        origin={canvasOrigin}
        addedParkCodes={addedParkCodes}
        metrics={metrics}
        onMutated={(d) => applyMutation({ trip: d.trip as unknown as Trip | null, metrics: d.metrics })}
        cooperativeGestures={false}
      />
      {/* bottom clears maplibre's attribution strip (~24px, z-indexed above siblings) — at 390px its
          expanded inner div otherwise intercepts the tap (caught by plan-mobile e2e). Hidden in sheet mode
          (the sheet is always present). */}
      {showPill ? (
        <Button
          display={{ base: 'inline-flex', md: 'none' }}
          position="absolute"
          bottom={10}
          left="50%"
          transform="translateX(-50%)"
          zIndex={1}
          size="sm"
          minH="10"
          borderRadius="full"
          colorPalette="pine"
          shadow="md"
          onClick={onViewItinerary}
        >
          View itinerary
        </Button>
      ) : null}
    </>
  );
}

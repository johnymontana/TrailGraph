'use client';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Grid } from '@chakra-ui/react';
import { TripBuilderProvider, useTripBuilder, type Trip } from './useTripBuilder';
import { TripBuilder } from './TripBuilder';
import { MapTripCanvas } from './MapTripCanvas';
import { PlanTabBar } from './PlanTabBar';
import { ChatPanel } from '../chat/ChatPanel';

export type PlanPane = 'map' | 'itinerary' | 'ranger';

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
export function PlanShell() {
  return (
    <TripBuilderProvider>
      <PlanShellInner />
    </TripBuilderProvider>
  );
}

function PlanShellInner() {
  const [pane, setPaneState] = useState<PlanPane>('itinerary');
  const [flashItinerary, setFlashItinerary] = useState(false);
  const [rangerUnread, setRangerUnread] = useState(false);
  const paneRef = useRef(pane);
  paneRef.current = pane;

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
      if (paneRef.current !== 'ranger') setRangerUnread(true);
    }
    window.addEventListener('trailgraph:trips-changed', onTripsChanged);
    window.addEventListener('trailgraph:ranger-activity', onRangerActivity);
    return () => {
      window.removeEventListener('trailgraph:trips-changed', onTripsChanged);
      window.removeEventListener('trailgraph:ranger-activity', onRangerActivity);
    };
  }, []);

  const paneDisplay = (key: PlanPane) => ({ base: pane === key ? 'flex' : 'none', md: 'flex' });

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
        display={paneDisplay('itinerary')}
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
      <Box gridArea={{ base: 'content', md: 'map' }} display={paneDisplay('map')} minH={0} minW={0} position="relative">
        <MapCell onViewItinerary={() => setPane('itinerary')} />
      </Box>

      {/* Ranger chat — mounts exactly once per /plan visit (the Eve session). The chat input's safe-area
          inset is zeroed on base (the tab bar below owns the home-indicator inset there); md+ keeps env()
          because the input reaches the viewport bottom again. */}
      <Box
        gridArea={{ base: 'content', md: 'chat' }}
        display={paneDisplay('ranger')}
        flexDirection="column"
        minH={0}
        minW={0}
        overflow="hidden"
        borderLeftWidth={{ md: '1px' }}
        borderColor="border"
        css={{
          '--chat-safe-bottom': '0px',
          '@media (min-width: 48em)': { '--chat-safe-bottom': 'env(safe-area-inset-bottom, 0px)' },
        }}
      >
        <ChatPanel />
      </Box>

      <PlanTabBar pane={pane} onSelect={setPane} flashItinerary={flashItinerary} rangerUnread={rangerUnread} />
    </Grid>
  );
}

/** The map region: canvas props from the shared provider + the base-only "View itinerary" pill. Pane
 * switching rides the shell's `setPane` callback (context/props, not a window event — trailgraph:* stays
 * reserved for genuinely cross-tree producers like ChatPanel). */
function MapCell({ onViewItinerary }: { onViewItinerary: () => void }) {
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
          expanded inner div otherwise intercepts the tap (caught by plan-mobile e2e). */}
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
    </>
  );
}

'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box } from '@chakra-ui/react';
import { motion, useMotionValue, useDragControls, animate, type PanInfo } from 'motion/react';
import { prefersReducedMotion } from '../../lib/trip-map-render';

/**
 * AllTrails-style draggable bottom sheet over the full-bleed map (Phase 2, ADR-076), behind
 * NEXT_PUBLIC_PLAN_SHEET. Three snaps: peek (handle + a peek header) · half (50%) · full (92%). The sheet
 * body scrolls natively ONLY at `full`; at peek/half the whole sheet drags. Collapsing/expanding is via the
 * handle (drag with velocity settle, or TAP to cycle — which is also the `prefers-reduced-motion` path).
 * Everything inside stays mounted — the sheet is a transform, never an unmount.
 *
 * NB: the "over-drag the list at scrollTop 0 grabs the sheet" handoff (plan §5) is a deliberate follow-up —
 * it needs iOS-Safari rubber-band tuning the plan itself flags as the phase's risk. Handle-drag collapse is
 * robust and ships first; the flag stays off by default until the mobile e2e is stable on it.
 */
export type SheetSnap = 'peek' | 'half' | 'full';
const MotionDiv = motion.div;
const PEEK_PX = 96;

export function PlanSheet({ peek, children }: { peek: ReactNode; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const y = useMotionValue(0);
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [h, setH] = useState(0);
  const snapRef = useRef<SheetSnap>('peek');
  snapRef.current = snap;

  // Measure the container so snap offsets are real pixels (motion animates numbers, not dvh).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const sheetH = h * 0.92;
  // translateY offset per snap: 0 = fully up (full); larger = pushed down (less visible).
  const offset = (s: SheetSnap): number =>
    s === 'full' ? 0 : s === 'half' ? Math.max(0, sheetH - h * 0.5) : Math.max(0, sheetH - PEEK_PX);

  // Animate to the active snap whenever it (or the measured height) changes.
  useEffect(() => {
    if (!h) return;
    const target = offset(snap);
    if (prefersReducedMotion()) y.set(target);
    else animate(y, target, { type: 'spring', stiffness: 400, damping: 42 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, h]);

  function settle(_e: unknown, info: PanInfo) {
    // Project ~150ms of momentum, then snap to the nearest of the three offsets.
    const projected = y.get() + info.velocity.y * 0.15;
    const candidates: SheetSnap[] = ['full', 'half', 'peek'];
    let best: SheetSnap = 'peek';
    let bestDist = Infinity;
    for (const s of candidates) {
      const d = Math.abs(projected - offset(s));
      if (d < bestDist) { bestDist = d; best = s; }
    }
    setSnap(best);
  }

  // Tap the handle to cycle peek → half → full → peek (the reduced-motion affordance, and a handy shortcut).
  function cycle() {
    setSnap((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));
  }

  // Start a sheet drag from the body only when there's nothing to scroll away first (at full the list
  // scrolls; at peek/half the body isn't scrollable, so any drag moves the sheet).
  function bodyPointerDown(e: React.PointerEvent) {
    if (snapRef.current !== 'full' || (scrollRef.current?.scrollTop ?? 0) <= 0) controls.start(e);
  }

  const atFull = snap === 'full';

  return (
    <Box ref={containerRef} position="absolute" inset={0} overflow="hidden" pointerEvents="none">
      <MotionDiv
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: offset('peek') }}
        dragElastic={0.04}
        dragMomentum={false}
        onDragEnd={settle}
        style={{
          y,
          position: 'absolute',
          left: 0,
          right: 0,
          top: '8%',
          height: '92%',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      >
        <Box
          h="100%"
          display="flex"
          flexDirection="column"
          bg="bg.canvas"
          borderTopRadius="l3"
          borderWidth="1px"
          borderColor="border"
          shadow="dark-lg"
          overflow="hidden"
        >
          {/* Drag handle + peek header — the always-visible strip; drag or tap to change snap. */}
          <Box
            flexShrink={0}
            pt={2}
            pb={2}
            px={4}
            style={{ touchAction: 'none', cursor: 'grab' }}
            onPointerDown={(e) => controls.start(e)}
            onClick={cycle}
            role="button"
            tabIndex={0}
            aria-label="Drag or tap to resize the itinerary sheet"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } }}
          >
            <Box mx="auto" mb={2} w="36px" h="4px" borderRadius="full" bg="border.emphasized" />
            {peek}
          </Box>
          {/* Body — scrolls natively only at full; otherwise the whole sheet drags. */}
          <Box
            ref={scrollRef}
            flex="1"
            minH={0}
            overflowY={atFull ? 'auto' : 'hidden'}
            style={{ touchAction: atFull ? 'pan-y' : 'none' }}
            onPointerDown={bodyPointerDown}
          >
            {children}
          </Box>
        </Box>
      </MotionDiv>
    </Box>
  );
}

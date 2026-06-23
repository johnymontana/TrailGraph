'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Box, Text } from '@chakra-ui/react';
import { brandColors } from '../../lib/brandColors';
import { useColorMode } from '../ui/color-mode';
import { springs, draw, durations } from '../../theme/motion';

/**
 * "Memory forming" — the signature moment (ADR-044 §7.2): when a bridge is actually persisted, we make
 * the invisible graph write a *watchable* event. A node springs into being and the (You)→it edge draws,
 * in lockstep with the truth — fired by a `trailgraph:memory-formed` CustomEvent dispatched from the
 * persisted-write client paths (never the model's prose). Mounted once globally (layout) so it plays
 * wherever a write happens: chat, park pages, /me. Decoupled from the NVL canvas (which can't host SVG);
 * the live `/me` ContextGraph re-renders with the new node on its own.
 *
 * Reduced motion: the global <MotionConfig reducedMotion="user"> collapses transform/opacity to the end
 * state; SVG `pathLength` is NOT a transform, so we branch on `useReducedMotion()` for an instant edge.
 */
export interface MemoryFormedDetail {
  label: string;
  relation?: string; // e.g. "prefers", "considered"
}

export function MemoryFormingLayer() {
  const { colorMode } = useColorMode();
  const reduce = useReducedMotion();
  const [event, setEvent] = useState<(MemoryFormedDetail & { key: number }) | null>(null);

  useEffect(() => {
    let n = 0;
    const onFormed = (e: Event) => {
      const detail = (e as CustomEvent<MemoryFormedDetail>).detail;
      if (!detail?.label) return;
      setEvent({ ...detail, key: ++n });
    };
    window.addEventListener('trailgraph:memory-formed', onFormed as EventListener);
    return () => window.removeEventListener('trailgraph:memory-formed', onFormed as EventListener);
  }, []);

  // Auto-dismiss.
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), 2200);
    return () => clearTimeout(t);
  }, [event]);

  const c = brandColors(colorMode);

  return (
    <Box position="fixed" bottom={6} left="50%" transform="translateX(-50%)" zIndex={2000} pointerEvents="none">
      <AnimatePresence>
        {event ? (
          <motion.div
            key={event.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: durations.base }}
          >
            <Box bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="l3" shadow="lg" px={4} py={3} minW="260px">
              <Box as="svg" width="100%" height="44px" display="block" mb={1}>
                {/* (You) ── edge ──▶ (new node) */}
                <line x1="22" y1="22" x2="220" y2="22" stroke="transparent" />
                <motion.line
                  x1={22}
                  y1={22}
                  x2={220}
                  y2={22}
                  stroke={c.trail}
                  strokeWidth={2}
                  initial={{ pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={reduce ? { duration: 0 } : draw}
                />
                <circle cx="22" cy="22" r="9" fill={c.pine} />
                <motion.circle
                  cx={220}
                  cy={22}
                  r={11}
                  fill={c.trail}
                  initial={{ scale: reduce ? 1 : 0 }}
                  animate={reduce ? { scale: 1 } : { scale: [0, 1.18, 1] }}
                  transition={reduce ? { duration: 0 } : { ...springs.bouncy, delay: durations.fast }}
                  style={{ originX: '220px', originY: '22px' }}
                />
              </Box>
              <Text fontSize="sm">
                <Text as="span" color="fg.muted">Learned: {event.relation ?? 'prefers'} </Text>
                <Text as="span" fontWeight="semibold">{event.label}</Text>
              </Text>
            </Box>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Box>
  );
}

/** Fire the memory-forming animation from a persisted-write client path (truth ⇔ motion). */
export function emitMemoryFormed(detail: MemoryFormedDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('trailgraph:memory-formed', { detail }));
}

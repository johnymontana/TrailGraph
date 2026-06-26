'use client';
import { useCallback, useEffect, useRef } from 'react';
import { InteractiveNvlWrapper } from '@neo4j-nvl/react';
import type NVL from '@neo4j-nvl/base';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';

/**
 * The inner NVL boundary. This file imports `@neo4j-nvl/react` DIRECTLY (no `next/dynamic`) and is
 * itself loaded via `dynamic(ssr:false)` from `NvlGraph`. That indirection is deliberate: `next/dynamic`
 * does NOT reliably forward a React `ref` to the inner `forwardRef` component, so we capture the NVL
 * instance HERE (where the ref resolves to the wrapper's imperative-handle proxy) and hand it back up
 * through the plain `onReady` callback — callbacks cross the dynamic boundary fine; refs don't.
 *
 * `InteractiveNvlWrapper` wraps our `nvlCallbacks.onInitialization` (calls ours, then its own) and
 * passes `nvlCallbacks` into the NVL constructor, so `onInitialization`/`onLayoutDone` both fire. The
 * imperative-handle proxy (`nvlRef.current`) exists from first render; its methods no-op until the inner
 * instance is constructed — so heavy calls (fit) are gated on `onLayoutDone`, not `onInitialization`.
 */

// Mirror the wrapper's own interaction defaults: passing `interactionOptions` REPLACES them, so we must
// spread these or we'd silently re-enable select-on-click.
const INTERACTION_DEFAULTS = {
  selectOnClick: false,
  drawShadowOnHover: true,
  selectOnRelease: false,
  excludeNodeMargin: true,
};

export interface NvlCanvasProps {
  nodes: NvlNode[];
  rels: NvlRel[];
  layout?: string;
  layoutOptions?: Record<string, unknown>;
  renderer?: 'canvas' | 'webgl';
  positions?: Array<{ id: string; x: number; y: number }>;
  /** Bump to force a re-fit (e.g. a "Fit" button or after pushing geographic/radial positions). */
  fitNonce?: number;
  /** Auto-frame the graph once after the first layout settles (kills the single-dot first impression). */
  autoFit?: boolean;
  interactionOptions?: Record<string, unknown>;
  onReady?: (nvl: NVL) => void;
  onLayoutSettled?: () => void;
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onNodeHover?: (id: string | null) => void;
  onScaleChange?: (scale: number) => void;
}

export default function NvlCanvas({
  nodes,
  rels,
  layout,
  layoutOptions,
  renderer,
  positions,
  fitNonce,
  autoFit = true,
  interactionOptions,
  onReady,
  onLayoutSettled,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onScaleChange,
}: NvlCanvasProps) {
  const nvlRef = useRef<NVL | null>(null);
  const lastHover = useRef<string | null>(null);
  // The nvlCallbacks closure is captured by NVL at construction (first render), so read live values
  // through refs to avoid stale `nodes`/`autoFit`.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;

  // Auto-fit. NVL 1.2.0's force layout does NOT emit `onLayoutDone`, so we can't fit from a settle
  // callback. Adding nodes (overlay toggle / expansion) also reheats the layout, briefly collapsing
  // positions toward the origin — fitting then over-zooms to a single dot. So fit at several timepoints
  // and ONLY when the nodes have actually spread (never the degenerate all-at-origin box): the early
  // shots frame the load quickly, the later shots correct after a reheated layout re-settles. Driven by
  // React effects (NOT the NVL `onInitialization` callback) WITH cleanup, so that under dev StrictMode's
  // mount→unmount→remount the first mount's timers are cancelled and only the live instance is fit.
  // Returns a cancel fn. Stable (refs only) so the effects don't re-run per render.
  const scheduleFit = useCallback(() => {
    if (!autoFitRef.current) return () => {};
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      tries += 1;
      const api = nvlRef.current as unknown as
        | { fit(ids: string[]): void; getNodePositions?: () => Array<{ x: number; y: number }> }
        | null;
      if (api) {
        const pos = (api.getNodePositions?.() ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        // Fit only once nodes have spread out of the origin (a fit on the degenerate all-at-origin box
        // over-zooms to a single dot); a tiny graph (≤1 positioned node) is framed immediately.
        const spread = pos.length > 1 && pos.some((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
        if (spread || pos.length <= 1) {
          api.fit(nodesRef.current.map((n) => n.id));
          return;
        }
      }
      if (tries < 30) window.setTimeout(tick, 300);
    };
    const t0 = window.setTimeout(tick, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t0);
    };
  }, []);

  // Initial auto-fit on mount (lifecycle-managed → StrictMode-safe).
  useEffect(() => scheduleFit(), [scheduleFit]);
  // Reframe on any programmatic fit request (manual Fit, layout switch, overlay toggle, query result/back).
  useEffect(() => {
    if (!fitNonce) return undefined;
    return scheduleFit();
  }, [fitNonce, scheduleFit]);

  return (
    <InteractiveNvlWrapper
      ref={nvlRef}
      nodes={nodes}
      rels={rels}
      layout={layout ?? 'forceDirected'}
      layoutOptions={layoutOptions}
      positions={positions}
      nvlOptions={{ initialZoom: 0.7, ...(renderer ? { renderer } : {}) }}
      interactionOptions={{ ...INTERACTION_DEFAULTS, ...interactionOptions }}
      nvlCallbacks={{
        onInitialization: () => {
          if (nvlRef.current) onReady?.(nvlRef.current);
        },
        onLayoutDone: () => onLayoutSettled?.(),
      }}
      mouseEventCallbacks={{
        onNodeClick: (node) => onNodeClick?.(node.id),
        onNodeDoubleClick: (node) => onNodeDoubleClick?.(node.id),
        onHover: (element) => {
          // onHover fires on every mousemove (even over empty space / unchanged element) — dedupe by id.
          const id =
            element && typeof element === 'object' && 'id' in element && !('from' in element)
              ? (element as NvlNode).id
              : null;
          if (id !== lastHover.current) {
            lastHover.current = id;
            onNodeHover?.(id);
          }
        },
        onZoomAndPan: (zoomLevel: number) => onScaleChange?.(zoomLevel),
        onPan: true,
        onDrag: true,
      }}
    />
  );
}

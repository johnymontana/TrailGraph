'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Box } from '@chakra-ui/react';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';

/**
 * Reusable Neo4j-NVL renderer (the only file that imports `@neo4j-nvl/react`). NVL is canvas/WebGL +
 * `window`, so the wrapper is dynamically imported with `ssr:false`. The single most common NVL bug is a
 * zero-height container, so the parent Box always carries an explicit height and we gate the wrapper's
 * mount on a `ResizeObserver` confirming non-zero size.
 */
const InteractiveNvlWrapper = dynamic(
  () => import('@neo4j-nvl/react').then((m) => m.InteractiveNvlWrapper),
  { ssr: false },
);

export interface NvlGraphProps {
  nodes: NvlNode[];
  rels: NvlRel[];
  onNodeClick?: (id: string) => void;
  /** '100%' for a full-bleed page container, or a px number for an inline section. */
  height?: number | string;
  legend?: ReactNode;
}

export function NvlGraph({ nodes, rels, onNodeClick, height = '100%', legend }: NvlGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => {
      if (el.clientHeight > 0 && el.clientWidth > 0) setReady(true);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, []);

  return (
    <Box ref={wrapRef} position="relative" w="100%" h={height} minH="1px" data-testid="nvl-graph">
      {ready ? (
        <Box position="absolute" inset={0}>
          <InteractiveNvlWrapper
            nodes={nodes}
            rels={rels}
            layout="forcedirected"
            nvlOptions={{ initialZoom: 0.7, layout: 'forcedirected' }}
            mouseEventCallbacks={{
              onNodeClick: (node) => onNodeClick?.(node.id),
              onPan: true,
              onZoom: true,
              onDrag: true,
            }}
          />
        </Box>
      ) : null}
      {legend}
    </Box>
  );
}

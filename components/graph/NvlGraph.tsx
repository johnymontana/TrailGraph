'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Box } from '@chakra-ui/react';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';
import type { NvlCanvasProps } from './NvlCanvas';

/**
 * Reusable Neo4j-NVL renderer. NVL is canvas/WebGL + `window`, so the inner `NvlCanvas` (the only file
 * that imports `@neo4j-nvl/react`) is dynamically imported with `ssr:false`. The instance is captured
 * inside `NvlCanvas` and surfaced via the `onReady` callback (a ref can't be threaded through
 * `next/dynamic`). The single most common NVL bug is a zero-height container, so the parent Box always
 * carries an explicit height and we gate the wrapper's mount on a `ResizeObserver` confirming non-zero
 * size. All `NvlCanvas` props pass straight through, so callers can opt into fit/layout/labels/expand.
 */
const NvlCanvas = dynamic(() => import('./NvlCanvas'), { ssr: false });

export interface NvlGraphProps extends Omit<NvlCanvasProps, 'nodes' | 'rels'> {
  nodes: NvlNode[];
  rels: NvlRel[];
  /** '100%' for a full-bleed page container, or a px number for an inline section. */
  height?: number | string;
  legend?: ReactNode;
}

export function NvlGraph({ nodes, rels, height = '100%', legend, ...canvasProps }: NvlGraphProps) {
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
          <NvlCanvas nodes={nodes} rels={rels} {...canvasProps} />
        </Box>
      ) : null}
      {legend}
    </Box>
  );
}

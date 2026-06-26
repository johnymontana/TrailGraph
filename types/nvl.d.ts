// `@neo4j-nvl/react` (1.2.0) ships no TypeScript declarations, so we declare the slice we use.
// `@neo4j-nvl/base` IS typed — we reuse its Node/Relationship/NVL types here.
//
// This ambient decl SHADOWS the package's own per-file `.d.ts` (its package.json has only `main`, no
// `types`/`exports`), so anything the graph explorer needs — the forwarded `ref`, double-click /
// right-click / zoom-and-pan callbacks, keyboard callbacks, box/lasso selection, and the
// `positions`/`zoom`/`pan`/`layoutOptions` props — must be declared here or it won't typecheck.
declare module '@neo4j-nvl/react' {
  import type { ComponentType, CSSProperties, Ref } from 'react';
  import type { Node, Relationship } from '@neo4j-nvl/base';
  import type NVL from '@neo4j-nvl/base';

  export interface MouseEventCallbacks {
    onNodeClick?: (node: Node, hitTargets: unknown, evt: MouseEvent) => void;
    onNodeDoubleClick?: (node: Node, hitTargets: unknown, evt: MouseEvent) => void;
    onNodeRightClick?: (node: Node, hitTargets: unknown, evt: MouseEvent) => void;
    onRelationshipClick?: (rel: Relationship, hitTargets: unknown, evt: MouseEvent) => void;
    onCanvasClick?: (evt: MouseEvent) => void;
    onCanvasDoubleClick?: (evt: MouseEvent) => void;
    onHover?: (element: unknown, hitTargets: unknown, evt: MouseEvent) => void;
    // `onZoom` is deprecated upstream in favour of `onZoomAndPan`; both accept either a boolean toggle
    // (turn the interaction on) or a callback. `onZoomAndPan` args are POSITIONAL (not a tuple).
    onZoom?: boolean | ((zoomLevel: number, evt: WheelEvent) => void);
    onZoomAndPan?: boolean | ((zoomLevel: number, panX: number, panY: number, evt: WheelEvent) => void);
    onPan?: boolean | ((evt: MouseEvent) => void);
    onDrag?: boolean | ((evt: MouseEvent) => void);
    // Box / lasso selection (the package DOES expose these via @neo4j-nvl/interaction-handlers). Typed
    // permissively because the exact arg shape isn't re-exported in a resolvable way.
    onBoxSelect?: (...args: unknown[]) => void;
    onLassoSelect?: (...args: unknown[]) => void;
    onLassoStarted?: (...args: unknown[]) => void;
  }

  export interface NvlWrapperProps {
    nodes: Node[];
    rels: Relationship[];
    layout?: string;
    layoutOptions?: Record<string, unknown>;
    nvlOptions?: Record<string, unknown>;
    interactionOptions?: Record<string, unknown>;
    mouseEventCallbacks?: MouseEventCallbacks;
    keyboardEventCallbacks?: Record<string, (...args: unknown[]) => void>;
    nvlCallbacks?: Record<string, unknown>;
    positions?: Array<{ id: string; x: number; y: number }>;
    zoom?: number;
    pan?: { x: number; y: number };
    onInitializationError?: (error: Error) => void;
    ref?: Ref<NVL>;
    className?: string;
    style?: CSSProperties;
  }

  export const InteractiveNvlWrapper: ComponentType<NvlWrapperProps>;
  export const BasicNvlWrapper: ComponentType<NvlWrapperProps>;
}

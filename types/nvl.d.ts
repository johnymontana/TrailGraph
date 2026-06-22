// `@neo4j-nvl/react` (1.2.0) ships no TypeScript declarations, so we declare the slice we use.
// `@neo4j-nvl/base` IS typed — we reuse its Node/Relationship types here.
declare module '@neo4j-nvl/react' {
  import type { ComponentType, CSSProperties, Ref } from 'react';
  import type { Node, Relationship } from '@neo4j-nvl/base';

  export interface MouseEventCallbacks {
    onNodeClick?: (node: Node, hitTargets: unknown, evt: MouseEvent) => void;
    onRelationshipClick?: (rel: Relationship, hitTargets: unknown, evt: MouseEvent) => void;
    onCanvasClick?: (evt: MouseEvent) => void;
    onHover?: (element: unknown, hitTargets: unknown, evt: MouseEvent) => void;
    onZoom?: boolean;
    onPan?: boolean;
    onDrag?: boolean;
  }

  export interface NvlWrapperProps {
    nodes: Node[];
    rels: Relationship[];
    layout?: string;
    nvlOptions?: Record<string, unknown>;
    interactionOptions?: Record<string, unknown>;
    mouseEventCallbacks?: MouseEventCallbacks;
    nvlCallbacks?: Record<string, unknown>;
    onInitializationError?: (error: Error) => void;
    ref?: Ref<unknown>;
    className?: string;
    style?: CSSProperties;
  }

  export const InteractiveNvlWrapper: ComponentType<NvlWrapperProps>;
  export const BasicNvlWrapper: ComponentType<NvlWrapperProps>;
}

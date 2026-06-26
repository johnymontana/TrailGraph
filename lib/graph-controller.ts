import type NVL from '@neo4j-nvl/base';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';

/**
 * Thin, null-guarded imperative surface over a captured NVL instance (Phase 0 of the /graph overhaul).
 * Every interactive feature (fit/fly-to/layout/expand/select/pin/path-highlight) calls through here so
 * call sites stay clean and never touch a half-initialised instance. The NVL methods are confirmed in
 * `@neo4j-nvl/base/dist/types/index.d.ts`; we cast to a permissive structural type to avoid fighting
 * NVL's strict `Layout`/`LayoutOptions`/`renderer` string unions (we validate those in the UI instead).
 */

export type GraphLayout = 'forceDirected' | 'hierarchical' | 'grid' | 'free' | 'd3Force' | 'circular';
export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

interface NvlInstance {
  fit(nodeIds: string[], zoomOptions?: unknown): void;
  setLayout(layout: string): void;
  setLayoutOptions(options: Record<string, unknown>): void;
  setNodePositions(data: NodePosition[], updateLayout?: boolean): void;
  setRenderer(renderer: string): void;
  setZoomAndPan(zoom: number, panX: number, panY: number): void;
  addAndUpdateElementsInGraph(nodes?: NvlNode[], rels?: NvlRel[]): void;
  removeNodesWithIds(ids: string[]): void;
  removeRelationshipsWithIds(ids: string[]): void;
  getSelectedNodes(): NvlNode[];
  deselectAll(): void;
  pinNode(id: string): void;
  unPinNode(ids: string[]): void;
  getScale(): number;
  getPan(): { x: number; y: number };
}

export interface NvlController {
  readonly nvl: NVL | null;
  /** Frame the given node ids (or the whole graph). Animates by default — never pass `{animated:true}`. */
  fit(ids?: string[]): void;
  /** Frame a focus node together with its incident neighbours (the "fly-to" gesture). */
  flyTo(id: string, neighborIds?: string[]): void;
  setLayout(layout: GraphLayout, options?: Record<string, unknown>): void;
  setNodePositions(positions: NodePosition[], updateLayout?: boolean): void;
  setRenderer(renderer: 'canvas' | 'webgl'): void;
  /** Incrementally add/update nodes+rels — retains existing positions (no full relayout). */
  expand(nodes: NvlNode[], rels: NvlRel[]): void;
  collapse(nodeIds: string[], relIds?: string[]): void;
  select(ids: string[]): void;
  deselectAll(): void;
  getSelected(): string[];
  pin(id: string): void;
  unpin(ids: string[]): void;
  getScale(): number;
  getPan(): { x: number; y: number };
}

const NOOP_CONTROLLER: NvlController = {
  nvl: null,
  fit() {},
  flyTo() {},
  setLayout() {},
  setNodePositions() {},
  setRenderer() {},
  expand() {},
  collapse() {},
  select() {},
  deselectAll() {},
  getSelected: () => [],
  pin() {},
  unpin() {},
  getScale: () => 1,
  getPan: () => ({ x: 0, y: 0 }),
};

export function makeNvlController(nvl: NVL | null): NvlController {
  if (!nvl) return NOOP_CONTROLLER;
  const n = nvl as unknown as NvlInstance;
  return {
    nvl,
    fit(ids) {
      n.fit(ids ?? []);
    },
    flyTo(id, neighborIds = []) {
      n.fit([id, ...neighborIds]);
    },
    setLayout(layout, options) {
      n.setLayout(layout);
      if (options) n.setLayoutOptions(options);
    },
    setNodePositions(positions, updateLayout = false) {
      n.setNodePositions(positions, updateLayout);
    },
    setRenderer(renderer) {
      n.setRenderer(renderer);
    },
    expand(nodes, rels) {
      n.addAndUpdateElementsInGraph(nodes, rels);
    },
    collapse(nodeIds, relIds) {
      if (relIds?.length) n.removeRelationshipsWithIds(relIds);
      if (nodeIds.length) n.removeNodesWithIds(nodeIds);
    },
    select(ids) {
      n.addAndUpdateElementsInGraph(
        ids.map((id) => ({ id, selected: true }) as unknown as NvlNode),
        [],
      );
    },
    deselectAll() {
      n.deselectAll();
    },
    getSelected() {
      return (n.getSelectedNodes() ?? []).map((node) => node.id);
    },
    pin(id) {
      n.pinNode(id);
    },
    unpin(ids) {
      n.unPinNode(ids);
    },
    getScale() {
      return n.getScale();
    },
    getPan() {
      return n.getPan();
    },
  };
}

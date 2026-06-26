/**
 * Pure helpers for the /graph explorer's client state (Phase 0 / feature #1). DOM-free + unit-tested.
 * NVL has no zoom-threshold captions, so we decide which node captions to show client-side from the
 * current zoom band, hover, and selection — then blank the rest in the renderer.
 */

export type ZoomBand = 'far' | 'mid' | 'near';

/** Map an NVL scale (from `onZoomAndPan`) to a coarse band. NVL's default/reset zoom is ~0.75. */
export function zoomBandFor(scale: number): ZoomBand {
  if (scale < 0.5) return 'far';
  if (scale < 1.2) return 'mid';
  return 'near';
}

export interface CaptionNode {
  id: string;
  degree?: number;
}

/**
 * Ids whose caption should be visible: hovered + selected always; hubs added at mid zoom (and the
 * strongest hubs at far zoom); everything at near zoom. Keep per-hover changes to a single node id.
 */
export function computeCaptions(
  nodes: CaptionNode[],
  opts: { band: ZoomBand; hoveredId?: string | null; selectedIds?: Iterable<string>; hubDegree?: number },
): Set<string> {
  const { band, hoveredId, selectedIds, hubDegree = 5 } = opts;
  const show = new Set<string>();
  if (hoveredId) show.add(hoveredId);
  for (const id of selectedIds ?? []) show.add(id);
  if (band === 'near') {
    for (const n of nodes) show.add(n.id);
  } else {
    const threshold = band === 'far' ? hubDegree + 2 : hubDegree;
    for (const n of nodes) if ((n.degree ?? 0) >= threshold) show.add(n.id);
  }
  return show;
}

/**
 * Bridge the ranger chat → the map (#7): pull the located parks out of the `park_card` tool outputs in a
 * set of assistant message parts so the map command bar can highlight + fly to the same parks the cards
 * show. Mirrors ChatPanel's park-card dedup-by-parkCode (and the legacy `data.park` shape). Pure + tested.
 */
export interface ParkHighlight {
  parkCode: string;
  name?: string;
  lat: number;
  lng: number;
}

interface ToolPart {
  type?: string;
  state?: string;
  output?: unknown;
}

export function extractParkCards(parts: ToolPart[]): ParkHighlight[] {
  const seen = new Set<string>();
  const out: ParkHighlight[] = [];
  for (const part of parts ?? []) {
    if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue;
    const o = part.output as { kind?: string; data?: { parks?: unknown[]; park?: unknown } } | undefined;
    if (o?.kind !== 'park_card' || !o.data) continue;
    const list = (o.data.parks ?? (o.data.park ? [o.data.park] : [])) as { parkCode?: string; name?: string; lat?: number | null; lng?: number | null }[];
    for (const p of list) {
      if (!p?.parkCode || p.lat == null || p.lng == null || seen.has(p.parkCode)) continue;
      seen.add(p.parkCode);
      out.push({ parkCode: p.parkCode, name: p.name, lat: p.lat, lng: p.lng });
    }
  }
  return out;
}

/**
 * Bridge the ranger chat → the trip builder (ADR-076): pull the trip ids a ranger turn actually CHANGED
 * out of a message's tool outputs, so ChatPanel can dispatch `trailgraph:trips-changed` per edit (deduped
 * per assistant message, not once-per-trip — the old per-trip dedup missed every edit after a trip's
 * first save). Two output shapes mark a confirmed write:
 *   • `itinerary_preview` with `data.trip.id` — build_itinerary / add_stop / start_trip_from_tour return
 *     the SAVED trip. `suggest_day_plan` ALSO returns one (so the chat render-dedup collapses it) but
 *     persists NOTHING — it sets `data.readOnly`, which we skip here;
 *   • any kind with `data.addedTo.tripId` — the confirmed nested adds (add_trail_to_trip,
 *     add_campground_to_trip). Their `pendingAdd` previews also carry a tripId but wrote NOTHING, so
 *     they deliberately never announce.
 * Mirrors `chat-parks.ts` (pure + tested).
 */
interface ToolPart {
  type?: string;
  state?: string;
  output?: unknown;
}

export function tripIdsFromParts(parts: ToolPart[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts ?? []) {
    if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue;
    const o = part.output as
      | { kind?: string; data?: { readOnly?: unknown; trip?: { id?: unknown }; addedTo?: { tripId?: unknown } } }
      | undefined;
    // `readOnly` outputs (suggest_day_plan) carry a trip.id for render-dedup but persist nothing — skip.
    const savedTrip =
      o?.kind === 'itinerary_preview' && o.data?.readOnly !== true && typeof o.data?.trip?.id === 'string'
        ? o.data.trip.id
        : null;
    const nestedAdd = typeof o?.data?.addedTo?.tripId === 'string' ? o.data.addedTo.tripId : null;
    const id = savedTrip ?? nestedAdd;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

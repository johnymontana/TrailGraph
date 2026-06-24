/**
 * Renderability guard for the chat's tool-result cards (ADR-013/042). Extracted from the client
 * `Cards.tsx` so it's pure (no React/Chakra import) and unit-testable in the node project: a wrong guard
 * silently drops a card or renders an empty one with no error, so it deserves direct coverage. Returns
 * true when a `{kind,data}` tool output has something visible to render (errors always render).
 */
export function isRenderableToolOutput(kind: string, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.error === 'string') return true;
  if (kind === 'park_card') return ((d.parks as unknown[])?.length ?? (d.park ? 1 : 0)) > 0;
  if (kind === 'node_results') return ((d.results as unknown[])?.length ?? 0) > 0;
  if (kind === 'itinerary_preview') return !!d.trip;
  if (kind === 'alert_list') return ((d.parks as unknown[])?.length ?? 0) > 0;
  if (kind === 'dark_sky_card') return d.bortleScale != null || !!d.bestMonths || !!d.crowdLevel || !!d.astro;
  if (kind === 'weather_card') return !!d.condition || ((d.daily as unknown[])?.length ?? 0) > 0;
  if (kind === 'astro_card') return !!d.moon || !!d.date;
  if (kind === 'conditions_card') return !!d.parkCode;
  if (kind === 'trip_dashboard') return ((d.stops as unknown[])?.length ?? 0) > 0;
  if (kind === 'trip_diff') return !!(d.a && d.b);
  if (kind === 'leaderboard_card') return ((d.entries as unknown[])?.length ?? 0) > 0 || !!d.submitted;
  if (kind === 'watch_list') return Array.isArray(d.watches); // render even when empty (confirms state)
  if (kind === 'hours_card') return !!d.state || !!d.name; // F1: open/closed check
  if (kind === 'budget_card') return ((d.parks as unknown[])?.length ?? 0) > 0; // F2: trip fee budget
  if (kind === 'accessibility_card') return Array.isArray(d.features) || !!d.name; // F5: a11y scorecard
  if (kind === 'news_card') return Array.isArray(d.news); // F8: render even when empty ("no recent news")
  if (kind === 'digest_card') return Array.isArray(d.items); // render even when empty ("all clear")
  if (kind === 'why_this') return ((d.prefPaths as unknown[])?.length ?? 0) > 0 || ((d.constraints as unknown[])?.length ?? 0) > 0 || !!d.park;
  if (kind === 'question_card') return typeof d.prompt === 'string' && ((d.options as unknown[])?.length ?? 0) > 0;
  return false;
}

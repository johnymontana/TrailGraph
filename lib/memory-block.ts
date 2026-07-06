import type { UserMemory } from './memory-graph';

/**
 * Pure renderer for the deterministic memory block injected every turn (P1.4, used by
 * `agent/instructions/user-memory.ts`). Extracted here so it's testable without importing the Eve runtime,
 * and so the cache-stability invariant — identical memory ⇒ identical bytes — has direct coverage (the
 * block sits in the cache-sensitive system-prompt position, so non-determinism would silently cost cache
 * hits). Lists are sorted; empty memory yields '' so the resolver can inject nothing.
 */
export function renderMemoryBlock(m: UserMemory): string {
  const lines: string[] = [];

  if (m.home.label) lines.push(`- Home: ${m.home.label} (default trip start point)`);

  const prefs = m.preferences.map((p) => p.name).filter(Boolean).sort();
  if (prefs.length) lines.push(`- Prefers: ${prefs.join(', ')}`);

  const constraints = summarizeConstraints(m.travel);
  if (constraints) lines.push(`- Travel constraints: ${constraints}`);

  const trailPrefs = summarizeTrailPreferences(m.trailPreferences);
  if (trailPrefs) lines.push(`- Trail preferences: ${trailPrefs}`);

  const campPrefs = summarizeCampPreferences(m.campPreferences);
  if (campPrefs) lines.push(`- Camp preferences: ${campPrefs}`);

  const passes = m.passes.map((p) => p.name).filter(Boolean).sort();
  const availability = summarizeAvailability(m.availability);
  if (passes.length || availability) {
    const parts: string[] = [];
    if (passes.length) parts.push(`passes held: ${passes.join(', ')}`);
    if (availability) parts.push(`availability: ${availability}`);
    lines.push(`- ${capitalize(parts.join(' · '))}`);
  }

  const considered = m.considered
    .map((c) => c.name || c.parkCode)
    .filter(Boolean)
    .sort()
    .slice(0, 8);
  if (considered.length) lines.push(`- Considered parks: ${considered.join(', ')}`);

  const trips = m.planned.map((t) => t.name).filter(Boolean).sort();
  if (trips.length) lines.push(`- Saved trips: ${trips.join(', ')}`);

  // Dedupe by name: a trail can carry BOTH a SAVED and a WISHLISTED edge (independent rel types), so the
  // merge would otherwise render it twice and burn a cap slot.
  const savedTrails = [
    ...new Set([...m.trailHistory.saved, ...m.trailHistory.wishlisted].map((t) => t.name).filter(Boolean)),
  ]
    .sort()
    .slice(0, 6);
  if (savedTrails.length) lines.push(`- Saved / bucket-list trails: ${savedTrails.join(', ')}`);

  const doneTrails = m.trailHistory.done
    .map((t) => t.name)
    .filter(Boolean)
    .sort()
    .slice(0, 6);
  if (doneTrails.length) lines.push(`- Trails already hiked: ${doneTrails.join(', ')}`);

  const savedCamps = m.campHistory.saved
    .map((c) => c.name)
    .filter(Boolean)
    .sort()
    .slice(0, 6);
  if (savedCamps.length) lines.push(`- Saved campgrounds: ${savedCamps.join(', ')}`);

  if (!lines.length) return '';

  return [
    '## What you already know about this user (load-bearing — honor it; do not re-ask for these)',
    ...lines,
    '',
    'You already have this core memory loaded — do NOT call `recall_user_context` just to re-read it; ' +
      'call it only for deeper history (full entity timeline, cross-conversation lookups). If a hard ' +
      'constraint here looks stale or trip-specific, confirm its scope before applying it (see the ' +
      'travel-constraint scope rule).',
  ].join('\n');
}

function summarizeConstraints(t: UserMemory['travel']): string {
  const parts: string[] = [];
  if (t.wheelchair) parts.push('needs wheelchair-accessible sites');
  if (t.rvMaxLengthFt) parts.push(`RV ≤ ${t.rvMaxLengthFt} ft`);
  const amenities = [...t.requiredAmenities].filter(Boolean).sort();
  if (amenities.length) parts.push(`required amenities: ${amenities.join(', ')}`);
  return parts.join(' · ');
}

function summarizeTrailPreferences(tp: UserMemory['trailPreferences']): string {
  const parts: string[] = [];
  if (tp.difficulty) parts.push(`${tp.difficulty} or easier`);
  if (tp.maxMiles != null) parts.push(`≤ ${tp.maxMiles} mi`);
  // Raw number (NOT toLocaleString) — this block must be byte-identical for identical memory, and a
  // no-locale toLocaleString() formats per the runtime's ambient locale (3000 → '3,000'/'3.000'/'3 000').
  if (tp.maxGainFt != null) parts.push(`≤ ${tp.maxGainFt} ft gain`);
  if (tp.avoidExposure) parts.push('no exposure');
  if (tp.dogsRequired) parts.push('dog-friendly');
  return parts.join(' · ');
}

function summarizeCampPreferences(cp: UserMemory['campPreferences']): string {
  const parts: string[] = [];
  if (cp.rig) parts.push(cp.maxLengthFt != null ? `${cp.maxLengthFt}-ft ${cp.rig}` : cp.rig);
  else if (cp.maxLengthFt != null) parts.push(`${cp.maxLengthFt}-ft rig`);
  if (cp.hookups && cp.hookups !== 'none') parts.push(cp.hookups);
  if (cp.tentOk) parts.push('tent ok');
  if (cp.ada) parts.push('ADA');
  if (cp.pets) parts.push('pets');
  if (cp.quiet) parts.push('quiet');
  // Raw number (NOT toLocaleString) — byte-stable for cache (see summarizeTrailPreferences).
  if (cp.budget != null) parts.push(`≤ $${cp.budget}`);
  return parts.join(' · ');
}

function summarizeAvailability(a: UserMemory['availability']): string {
  if (a.start && a.end) return `${a.start} → ${a.end}`;
  if (a.start) return `from ${a.start}`;
  if (a.end) return `until ${a.end}`;
  return '';
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

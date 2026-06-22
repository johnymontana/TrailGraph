/**
 * Live park conditions (§5, NPS-expansion P2 #6) — behind the AD-3 adapter. Webcam status and road
 * events are volatile and uneven, so (per the grilled plan) they are *runtime* fetches against the NPS
 * API rather than graph-synced nodes — same shape as `weather.ts`. Cached briefly via `fetch`'s
 * `next.revalidate`. Pure mappers (status label, severity rank) are unit-tested. Never called from
 * user-blocking hot paths beyond the park page, which is cached.
 */
import { env } from '../env';

export interface Webcam {
  id: string;
  title: string;
  status: string; // Active | Inactive | ...
  isStreaming: boolean;
  url: string | null;
  imageUrl: string | null;
}

export interface RoadEvent {
  id: string;
  title: string;
  type: string; // Incident | Workzone
  severity: string; // friendly label
  severityRank: number; // 0..3 for sorting
}

export interface ParkConditions {
  webcams: Webcam[];
  roadEvents: RoadEvent[];
}

/** NPS roadevent severity → friendly label + sortable rank. Pure (unit-tested). */
export function roadEventSeverity(raw: string | undefined | null): { label: string; rank: number } {
  const s = (raw ?? '').toLowerCase();
  if (/major|severe|closure|closed/.test(s)) return { label: 'Major', rank: 3 };
  if (/moderate/.test(s)) return { label: 'Moderate', rank: 2 };
  if (/minor/.test(s)) return { label: 'Minor', rank: 1 };
  return { label: 'Info', rank: 0 };
}

interface NpsWebcam {
  id: string;
  title?: string;
  status?: string;
  isStreaming?: string | boolean;
  url?: string;
  images?: { url?: string }[];
}
interface NpsRoadEvent {
  id: string;
  properties?: { headline?: string; event_type?: string; severity?: string };
  // some shapes are flat
  title?: string;
  type?: string;
  severity?: string;
}

async function fetchJson<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${env.nps.baseUrl}/${path}`, {
      headers: { 'X-Api-Key': env.nps.apiKey },
      next: { revalidate: 900 }, // 15 min — conditions move, but not by the second
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: T[] } | T[];
    return Array.isArray(json) ? json : (json.data ?? []);
  } catch {
    return [];
  }
}

/** Live conditions for a park, or empty arrays if unavailable (coverage is uneven). Cached ~15 min. */
export async function getConditions(parkCode: string): Promise<ParkConditions> {
  const [cams, roads] = await Promise.all([
    fetchJson<NpsWebcam>(`webcams?parkCode=${parkCode}`),
    fetchJson<NpsRoadEvent>(`roadevents?parkCode=${parkCode}`),
  ]);

  const webcams: Webcam[] = cams.map((c) => ({
    id: String(c.id),
    title: c.title ?? 'Webcam',
    status: c.status ?? 'Unknown',
    isStreaming: c.isStreaming === true || c.isStreaming === 'true',
    url: c.url ?? null,
    imageUrl: c.images?.[0]?.url ?? null,
  }));

  const roadEvents: RoadEvent[] = roads
    .map((r) => {
      const title = r.properties?.headline ?? r.title ?? 'Road event';
      const type = r.properties?.event_type ?? r.type ?? 'Event';
      const sev = roadEventSeverity(r.properties?.severity ?? r.severity);
      return { id: String(r.id), title, type, severity: sev.label, severityRank: sev.rank };
    })
    .sort((a, b) => b.severityRank - a.severityRank);

  return { webcams, roadEvents };
}

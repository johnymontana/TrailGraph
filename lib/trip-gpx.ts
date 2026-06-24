import { generateGPX, type GpxTrackSeg, type GpxWaypoint } from './gpx';
import type { getTrip } from './trips';

type Trip = NonNullable<Awaited<ReturnType<typeof getTrip>>>;

/**
 * Adapt a hydrated trip (the reified :Stop model, ADR-003) into GPX (ADR-048). Mirrors lib/trip-ics.ts:
 * a type-only `getTrip` import (no circular value import). Located stops only, in order; one connector
 * track of the stop coordinates. The `:DRIVE_TO` edge caches distance/minutes only (no geometry), so the
 * track is a straight connector — labeled as such, never faked into road geometry.
 */
export function tripToGpx(trip: Trip, opts: { time: string }): string {
  const stops = (trip.stops ?? []).filter(
    (s): s is NonNullable<typeof s> => !!s && s.lat != null && s.lng != null,
  );

  const waypoints: GpxWaypoint[] = stops.map((s, i) => {
    const label = s.parkName ?? s.campgroundName ?? s.poiTitle ?? s.placeTitle ?? s.name ?? 'Stop';
    const drive = s.driveTo
      ? `Drive to next: ${Math.round(s.driveTo.miles)} mi / ${Math.round(s.driveTo.minutes)} min` +
        (s.driveTo.source === 'great_circle' ? ' (approx)' : '')
      : undefined;
    return {
      lat: s.lat as number,
      lon: s.lng as number,
      name: `${(s.order ?? i) + 1}. ${label}`,
      type: s.kind ?? undefined,
      desc: drive,
    };
  });

  const tracks: GpxTrackSeg[] = [
    { name: `${trip.name ?? 'TrailGraph Trip'} route`, points: stops.map((s) => ({ lat: s.lat as number, lon: s.lng as number })) },
  ];

  return generateGPX(
    {
      name: trip.name ?? 'TrailGraph Trip',
      time: opts.time,
      desc: 'TrailGraph itinerary. Track is a straight stop-to-stop connector, not turn-by-turn routing. Verify access/closures at nps.gov.',
    },
    waypoints,
    tracks,
  );
}
